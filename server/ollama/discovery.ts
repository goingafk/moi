import type { OllamaServer } from '@/lib/types'

export type OllamaModel = {
  name: string
  supportsTools: boolean
  ready: boolean
}

type Fetcher = typeof fetch

const TIMEOUT_MS = 5_000
const CACHE_MS = 10_000
const cache = new Map<string, { at: number; models: OllamaModel[] }>()

function namesFrom(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !('models' in value) || !Array.isArray(value.models)) {
    throw new Error('Ollama returned an invalid model list')
  }
  return value.models
    .map((row: unknown) => {
      if (!row || typeof row !== 'object') return null
      if ('name' in row && typeof row.name === 'string') return row.name
      return 'model' in row ? row.model : null
    })
    .filter((name: unknown): name is string => typeof name === 'string' && name.length > 0)
}

async function json(fetcher: Fetcher, url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`)
  return response.json()
}

// /api/tags lists installed models, /api/ps lists the loaded subset, and
// /api/show is the authoritative source for capabilities. A failed show does
// not enable a model for agentic use: tool support is unknown, so fail closed.
export async function discoverOllamaModels(
  server: OllamaServer,
  fetcher: Fetcher = fetch
): Promise<OllamaModel[]> {
  const base = server.baseUrl.replace(/\/$/, '')
  const [tags, running] = await Promise.all([
    json(fetcher, `${base}/api/tags`),
    json(fetcher, `${base}/api/ps`).catch(() => ({ models: [] }))
  ])
  const names = [...new Set(namesFrom(tags))]
  const ready = new Set(namesFrom(running))
  return Promise.all(
    names.map(async name => {
      let supportsTools = false
      try {
        const show = await json(fetcher, `${base}/api/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: name })
        })
        if (show && typeof show === 'object' && 'capabilities' in show) {
          supportsTools = Array.isArray(show.capabilities) && show.capabilities.includes('tools')
        }
      } catch {
        // The picker may show the model but will disable it until metadata is available.
      }
      return { name, supportsTools, ready: ready.has(name) }
    })
  )
}

export async function cachedOllamaModels(
  server: OllamaServer,
  refresh = false,
  fetcher: Fetcher = fetch
): Promise<OllamaModel[]> {
  const key = `${server.id}:${server.baseUrl}`
  const hit = cache.get(key)
  if (!refresh && hit && Date.now() - hit.at < CACHE_MS) return hit.models
  const models = await discoverOllamaModels(server, fetcher)
  cache.set(key, { at: Date.now(), models })
  return models
}

export function clearOllamaModelCache(): void {
  cache.clear()
}
