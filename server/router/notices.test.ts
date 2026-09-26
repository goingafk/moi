import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_ROUTE_NOTICES_PATH,
  renameRouteNotices,
  routeNoticeEvents,
  saveRouteNotice,
  setRouteNoticesPath
} from './notices'

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'moi-route-notices-'))
  setRouteNoticesPath(join(dir, 'notices.json'))
})
afterEach(async () => {
  setRouteNoticesPath(DEFAULT_ROUTE_NOTICES_PATH)
  await rm(dir, { recursive: true, force: true })
})

test('route notices survive reload and follow a provider session rename', async () => {
  await saveRouteNotice('/workspace', 'temporary', {
    id: 'route:1',
    kind: 'route',
    at: '2026-09-26T12:00:00Z',
    agent: { type: 'codex' },
    model: 'gpt',
    label: 'GPT',
    reason: 'reason',
    message: 'request'
  })
  await renameRouteNotices('/workspace', 'temporary', 'real')
  expect(await routeNoticeEvents('/workspace', 'temporary')).toEqual([])
  expect(await routeNoticeEvents('/workspace', 'real')).toMatchObject([
    { kind: 'notice', notice: { id: 'route:1', kind: 'route' } }
  ])
})
