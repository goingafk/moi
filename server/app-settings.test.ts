import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AppSettings } from '@/lib/types'

import { api } from './api'
import { DEFAULT_ELIGIBILITY_TABLE } from '@/lib/routing'
import { setAppSettingsDir } from './app-settings'
import { DATA_DIR } from './data-dir'
import { setEventServer } from './events'

let tempDir = ''
let published: unknown[] = []

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'moi-app-settings-'))
  setAppSettingsDir(tempDir)
  published = []
  setEventServer({ publish: (_topic, data) => published.push(JSON.parse(data)) })
})

afterEach(async () => {
  setAppSettingsDir(DATA_DIR)
  await rm(tempDir, { recursive: true, force: true })
  tempDir = ''
})

describe('app settings API', () => {
  const permissions = {
    defaults: { claude: 'auto', codex: 'auto', ollama: 'ask-risky' },
    rules: {
      outsideProject: true,
      deletes: true,
      network: true,
      gitDangerous: true,
      system: true,
      sensitiveFiles: true,
      unparseableShell: true
    },
    alwaysAsk: [],
    alwaysAllow: []
  } satisfies AppSettings['permissions']
  const routing = {
    classifier: 'jev' as const,
    laya: null,
    claudeReservePercent: 70,
    table: DEFAULT_ELIGIBILITY_TABLE
  }
  test('returns defaults before anything is saved', async () => {
    const response = await api.request('/api/settings')
    const settings = (await response.json()) as AppSettings

    expect(response.status).toBe(200)
    expect(settings).toEqual({
      autoUpdateSkills: false,
      modelMode: 'manual',
      ollamaServers: [],
      localMcpServers: [],
      permissions,
      memory: { url: null },
      routing
    })
  })

  test('persists a patched setting to settings.json', async () => {
    const response = await api.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoUpdateSkills: true })
    })
    const settings = (await response.json()) as AppSettings

    expect(response.status).toBe(200)
    expect(settings.autoUpdateSkills).toBe(true)
    expect(JSON.parse(await Bun.file(join(tempDir, 'settings.json')).text())).toEqual({
      autoUpdateSkills: true,
      modelMode: 'manual',
      ollamaServers: [],
      localMcpServers: [],
      permissions,
      memory: { url: null },
      routing
    })

    const readBack = await api.request('/api/settings')
    expect(((await readBack.json()) as AppSettings).autoUpdateSkills).toBe(true)

    // Other open clients learn about the change over the live-event channel.
    expect(published).toEqual([
      {
        type: 'settings:updated',
        settings: {
          autoUpdateSkills: true,
          modelMode: 'manual',
          ollamaServers: [],
          localMcpServers: [],
          permissions,
          memory: { url: null },
          routing
        }
      }
    ])
  })

  test('rejects a non-boolean flag and unknown-only patches change nothing', async () => {
    const invalid = await api.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoUpdateSkills: 'yes' })
    })
    expect(invalid.status).toBe(400)

    const unknown = await api.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nope: true })
    })
    expect(unknown.status).toBe(200)
    expect((await unknown.json()) as AppSettings).toEqual({
      autoUpdateSkills: false,
      modelMode: 'manual',
      ollamaServers: [],
      localMcpServers: [],
      permissions,
      memory: { url: null },
      routing
    })
  })

  test('stores the memory service URL and rejects anything but a bare http(s) origin', async () => {
    const patch = (memory: unknown) =>
      api.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memory })
      })
    const good = await patch({ url: 'http://100.100.1.1:13380' })
    expect(good.status).toBe(200)
    expect(((await good.json()) as AppSettings).memory).toEqual({ url: 'http://100.100.1.1:13380' })
    for (const memory of [
      { url: 'file:///tmp/memory' },
      { url: 'http://user:secret@100.100.1.1:13380' },
      { url: 'http://100.100.1.1:13380/v1/digest' },
      { url: 'not a url' },
      { url: 'http://x', extra: true },
      {}
    ]) {
      expect((await patch(memory)).status).toBe(400)
    }
    expect(((await (await patch({ url: null })).json()) as AppSettings).memory.url).toBeNull()
  })

  test('stores Ollama servers and rejects unsafe or duplicate origins', async () => {
    const good = await api.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ollamaServers: [{ id: 'home', name: 'Home', baseUrl: 'http://100.125.20.45:11434' }]
      })
    })
    expect(good.status).toBe(200)
    expect(((await good.json()) as AppSettings).ollamaServers).toHaveLength(1)

    for (const servers of [
      [{ id: 'home', name: 'Home', baseUrl: 'file:///tmp/models' }],
      [{ id: 'home', name: 'Home', baseUrl: 'http://user:secret@example.com' }],
      [{ id: 'home', name: 'Home', baseUrl: 'http://example.com/path' }],
      [
        { id: 'home', name: 'Home', baseUrl: 'http://example.com' },
        { id: 'home', name: 'Other', baseUrl: 'http://other.example.com' }
      ]
    ]) {
      const response = await api.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ollamaServers: servers })
      })
      expect(response.status).toBe(400)
    }
  })

  test('stores routing settings and rejects bad agents and Laya URLs', async () => {
    const valid = {
      ...routing,
      classifier: 'laya' as const,
      laya: { baseUrl: 'http://100.125.20.45:11435', model: 'laya' },
      claudeReservePercent: 65
    }
    const response = await api.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routing: valid })
    })
    expect(response.status).toBe(200)
    expect(((await response.json()) as AppSettings).routing).toEqual(valid)

    for (const invalid of [
      { ...valid, laya: { baseUrl: 'file:///tmp/laya', model: 'laya' } },
      { ...valid, claudeReservePercent: 101 },
      {
        ...valid,
        table: { ...valid.table, trivial: [[{ agent: 'hermes' }]] }
      }
    ]) {
      expect(
        (
          await api.request('/api/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ routing: invalid })
          })
        ).status
      ).toBe(400)
    }
  })
})
