import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { WorkspaceEntry } from '@/lib/types'

import { saveAppSettings, setAppSettingsDir } from './app-settings'
import { DATA_DIR } from './data-dir'
import { clearOllamaModelCache } from './ollama/discovery'
import {
  DEFAULT_SESSION_CONFIG_PATH,
  saveSessionConfig,
  setSessionConfigPath
} from './session-config'
import { bindSessionAgent, harnessForSessionAgent, resolveSessionRun } from './session-routing'

let scratch = ''
let fake: Bun.Server<undefined>
let ws: WorkspaceEntry

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'moi-session-routing-'))
  setAppSettingsDir(scratch)
  setSessionConfigPath(join(scratch, 'session-config.json'))
  ws = { id: 'one', path: scratch, addedAt: new Date().toISOString(), type: 'claude-code' }
  fake = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (path === '/api/tags')
        return Response.json({ models: [{ name: 'qwen3.8:27b' }, { name: 'embed' }] })
      if (path === '/api/ps') return Response.json({ models: [] })
      if (path === '/api/show') {
        const body = (await request.json()) as { model: string }
        return Response.json({ capabilities: body.model === 'qwen3.8:27b' ? ['tools'] : [] })
      }
      return new Response(null, { status: 404 })
    }
  })
  saveAppSettings({
    ollamaServers: [{ id: 'home', name: 'Home', baseUrl: `http://127.0.0.1:${fake.port}` }]
  })
})

afterEach(async () => {
  fake.stop(true)
  clearOllamaModelCache()
  setSessionConfigPath(DEFAULT_SESSION_CONFIG_PATH)
  setAppSettingsDir(DATA_DIR)
  await rm(scratch, { recursive: true, force: true })
})

test('routes bound chats to their harness and scopes local env to Ollama', async () => {
  await saveSessionConfig(scratch, 'local', {
    agent: { type: 'ollama', serverId: 'home' },
    model: 'qwen3.8:27b'
  })
  await saveSessionConfig(scratch, 'codex', { agent: { type: 'codex' }, model: 'gpt-5' })
  const local = await resolveSessionRun(ws, 'local', undefined, undefined)
  expect(local.harness.id).toBe('claude-code')
  expect(local.model).toBe('qwen3.8:27b')
  expect(local.agentEnv).toMatchObject({
    ANTHROPIC_AUTH_TOKEN: 'ollama',
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'qwen3.8:27b'
  })
  const codex = await resolveSessionRun(ws, 'codex', undefined, 'gpt-5')
  expect(codex.harness.id).toBe('codex')
  expect(codex.agentEnv).toBeUndefined()
  expect(harnessForSessionAgent({ type: 'ollama', serverId: 'home' }).id).toBe('claude-code')
})

test('rejects unsupported local models and agent changes', async () => {
  await expect(
    resolveSessionRun(ws, 'new', { type: 'ollama', serverId: 'home' }, 'embed')
  ).rejects.toThrow('does not support tools')
  await saveSessionConfig(scratch, 'bound', { agent: { type: 'codex' } })
  await expect(resolveSessionRun(ws, 'bound', { type: 'claude-code' }, undefined)).rejects.toThrow(
    'cannot change agents'
  )
})

test('first session on a harness provisions its bundled skills', async () => {
  await bindSessionAgent(ws, 'codex-new', { type: 'codex' })
  expect(
    (await stat(join(scratch, '.agents', 'skills', 'moi-workspace', 'SKILL.md'))).isFile()
  ).toBe(true)
  expect(await resolveSessionRun(ws, 'codex-new', undefined, 'gpt-5')).toMatchObject({
    harness: { id: 'codex' },
    model: 'gpt-5'
  })
})
