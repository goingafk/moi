import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { DATA_DIR } from '../data-dir'
import { getUsageSnapshots, saveUsageSnapshots, setUsageStorePath } from './store'

let temporaryDir: string | undefined

afterEach(async () => {
  setUsageStorePath(join(DATA_DIR, 'usage-snapshots.json'))
  if (temporaryDir) await rm(temporaryDir, { recursive: true, force: true })
  temporaryDir = undefined
})

test('persists and replaces the latest observation for each usage id', async () => {
  temporaryDir = await mkdtemp(join(tmpdir(), 'moi-usage-'))
  const path = join(temporaryDir, 'nested', 'usage-snapshots.json')
  setUsageStorePath(path)
  const base = {
    id: 'claude:five_hour',
    provider: 'claude' as const,
    label: 'Claude',
    kind: 'quota' as const,
    status: 'available' as const,
    observedAt: '2026-09-25T12:00:00.000Z',
    staleAt: '2026-09-25T12:15:00.000Z'
  }
  await saveUsageSnapshots([{ ...base, usedPercent: 20 }])
  await saveUsageSnapshots([{ ...base, usedPercent: 30 }])

  setUsageStorePath(path)
  expect(await getUsageSnapshots(new Date('2026-09-25T12:01:00.000Z').valueOf())).toEqual([
    { ...base, usedPercent: 30, stale: false }
  ])
})
