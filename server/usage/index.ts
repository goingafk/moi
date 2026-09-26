import type { MemoryUsage } from '@/lib/memory'
import type { OllamaServer, UsageOverview, UsageSnapshot } from '@/lib/types'

import { getAppSettings } from '../app-settings'
import { memoryApi, memoryServiceUrl } from '../memory/client'
import { cachedOllamaModels } from '../ollama/discovery'
import {
  type ClaudeRateLimitInfo,
  type CodexRateLimitsResponse,
  normaliseClaudeRateLimit,
  normaliseCodexRateLimits
} from './normalise'
import { getUsageSnapshots, saveUsageSnapshots } from './store'

const OLLAMA_STALE_MS = 2 * 60_000
// Jev 1.13 price verified from the official model page on 2026-09-25.
// Output tokens are free; callers still record them for observability.
const JEV_INPUT_USD_PER_MILLION = 0.042

export async function recordClaudeUsage(info: unknown): Promise<void> {
  if (!info || typeof info !== 'object' || Array.isArray(info)) return
  await saveUsageSnapshots([normaliseClaudeRateLimit(info as ClaudeRateLimitInfo)])
}

export async function recordCodexUsage(response: unknown): Promise<void> {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return
  const next = normaliseCodexRateLimits(response as CodexRateLimitsResponse)
  if (next.length) await saveUsageSnapshots(next)
}

function ollamaSnapshot(
  server: OllamaServer,
  input: { modelCount?: number; loadedModelCount?: number; available: boolean },
  observedAt = new Date().toISOString()
): UsageSnapshot {
  return {
    id: `ollama:${server.id}`,
    provider: 'ollama',
    label: `Ollama · ${server.name}`,
    kind: 'availability',
    status: input.available ? 'available' : 'unavailable',
    observedAt,
    staleAt: new Date(new Date(observedAt).valueOf() + OLLAMA_STALE_MS).toISOString(),
    ...(input.modelCount === undefined ? {} : { modelCount: input.modelCount }),
    ...(input.loadedModelCount === undefined ? {} : { loadedModelCount: input.loadedModelCount }),
    detail: input.available ? 'Local server' : 'Server unavailable'
  }
}

export async function refreshOllamaUsage(): Promise<void> {
  const next = await Promise.all(
    getAppSettings().ollamaServers.map(async server => {
      try {
        const models = await cachedOllamaModels(server, true)
        return ollamaSnapshot(server, {
          available: true,
          modelCount: models.length,
          loadedModelCount: models.filter(model => model.ready).length
        })
      } catch {
        return ollamaSnapshot(server, { available: false })
      }
    })
  )
  if (next.length) await saveUsageSnapshots(next)
}

// Phase 7 can call this after a Jev request. Pricing stays at the call site so
// a provider price change cannot silently rewrite historical spend.
export async function recordJevUsage(inputTokens: number, outputTokens: number): Promise<void> {
  if (
    !Number.isFinite(inputTokens) ||
    inputTokens < 0 ||
    !Number.isFinite(outputTokens) ||
    outputTokens < 0
  ) {
    return
  }
  const existing = (await getUsageSnapshots()).find(snapshot => snapshot.id === 'jev:local-spend')
  const observedAt = new Date().toISOString()
  const nextInputTokens = (existing?.inputTokens ?? 0) + inputTokens
  const nextOutputTokens = (existing?.outputTokens ?? 0) + outputTokens
  await saveUsageSnapshots([
    {
      id: 'jev:local-spend',
      provider: 'jev',
      label: 'Jev',
      kind: 'spend',
      status: 'available',
      spentUsd: (nextInputTokens / 1_000_000) * JEV_INPUT_USD_PER_MILLION,
      inputTokens: nextInputTokens,
      outputTokens: nextOutputTokens,
      observedAt,
      staleAt: '9999-12-31T23:59:59.999Z',
      detail: 'Local spend'
    }
  ])
}

// Jev calls made by the memory service (Phase 6). The service keeps cumulative
// token totals; moi prices them here, next to the local router's spend.
const MEMORY_USAGE_STALE_MS = 15 * 60_000

export async function refreshMemoryJevUsage(): Promise<void> {
  if (!memoryServiceUrl()) return
  let usage: MemoryUsage
  try {
    usage = await memoryApi.usage(2_000)
  } catch {
    return // keep the last observation; it goes stale on its own
  }
  if (usage.jev.requests === 0) return
  const observedAt = new Date().toISOString()
  await saveUsageSnapshots([
    {
      id: 'jev:memory-service',
      provider: 'jev',
      label: 'Jev · memory',
      kind: 'spend',
      status: 'available',
      spentUsd: (usage.jev.inputTokens / 1_000_000) * JEV_INPUT_USD_PER_MILLION,
      inputTokens: usage.jev.inputTokens,
      outputTokens: usage.jev.outputTokens,
      observedAt,
      staleAt: new Date(Date.parse(observedAt) + MEMORY_USAGE_STALE_MS).toISOString(),
      detail: `Memory scoring · ${usage.jev.requests} requests`
    }
  ])
}

export async function usageOverview(refresh = false): Promise<UsageOverview> {
  if (refresh) await Promise.all([refreshOllamaUsage(), refreshMemoryJevUsage()])
  const generatedAt = new Date().toISOString()
  const snapshots = await getUsageSnapshots()
  const placeholders: UsageSnapshot[] = [
    ['claude', 'Claude'],
    ['codex', 'Codex'],
    ['jev', 'Jev']
  ]
    .filter(([provider]) => !snapshots.some(snapshot => snapshot.provider === provider))
    .map(([provider, label]) => ({
      id: `${provider}:unobserved`,
      provider: provider as 'claude' | 'codex' | 'jev',
      label,
      kind: provider === 'jev' ? 'spend' : 'quota',
      status: 'unknown',
      observedAt: generatedAt,
      staleAt: '9999-12-31T23:59:59.999Z',
      stale: false,
      detail: provider === 'jev' ? 'No local requests yet' : 'Waiting for provider data'
    }))
  return { snapshots: [...snapshots, ...placeholders], generatedAt }
}
