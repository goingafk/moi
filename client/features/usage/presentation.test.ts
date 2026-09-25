import { expect, test } from 'bun:test'

import type { UsageSnapshot } from '@/lib/types'

import { resetLabel, usageFreshness, usageSummary } from './presentation'

const snapshot: UsageSnapshot = {
  id: 'codex:primary',
  provider: 'codex',
  label: 'Codex',
  kind: 'quota',
  status: 'available',
  usedPercent: 31,
  resetsAt: '2026-09-25T14:00:00.000Z',
  observedAt: '2026-09-25T12:00:00.000Z',
  staleAt: '2026-09-25T12:15:00.000Z'
}

test('formats quota, reset, and freshness copy', () => {
  const now = new Date('2026-09-25T12:03:00.000Z').valueOf()
  expect(usageSummary(snapshot)).toBe('31% used · 69% left')
  expect(resetLabel(snapshot, now)).toBe('Resets in 2 hr')
  expect(usageFreshness(snapshot, now)).toBe('as of 3 min ago')
})

test('formats Ollama availability without implying a quota', () => {
  expect(
    usageSummary({
      ...snapshot,
      provider: 'ollama',
      kind: 'availability',
      modelCount: 4,
      loadedModelCount: 1
    })
  ).toBe('1 loaded · 4 installed')
})

test('uses an unobserved provider detail instead of implying measured spend', () => {
  expect(
    usageSummary({
      ...snapshot,
      provider: 'jev',
      kind: 'spend',
      status: 'unknown',
      detail: 'No local requests yet'
    })
  ).toBe('No local requests yet')
})
