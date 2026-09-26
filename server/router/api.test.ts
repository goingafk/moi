import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { api } from '../api'
import {
  resetAppSecretStoreForTest,
  setAppSecretStoreBackend,
  setAppSecretStorePath
} from '../app-secrets'
import { DATA_DIR } from '../data-dir'
import { setAppSettingsDir } from '../app-settings'
import { appendRoutingDecision, DEFAULT_ROUTING_LOG_PATH, setRoutingLogPath } from './log'

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'moi-routing-api-'))
  setAppSettingsDir(dir)
  setAppSecretStorePath(join(dir, 'secrets.json'))
  setAppSecretStoreBackend('file')
  setRoutingLogPath(join(dir, 'decisions.jsonl'))
})
afterEach(async () => {
  setAppSettingsDir(DATA_DIR)
  resetAppSecretStoreForTest()
  setRoutingLogPath(DEFAULT_ROUTING_LOG_PATH)
  await rm(dir, { recursive: true, force: true })
})

test('routing credential API never returns the TypeSafe key', async () => {
  const saved = await api.request('/api/routing/typesafe-key', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'top-secret' })
  })
  expect(saved.status).toBe(200)
  expect(await saved.text()).not.toContain('top-secret')
  expect(await (await api.request('/api/routing/status')).json()).toEqual({
    jevKeySet: true,
    layaConfigured: false
  })
  expect((await api.request('/api/routing/typesafe-key', { method: 'DELETE' })).status).toBe(204)
})

test('routing decisions endpoint limits output and shortens previews', async () => {
  for (let index = 0; index < 3; index += 1) {
    await appendRoutingDecision({
      at: `2026-09-26T12:00:0${index}Z`,
      workspacePath: '/workspace',
      sessionId: String(index),
      isNew: true,
      messagePreview: 'x'.repeat(120),
      candidates: [],
      chosen: { agent: { type: 'codex' }, model: 'gpt', label: 'GPT' },
      reason: 'reason',
      fallback: null,
      suggestion: null,
      latencyMs: 1
    })
  }
  const entries = (await (await api.request('/api/routing/decisions?limit=2')).json()) as {
    messagePreview: string
  }[]
  expect(entries).toHaveLength(2)
  expect(entries[0].messagePreview).toHaveLength(60)
})
