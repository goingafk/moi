import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_SESSION_CONFIG_PATH,
  getSessionConfig,
  renameSessionConfig,
  saveSessionConfig,
  setSessionConfigPath
} from './session-config'

let scratchDir = ''
const workspacePath = '/workspace'
let storePath = ''

beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), 'moi-session-config-'))
  storePath = join(scratchDir, 'session-config.json')
  setSessionConfigPath(storePath)
})

afterEach(async () => {
  setSessionConfigPath(DEFAULT_SESSION_CONFIG_PATH)
  await rm(scratchDir, { recursive: true, force: true })
})

describe('session Fast mode config', () => {
  test('preserves explicit false and clears only when asked', async () => {
    await saveSessionConfig(workspacePath, 'session-1', {
      model: 'sonnet',
      fastMode: false
    })
    expect(await getSessionConfig(workspacePath, 'session-1')).toEqual({
      model: 'sonnet',
      fastMode: false
    })

    await saveSessionConfig(workspacePath, 'session-1', { fastMode: null })
    expect(await getSessionConfig(workspacePath, 'session-1')).toEqual({ model: 'sonnet' })
  })

  test('keeps false when a temporary session config is renamed', async () => {
    await saveSessionConfig(workspacePath, 'temporary', { fastMode: false })
    await renameSessionConfig(workspacePath, 'temporary', 'real')

    expect(await getSessionConfig(workspacePath, 'temporary')).toEqual({})
    expect(await getSessionConfig(workspacePath, 'real')).toEqual({ fastMode: false })
  })
})

describe('session agent binding', () => {
  test('survives rename and refuses rebinding', async () => {
    const agent = { type: 'ollama' as const, serverId: 'home' }
    await saveSessionConfig(workspacePath, 'temporary', { agent, model: 'qwen3.8:27b' })
    await renameSessionConfig(workspacePath, 'temporary', 'real')
    expect(await getSessionConfig(workspacePath, 'real')).toEqual({ agent, model: 'qwen3.8:27b' })
    await expect(
      saveSessionConfig(workspacePath, 'real', { agent: { type: 'codex' } })
    ).rejects.toThrow('cannot change agents')
    expect((await getSessionConfig(workspacePath, 'real')).agent).toEqual(agent)
  })
})
