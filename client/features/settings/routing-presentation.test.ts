import { expect, test } from 'bun:test'

import { routingDecisionSummary } from './routing-presentation'

test('formats a compact routing decision summary', () => {
  expect(
    routingDecisionSummary({
      at: '2026-09-26T12:00:00Z',
      workspacePath: '/one',
      sessionId: 's',
      isNew: true,
      messagePreview: 'Fix it',
      classification: { difficulty: 'hard', kind: 'debug', confidence: 0.8, classifier: 'jev' },
      candidates: [],
      chosen: { agent: { type: 'codex' }, model: 'gpt', label: 'GPT' },
      reason: 'OpenAI resets soon',
      fallback: null,
      suggestion: null,
      latencyMs: 4
    })
  ).toBe('debug, hard · GPT · OpenAI resets soon')
})
