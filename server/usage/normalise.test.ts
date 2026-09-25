import { describe, expect, test } from 'bun:test'

import claudeFixture from './fixtures/claude-rate-limit.json'
import codexFixture from './fixtures/codex-rate-limits.json'
import { markUsageStaleness, normaliseClaudeRateLimit, normaliseCodexRateLimits } from './normalise'

const OBSERVED = '2026-09-25T12:00:00.000Z'

describe('usage normalisation', () => {
  test('normalises Claude status, ratio utilization, and Unix reset seconds', () => {
    expect(normaliseClaudeRateLimit(claudeFixture.payload, OBSERVED)).toEqual(
      expect.objectContaining({
        id: 'claude:five_hour',
        provider: 'claude',
        status: 'warning',
        window: '5 hours',
        usedPercent: 82,
        resetsAt: '2026-09-26T02:41:44.000Z',
        observedAt: OBSERVED
      })
    )
  })

  test('normalises both Codex windows from a captured app-server payload', () => {
    const snapshots = normaliseCodexRateLimits(codexFixture.payload, OBSERVED)
    expect(snapshots).toHaveLength(2)
    expect(snapshots.map(snapshot => [snapshot.window, snapshot.usedPercent])).toEqual([
      ['5 hours', 31],
      ['1 week', 5]
    ])
    expect(snapshots[0]).toEqual(
      expect.objectContaining({
        id: 'codex:account-redacted:codex:primary',
        status: 'available',
        resetsAt: '2026-09-26T02:41:44.000Z',
        detail: 'plus plan'
      })
    )
  })

  test('marks snapshots stale at their provider deadline without changing observations', () => {
    const snapshot = normaliseClaudeRateLimit(claudeFixture.payload, OBSERVED)
    expect(markUsageStaleness([snapshot], new Date(OBSERVED).valueOf() + 899_999)[0].stale).toBe(
      false
    )
    expect(markUsageStaleness([snapshot], new Date(OBSERVED).valueOf() + 900_000)[0].stale).toBe(
      true
    )
  })

  test('fails closed on unknown and exhausted quota states', () => {
    expect(normaliseClaudeRateLimit({ status: 'other' }, OBSERVED).status).toBe('unknown')
    expect(
      normaliseCodexRateLimits(
        {
          rateLimits: {
            primary: { usedPercent: 100 },
            secondary: null,
            rateLimitReachedType: 'rate_limit_reached'
          }
        },
        OBSERVED
      )[0].status
    ).toBe('exhausted')
  })
})
