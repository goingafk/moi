// HTTP client for the memory service (separate repo `memory-service`; wire
// shapes in lib/memory.ts). Every call has a timeout. The digest path uses a
// short one and never throws, so a slow or missing service can delay a chat
// send by at most DIGEST_TIMEOUT_MS and never block it.

import type {
  MemoryConfigPatch,
  MemoryDigest,
  MemoryEntry,
  MemoryEntryPatch,
  MemoryList,
  MemoryRememberResult,
  MemoryScope,
  MemoryServiceConfig,
  MemoryUsage
} from '@/lib/memory'

import { getAppSettings } from '../app-settings'

export const DIGEST_TIMEOUT_MS = 800
const REQUEST_TIMEOUT_MS = 10_000

export class MemoryServiceError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export function memoryServiceUrl(): string | null {
  return getAppSettings().memory.url?.replace(/\/+$/, '') || null
}

type RequestOptions = { method?: string; body?: unknown; timeoutMs?: number }

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const base = memoryServiceUrl()
  if (!base) throw new MemoryServiceError('Memory is off: no memory service URL is set.', 409)
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      method: options.method ?? 'GET',
      headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
      redirect: 'error'
    })
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'is unreachable'
    throw new MemoryServiceError(`The memory service at ${base} ${reason}.`, 502)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!res.ok) {
    let message = text.trim() || `HTTP ${res.status}`
    try {
      const parsed = JSON.parse(text) as { error?: unknown }
      if (typeof parsed.error === 'string') message = parsed.error
    } catch {}
    // Auth refusals from the service are a moi configuration problem, not the user's input.
    const status = res.status === 401 || res.status === 403 ? 502 : res.status
    throw new MemoryServiceError(
      res.status === 401 || res.status === 403
        ? `The memory service refused moi (${message.trim()}). Add this machine's Tailscale IP to its allowedIps.`
        : message,
      status
    )
  }
  return JSON.parse(text) as T
}

export async function fetchDigest(input: {
  project: string
  sessionId: string | null
  message: string
  limit?: number
}): Promise<MemoryDigest | null> {
  if (!memoryServiceUrl()) return null
  try {
    return await request<MemoryDigest>('/v1/digest', {
      method: 'POST',
      body: input,
      timeoutMs: DIGEST_TIMEOUT_MS
    })
  } catch (error) {
    console.warn(`[memory] digest skipped: ${(error as Error).message}`)
    return null
  }
}

export const memoryApi = {
  config: () => request<MemoryServiceConfig>('/v1/config'),
  updateConfig: (patch: MemoryConfigPatch) =>
    request<MemoryServiceConfig>('/v1/config', { method: 'PATCH', body: patch }),
  list: (query: URLSearchParams) => request<MemoryList>(`/v1/memories?${query}`),
  remember: (body: {
    text: string
    scope: MemoryScope
    project?: string
    sessionId?: string
    provenance: { agent: string | null; model: string | null; machine: string | null }
  }) => request<MemoryRememberResult>('/v1/memories', { method: 'POST', body }),
  update: (id: string, patch: MemoryEntryPatch) =>
    request<MemoryEntry>(`/v1/memories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch
    }),
  remove: (id: string) =>
    request<void>(`/v1/memories/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  usage: (timeoutMs?: number) => request<MemoryUsage>('/v1/usage', { timeoutMs })
}
