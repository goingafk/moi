import type { CatalogModel, RoutingDecisionLog, SessionAgent, WorkspaceEntry } from '@/lib/types'
import { defaultSessionAgent } from '@/lib/session-agent'

import { getAppSettings } from '../app-settings'
import { listModelCatalog } from '../model-catalog'
import { getUsageSnapshots } from '../usage/store'
import { classifyRoute } from './classify'
import { appendRoutingDecision, lastRoutedChoice } from './log'
import { projectSummary } from './project-summary'
import { selectRoute } from './select'
import type { Classification, RouteDecision } from './types'

export type RouteMessageInput = {
  workspace: WorkspaceEntry
  sessionId: string
  isNew: boolean
  content: string
  boundAgent?: SessionAgent
  currentModel?: string
}

type RouteDependencies = {
  classify?: (input: { message: string; project: string }) => Promise<Classification>
  catalog?: (workspace: WorkspaceEntry) => Promise<CatalogModel[]>
  usage?: () => ReturnType<typeof getUsageSnapshots>
  summary?: (workspacePath: string) => Promise<string>
  append?: (entry: RoutingDecisionLog) => Promise<void>
  lastChoice?: (
    workspacePath: string,
    restrictToAgent?: SessionAgent
  ) => Promise<RoutingDecisionLog['chosen'] | null>
  now?: () => number
}

function preview(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 120)
}

export async function fallbackRoute(
  input: RouteMessageInput,
  reason: string,
  dependencies: Pick<RouteDependencies, 'lastChoice'> = {}
): Promise<RouteDecision> {
  const last = await (dependencies.lastChoice ?? lastRoutedChoice)(
    input.workspace.path,
    input.isNew ? undefined : input.boundAgent
  ).catch(() => null)
  if (last) {
    return {
      agent: last.agent,
      model: last.model,
      label: last.label,
      reason: `${reason} — used ${last.label} (last used)`,
      fallback: reason,
      candidates: []
    }
  }
  if (!input.isNew && input.boundAgent) {
    return {
      agent: input.boundAgent,
      model: input.currentModel,
      label: input.currentModel ?? 'Default model',
      reason: `${reason} — kept this chat’s model`,
      fallback: reason,
      candidates: []
    }
  }
  return {
    agent: defaultSessionAgent(input.workspace.type),
    model: input.currentModel,
    label: input.currentModel ?? 'Default model',
    reason: `${reason} — used the workspace default`,
    fallback: reason,
    candidates: []
  }
}

export async function routeMessage(
  input: RouteMessageInput,
  dependencies: RouteDependencies = {}
): Promise<RouteDecision> {
  const started = (dependencies.now ?? Date.now)()
  const settings = getAppSettings().routing
  let decision: RouteDecision
  try {
    const summary = await (dependencies.summary ?? projectSummary)(input.workspace.path)
    const classification = await (
      dependencies.classify ??
      ((value: { message: string; project: string }) => classifyRoute(value, settings))
    )({ message: input.content, project: summary })
    const [catalog, snapshots] = await Promise.all([
      (dependencies.catalog ?? listModelCatalog)(input.workspace),
      (dependencies.usage ?? getUsageSnapshots)()
    ])
    const selection = selectRoute(
      classification,
      catalog,
      snapshots,
      settings.table,
      {
        claudeReservePercent: settings.claudeReservePercent,
        ...(!input.isNew && input.boundAgent ? { restrictToAgent: input.boundAgent } : {})
      },
      started
    )
    if (!selection) {
      decision = await fallbackRoute(input, 'No eligible model is available', dependencies)
      decision.classification = classification
      if (!input.isNew && input.boundAgent) {
        const unrestricted = selectRoute(
          classification,
          catalog,
          snapshots,
          settings.table,
          { claudeReservePercent: settings.claudeReservePercent },
          started
        )
        if (unrestricted) {
          decision.suggestion = {
            agent: unrestricted.row.agent,
            model: unrestricted.row.value,
            label: unrestricted.row.displayName || unrestricted.row.value
          }
        }
      }
    } else {
      decision = {
        agent: selection.row.agent,
        model: selection.row.value,
        label: selection.row.displayName || selection.row.value,
        reason: selection.reason,
        classification,
        candidates: selection.candidates,
        suggestion: selection.suggestion
      }
    }
  } catch {
    decision = await fallbackRoute(input, 'Routing unavailable', dependencies)
  }

  const entry: RoutingDecisionLog = {
    at: new Date(started).toISOString(),
    workspacePath: input.workspace.path,
    sessionId: input.sessionId,
    isNew: input.isNew,
    messagePreview: preview(input.content),
    classification: decision.classification,
    candidates: decision.candidates,
    chosen: { agent: decision.agent, model: decision.model, label: decision.label },
    reason: decision.reason,
    fallback: decision.fallback ?? null,
    suggestion: decision.suggestion ?? null,
    latencyMs: Math.max(0, (dependencies.now ?? Date.now)() - started)
  }
  await (dependencies.append ?? appendRoutingDecision)(entry).catch(() => {})
  return decision
}
