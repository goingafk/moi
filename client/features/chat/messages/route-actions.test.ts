import { expect, test } from 'bun:test'

import type { SystemNotice } from '@/lib/types'

import { routeContinuation, routeOverridePatch } from './route-actions'

const notice: Extract<SystemNotice, { kind: 'route' }> = {
  id: 'route:1',
  kind: 'route',
  at: new Date().toISOString(),
  agent: { type: 'codex' },
  model: 'gpt',
  label: 'GPT',
  reason: 'reason',
  message: 'Fix it',
  suggestion: { agent: { type: 'ollama', serverId: 'home' }, model: 'qwen', label: 'Qwen' }
}

test('route actions switch the current chat to manual or prepare a suggested chat', () => {
  expect(routeOverridePatch(notice)).toEqual({ routing: 'manual', model: 'gpt' })
  expect(routeContinuation(notice)).toEqual({
    agent: notice.suggestion!.agent,
    model: 'qwen',
    message: 'Fix it'
  })
})
