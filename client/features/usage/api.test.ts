import { expect, test } from 'bun:test'

import type { UsageOverview, UsageSnapshot } from '@/lib/types'

import { mergeUsageSnapshots } from './api'

const observedAt = '2026-09-25T12:00:00.000Z'
const staleAt = '2026-09-25T12:15:00.000Z'

test('a live provider observation replaces its initial placeholder', () => {
  const placeholder: UsageSnapshot = {
    id: 'codex:unobserved',
    provider: 'codex',
    label: 'Codex',
    kind: 'quota',
    status: 'unknown',
    observedAt,
    staleAt
  }
  const current: UsageOverview = { snapshots: [placeholder], generatedAt: observedAt }
  const primary: UsageSnapshot = {
    ...placeholder,
    id: 'codex:account:codex:primary',
    status: 'available',
    usedPercent: 31
  }

  expect(mergeUsageSnapshots(current, [primary]).snapshots).toEqual([primary])
})
