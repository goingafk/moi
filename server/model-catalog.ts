import type { CatalogModel, Model, SessionAgent, WorkspaceEntry } from '@/lib/types'

import { getAppSettings } from './app-settings'
import { harnessFor } from './harness/registry'
import { cachedOllamaModels } from './ollama/discovery'

export function catalogSelectionId(agent: SessionAgent, model: string): string {
  return `${agent.type}:${agent.type === 'ollama' ? `${agent.serverId}:` : ''}${encodeURIComponent(model)}`
}

export function catalogRows(agent: SessionAgent, group: string, models: Model[]): CatalogModel[] {
  return models
    .filter(model => model.value !== 'default')
    .map(model => ({
      ...model,
      group,
      agent,
      selectionId: catalogSelectionId(agent, model.value)
    }))
}

export async function listModelCatalog(
  ws: WorkspaceEntry,
  refresh = false
): Promise<CatalogModel[]> {
  const settings = getAppSettings()
  const entries = await Promise.all([
    ...(['claude-code', 'codex'] as const).map(async type => {
      const models = await harnessFor(type)
        .listModels(ws)
        .catch(() => [])
      return catalogRows({ type }, type === 'codex' ? 'Codex' : 'Claude', models)
    }),
    ...settings.ollamaServers.map(async server => {
      try {
        const models = await cachedOllamaModels(server, refresh)
        const agent: SessionAgent = { type: 'ollama', serverId: server.id }
        return models.map(model => ({
          value: model.name,
          displayName: model.name,
          group: `Ollama — ${server.name}`,
          agent,
          selectionId: catalogSelectionId(agent, model.name),
          ready: model.ready,
          ...(model.supportsTools ? {} : { disabledReason: 'This model does not support tools' })
        }))
      } catch {
        return []
      }
    })
  ])
  return entries.flat()
}
