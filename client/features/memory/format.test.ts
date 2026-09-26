import { describe, expect, test } from 'bun:test'

import type { MemoryEntry } from '@/lib/memory'

import { memoryMeta, relativeTime } from './format'

const NOW = Date.UTC(2026, 8, 26, 12)

const entry: MemoryEntry = {
  id: 'm1',
  scope: 'project',
  projectKey: 'github.com/goingafk/moi',
  sessionId: null,
  text: 'Use Bun.serve',
  pinned: false,
  importance: 0.7,
  relevance: 0.82,
  relevanceConfidence: 0.9,
  relevanceScoredAt: NOW,
  useCount: 3,
  lastUsedAt: NOW,
  createdAt: NOW - 3 * 86_400_000,
  updatedAt: NOW - 2 * 3_600_000,
  status: 'active',
  supersededBy: null,
  supersededAt: null,
  provenance: { agent: 'codex', model: null, machine: 'lxc' },
  activation: 1.2
}

describe('memoryMeta', () => {
  test('summarises scope, relevance, uses, source and age', () => {
    expect(memoryMeta(entry, NOW)).toBe(
      'github.com/goingafk/moi · Relevance 82% · 3 uses · From codex on lxc · 2 h ago'
    )
  })

  test('archived, unscored global entry', () => {
    expect(
      memoryMeta(
        {
          ...entry,
          scope: 'global',
          projectKey: null,
          status: 'evicted',
          relevance: null,
          useCount: 1,
          provenance: { agent: null, model: null, machine: null }
        },
        NOW
      )
    ).toBe('All projects · Archived · Relevance not scored · 1 use · 2 h ago')
  })

  test('path projects drop the prefix', () => {
    expect(memoryMeta({ ...entry, projectKey: 'path:/srv/app' }, NOW)).toStartWith('/srv/app ·')
  })
})

describe('relativeTime', () => {
  test.each([
    [NOW - 10_000, 'just now'],
    [NOW - 5 * 60_000, '5 min ago'],
    [NOW - 3 * 3_600_000, '3 h ago'],
    [NOW - 30 * 3_600_000, 'yesterday'],
    [NOW - 5 * 86_400_000, '5 days ago']
  ])('%p → %s', (at, label) => {
    expect(relativeTime(at, NOW)).toBe(label)
  })
})
