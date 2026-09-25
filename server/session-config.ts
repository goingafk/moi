import { mkdir, rename } from 'node:fs/promises'
import { join } from 'path'

import type { PermissionMode, SessionAgent, SessionConfig } from '@/lib/types'
import { isSessionAgent, sameSessionAgent } from '@/lib/session-agent'

import { DATA_DIR } from './data-dir'

// Per-session model/effort/Fast-mode overrides. Stored OUTSIDE
// the user's workspace (no repo churn) in ONE global JSON file in moi's data
// dir, alongside the workspace registry. Keyed by workspace path then sessionId:
//   { "<workspacePath>": { "<sessionId>": { model?, effort?, fastMode? } } }
// Path (not registry id) is the key so config survives re-registration and lines
// up with the SDK's path-based session storage.

// A patch may clear a field with `null` (vs `undefined`, which leaves it alone).
export type SessionConfigPatch = {
  agent?: SessionAgent
  permissionMode?: PermissionMode
  model?: string | null
  effort?: string | null
  fastMode?: boolean | null
}

type Store = Record<string, Record<string, SessionConfig>>

export const DEFAULT_SESSION_CONFIG_PATH = join(DATA_DIR, 'session-config.json')

let storePath = DEFAULT_SESSION_CONFIG_PATH

// Test seam: point the store at a scratch file (mirrors registry.setRegistryPath).
export function setSessionConfigPath(path: string): void {
  storePath = path
}

function clean(cfg: SessionConfig | undefined): SessionConfig {
  const out: SessionConfig = {}
  if (isSessionAgent(cfg?.agent)) out.agent = cfg.agent
  if (
    cfg?.permissionMode === 'auto' ||
    cfg?.permissionMode === 'ask-risky' ||
    cfg?.permissionMode === 'ask-all'
  )
    out.permissionMode = cfg.permissionMode
  if (typeof cfg?.model === 'string') out.model = cfg.model
  if (typeof cfg?.effort === 'string') out.effort = cfg.effort
  if (typeof cfg?.fastMode === 'boolean') out.fastMode = cfg.fastMode
  return out
}

function isEmpty(cfg: SessionConfig): boolean {
  return (
    cfg.agent === undefined &&
    cfg.permissionMode === undefined &&
    cfg.model === undefined &&
    cfg.effort === undefined &&
    cfg.fastMode === undefined
  )
}

async function readStoreFile(path: string): Promise<Store | null> {
  try {
    const parsed = JSON.parse(await Bun.file(path).text())
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {}
  } catch {
    return null
  }
}

async function writeStore(store: Store): Promise<void> {
  await mkdir(join(storePath, '..'), { recursive: true })
  const tmp = `${storePath}.${process.pid}.tmp`
  await Bun.write(tmp, JSON.stringify(store, null, 2))
  await rename(tmp, storePath)
}

async function readStore(): Promise<Store> {
  return (await readStoreFile(storePath)) ?? {}
}

// Serialize read-modify-write so concurrent save/rename calls can't clobber the
// single shared file (last writer would otherwise drop the other's update).
let writeChain: Promise<unknown> = Promise.resolve()
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn)
  writeChain = run.catch(() => {})
  return run
}

export async function getSessionConfig(
  workspacePath: string,
  sessionId: string
): Promise<SessionConfig> {
  return locked(async () => {
    const store = await readStore()
    return clean(store[workspacePath]?.[sessionId])
  })
}

export async function getSessionConfigs(
  workspacePath: string
): Promise<Record<string, SessionConfig>> {
  return locked(async () => {
    const store = await readStore()
    return Object.fromEntries(
      Object.entries(store[workspacePath] ?? {}).map(([id, config]) => [id, clean(config)])
    )
  })
}

// Bind discovered provider-owned histories in one write. Existing bindings
// win; a session ID that was intentionally assigned elsewhere is never moved.
export async function bindDiscoveredSessionAgents(
  workspacePath: string,
  bindings: readonly { sessionId: string; agent: SessionAgent }[]
): Promise<void> {
  if (bindings.length === 0) return
  await locked(async () => {
    const store = await readStore()
    const sessions = store[workspacePath] ?? {}
    let changed = false
    for (const { sessionId, agent } of bindings) {
      const current = clean(sessions[sessionId])
      if (current.agent) continue
      sessions[sessionId] = { ...current, agent }
      changed = true
    }
    if (!changed) return
    store[workspacePath] = sessions
    await writeStore(store)
  })
}

export async function hasSessionConfig(workspacePath: string, sessionId: string): Promise<boolean> {
  const config = await getSessionConfig(workspacePath, sessionId)
  return config.model !== undefined || config.effort !== undefined || config.fastMode !== undefined
}

// Merge a patch over the stored config and write it back. `null` clears a field,
// `undefined` leaves it untouched, and a typed value sets it. An emptied entry
// is dropped to keep the file tidy. Returns the merged config.
export async function saveSessionConfig(
  workspacePath: string,
  sessionId: string,
  patch: SessionConfigPatch
): Promise<SessionConfig> {
  return locked(async () => {
    const store = await readStore()
    const sessions = store[workspacePath] ?? {}
    const next = clean(sessions[sessionId])
    if (patch.agent) {
      if (next.agent && !sameSessionAgent(next.agent, patch.agent)) {
        throw new Error('A chat cannot change agents; start a new chat instead')
      }
      next.agent = patch.agent
    }
    if (patch.permissionMode) next.permissionMode = patch.permissionMode
    for (const key of ['model', 'effort'] as const) {
      const value = patch[key]
      if (value === undefined) continue
      if (value === null) delete next[key]
      else next[key] = value
    }
    if (patch.fastMode === null) delete next.fastMode
    else if (patch.fastMode !== undefined) next.fastMode = patch.fastMode
    if (isEmpty(next)) delete sessions[sessionId]
    else sessions[sessionId] = next
    if (Object.keys(sessions).length === 0) delete store[workspacePath]
    else store[workspacePath] = sessions
    await writeStore(store)
    return next
  })
}

// Move a session's config from one id to another (temp id → SDK real id on
// rename). Merges onto whatever the destination already holds (destination wins,
// so a concurrent write under the real id isn't lost) and removes the source.
export async function renameSessionConfig(
  workspacePath: string,
  from: string,
  to: string
): Promise<void> {
  if (from === to) return
  await locked(async () => {
    const store = await readStore()
    const sessions = store[workspacePath]
    const src = clean(sessions?.[from])
    if (isEmpty(src)) return
    sessions![to] = { ...src, ...clean(sessions![to]) }
    delete sessions![from]
    store[workspacePath] = sessions!
    await writeStore(store)
  })
}
