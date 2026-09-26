import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { RoutingDecisionLog } from '@/lib/types'

import {
  appendRoutingDecision,
  DEFAULT_ROUTING_LOG_PATH,
  lastRoutedChoice,
  recentRoutingDecisions,
  setRoutingLogPath
} from './log'

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'moi-routing-log-'))
  setRoutingLogPath(join(dir, 'routing.jsonl'))
})
afterEach(async () => {
  setRoutingLogPath(DEFAULT_ROUTING_LOG_PATH)
  await rm(dir, { recursive: true, force: true })
})

test('appends bounded previews and finds the latest compatible choice', async () => {
  const base: RoutingDecisionLog = {
    at: new Date().toISOString(),
    workspacePath: '/one',
    sessionId: 's',
    isNew: true,
    messagePreview: 'hello',
    candidates: [],
    chosen: { agent: { type: 'codex' }, model: 'gpt', label: 'GPT' },
    reason: 'reason',
    fallback: null,
    suggestion: null,
    latencyMs: 1
  }
  await appendRoutingDecision(base)
  await appendRoutingDecision({
    ...base,
    chosen: { agent: { type: 'claude-code' }, model: 'sonnet', label: 'Sonnet' }
  })
  expect((await recentRoutingDecisions(1))[0].chosen.label).toBe('Sonnet')
  expect((await lastRoutedChoice('/one', { type: 'codex' }))?.label).toBe('GPT')
})
