import { mkdir, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { UsageSnapshot } from '@/lib/types'

import { DATA_DIR } from '../data-dir'
import { publishEvent } from '../events'
import { markUsageStaleness } from './normalise'

let storePath = join(DATA_DIR, 'usage-snapshots.json')
let loadedPath: string | null = null
let snapshots = new Map<string, UsageSnapshot>()
let writeQueue = Promise.resolve()

export function setUsageStorePath(path: string): void {
  storePath = path
  loadedPath = null
  snapshots = new Map()
  writeQueue = Promise.resolve()
}

async function load(): Promise<void> {
  if (loadedPath === storePath) return
  loadedPath = storePath
  snapshots = new Map()
  try {
    const parsed: unknown = await Bun.file(storePath).json()
    if (!Array.isArray(parsed)) return
    for (const row of parsed) {
      if (!row || typeof row !== 'object' || !('id' in row) || typeof row.id !== 'string') continue
      snapshots.set(row.id, row as UsageSnapshot)
    }
  } catch {
    // A missing or malformed cache starts empty. The next provider update
    // replaces it; usage data is observational, not authoritative state.
  }
}

async function persist(): Promise<void> {
  await mkdir(dirname(storePath), { recursive: true })
  const temporaryPath = `${storePath}.${process.pid}.tmp`
  await Bun.write(temporaryPath, `${JSON.stringify([...snapshots.values()], null, 2)}\n`)
  await rename(temporaryPath, storePath)
}

export async function saveUsageSnapshots(next: UsageSnapshot[]): Promise<void> {
  await load()
  for (const snapshot of next) snapshots.set(snapshot.id, snapshot)
  writeQueue = writeQueue.then(persist, persist)
  await writeQueue
  publishEvent({ type: 'usage:updated', snapshots: markUsageStaleness(next) })
}

export async function getUsageSnapshots(now = Date.now()): Promise<UsageSnapshot[]> {
  await load()
  return markUsageStaleness([...snapshots.values()], now).sort((a, b) => {
    const providers = ['claude', 'codex', 'ollama', 'jev']
    return providers.indexOf(a.provider) - providers.indexOf(b.provider) || a.id.localeCompare(b.id)
  })
}
