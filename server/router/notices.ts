import { mkdir, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { StreamEvent, SystemNotice } from '@/lib/types'

import { DATA_DIR } from '../data-dir'

type Store = Record<string, Record<string, SystemNotice[]>>

export const DEFAULT_ROUTE_NOTICES_PATH = join(DATA_DIR, 'route-notices.json')
let storePath = DEFAULT_ROUTE_NOTICES_PATH
let writeChain: Promise<unknown> = Promise.resolve()

export function setRouteNoticesPath(path: string): void {
  storePath = path
  writeChain = Promise.resolve()
}

async function readStore(): Promise<Store> {
  try {
    const value: unknown = await Bun.file(storePath).json()
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Store) : {}
  } catch {
    return {}
  }
}

async function writeStore(store: Store): Promise<void> {
  await mkdir(dirname(storePath), { recursive: true })
  const temporary = `${storePath}.${process.pid}.tmp`
  await Bun.write(temporary, `${JSON.stringify(store, null, 2)}\n`)
  await rename(temporary, storePath)
}

export async function saveRouteNotice(
  workspacePath: string,
  sessionId: string,
  notice: Extract<SystemNotice, { kind: 'route' }>
): Promise<void> {
  const run = writeChain.then(async () => {
    const store = await readStore()
    const sessions = store[workspacePath] ?? {}
    sessions[sessionId] = [...(sessions[sessionId] ?? []), notice].slice(-200)
    store[workspacePath] = sessions
    await writeStore(store)
  })
  writeChain = run.catch(() => {})
  await run
}

export async function routeNoticeEvents(
  workspacePath: string,
  sessionId: string
): Promise<StreamEvent[]> {
  const store = await readStore()
  return (store[workspacePath]?.[sessionId] ?? []).map(notice => ({ kind: 'notice', notice }))
}

export async function renameRouteNotices(
  workspacePath: string,
  from: string,
  to: string
): Promise<void> {
  if (from === to) return
  const run = writeChain.then(async () => {
    const store = await readStore()
    const sessions = store[workspacePath]
    if (!sessions?.[from]) return
    sessions[to] = [...(sessions[to] ?? []), ...sessions[from]].slice(-200)
    delete sessions[from]
    await writeStore(store)
  })
  writeChain = run.catch(() => {})
  await run
}
