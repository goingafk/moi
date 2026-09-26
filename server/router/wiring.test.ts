import { expect, test } from 'bun:test'

import { routingModeForSend } from './wiring'

test('new chats inherit or override the global mode and follow-ups use persisted state', () => {
  expect(routingModeForSend({ config: {}, isNew: true, defaultMode: 'auto' })).toBe('auto')
  expect(
    routingModeForSend({ config: {}, isNew: true, requested: 'manual', defaultMode: 'auto' })
  ).toBe('manual')
  expect(
    routingModeForSend({ config: {}, isNew: false, requested: 'auto', defaultMode: 'auto' })
  ).toBe('manual')
  expect(
    routingModeForSend({ config: { routing: 'auto' }, isNew: false, defaultMode: 'manual' })
  ).toBe('auto')
})
