import { describe, expect, test } from 'bun:test'

import type {
  CatalogModel,
  EligibilityTable,
  RoutingClassification,
  UsageSnapshot
} from '@/lib/types'

import { selectRoute } from './select'

const table: EligibilityTable = {
  trivial: [
    [{ agent: 'ollama' }],
    [
      { agent: 'claude-code', match: 'haiku' },
      { agent: 'codex', match: 'luna' }
    ]
  ],
  medium: [
    [
      { agent: 'claude-code', match: 'sonnet' },
      { agent: 'codex', match: 'sol' }
    ]
  ],
  hard: [
    [
      { agent: 'claude-code', match: 'opus' },
      { agent: 'codex', match: 'astra' }
    ]
  ]
}
const models: CatalogModel[] = [
  {
    selectionId: 'local',
    value: 'qwen',
    displayName: 'Qwen',
    group: 'Ollama — Home',
    agent: { type: 'ollama', serverId: 'home' },
    ready: true
  },
  { selectionId: 'haiku', value: 'haiku', displayName: 'Haiku', agent: { type: 'claude-code' } },
  { selectionId: 'sonnet', value: 'sonnet', displayName: 'Sonnet', agent: { type: 'claude-code' } },
  { selectionId: 'opus', value: 'opus', displayName: 'Opus', agent: { type: 'claude-code' } },
  { selectionId: 'luna', value: 'gpt-6-luna', displayName: 'Luna', agent: { type: 'codex' } },
  { selectionId: 'sol', value: 'gpt-6-sol', displayName: 'Sol', agent: { type: 'codex' } },
  { selectionId: 'astra', value: 'gpt-6-astra', displayName: 'Astra', agent: { type: 'codex' } }
]
const now = Date.parse('2026-09-26T12:00:00Z')
const classify = (difficulty: RoutingClassification['difficulty']): RoutingClassification => ({
  difficulty,
  kind: 'refactor',
  confidence: 0.9,
  classifier: 'jev'
})
const quota = (
  provider: 'claude' | 'codex',
  usedPercent: number,
  resetHours: number,
  status: UsageSnapshot['status'] = 'available'
): UsageSnapshot => ({
  id: `${provider}:five-hour`,
  provider,
  label: provider === 'claude' ? 'Claude' : 'OpenAI',
  kind: 'quota',
  status,
  usedPercent,
  resetsAt: new Date(now + resetHours * 3_600_000).toISOString(),
  observedAt: new Date(now).toISOString(),
  staleAt: new Date(now + 60_000).toISOString(),
  stale: false
})

describe('route selection', () => {
  test('uses warm local for trivial work and a cold local when it is the only local choice', () => {
    expect(
      selectRoute(classify('trivial'), models, [], table, { claudeReservePercent: 70 }, now)?.row
        .selectionId
    ).toBe('local')
    const cold = models.map(row => (row.selectionId === 'local' ? { ...row, ready: false } : row))
    expect(
      selectRoute(classify('trivial'), cold, [], table, { claudeReservePercent: 70 }, now)?.row
        .selectionId
    ).toBe('local')
  })

  test('skips unavailable local and reserves heavily-used Claude', () => {
    const usage = [
      {
        id: 'ollama:home',
        provider: 'ollama',
        label: 'Home',
        kind: 'availability',
        status: 'unavailable',
        observedAt: new Date(now).toISOString(),
        staleAt: new Date(now + 1).toISOString(),
        stale: false
      } as UsageSnapshot,
      quota('claude', 80, 5),
      quota('codex', 40, 5)
    ]
    expect(
      selectRoute(classify('trivial'), models, usage, table, { claudeReservePercent: 70 }, now)?.row
        .selectionId
    ).toBe('luna')
    expect(
      selectRoute(classify('medium'), models, usage, table, { claudeReservePercent: 70 }, now)?.row
        .selectionId
    ).toBe('sol')
  })

  test('spends healthy quota that resets sooner and skips exhausted providers', () => {
    expect(
      selectRoute(
        classify('medium'),
        models,
        [quota('claude', 30, 5), quota('codex', 40, 1 / 3)],
        table,
        { claudeReservePercent: 70 },
        now
      )?.row.selectionId
    ).toBe('sol')
    expect(
      selectRoute(
        classify('hard'),
        models,
        [quota('claude', 10, 5, 'exhausted'), quota('codex', 80, 5)],
        table,
        { claudeReservePercent: 70 },
        now
      )?.row.selectionId
    ).toBe('astra')
  })

  test('treats stale usage as neutral, escalates empty tiers, and can return null', () => {
    const stale = { ...quota('claude', 99, 1), stale: true }
    expect(
      selectRoute(
        classify('medium'),
        models,
        [stale, quota('codex', 60, 10)],
        table,
        { claudeReservePercent: 70 },
        now
      )?.row.selectionId
    ).toBe('sonnet')
    expect(
      selectRoute(
        classify('trivial'),
        models.filter(row => row.selectionId === 'sonnet'),
        [],
        table,
        { claudeReservePercent: 70 },
        now
      )?.row.selectionId
    ).toBe('sonnet')
    expect(
      selectRoute(classify('hard'), [], [], table, { claudeReservePercent: 70 }, now)
    ).toBeNull()
  })

  test('restricts follow-ups and suggests a better group on another agent', () => {
    const selected = selectRoute(
      classify('trivial'),
      models,
      [],
      table,
      { claudeReservePercent: 70, restrictToAgent: { type: 'codex' } },
      now
    )
    expect(selected?.row.selectionId).toBe('luna')
    expect(selected?.suggestion).toMatchObject({ agent: { type: 'ollama' }, model: 'qwen' })
    expect(selected?.reason).toContain('refactor, trivial')
  })
})
