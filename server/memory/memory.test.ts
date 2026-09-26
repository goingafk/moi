import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MemoryDigest } from '@/lib/memory'
import type { MoiContext } from '@/lib/moi-context'

import { api } from '../api'
import { saveAppSettings, setAppSettingsDir } from '../app-settings'
import { registerWorkspace, setRegistryPath } from '../registry'
import { silenceConsole } from '../test/quiet'
import { getUsageSnapshots, setUsageStorePath } from '../usage/store'
import { usageOverview } from '../usage'
import { addMemory, withMemoryDigest } from './index'
import { clearMemoryProjectCache, memoryProjectFor } from './project'

silenceConsole('warn')

// A fake memory service: records requests and answers from `reply`.
type Seen = { method: string; path: string; body: unknown }
let seen: Seen[] = []
let reply: (req: Seen) => Response | Promise<Response> = () => Response.json({})
let service: ReturnType<typeof Bun.serve>

beforeAll(() => {
  service = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const text = await req.text()
      const entry = {
        method: req.method,
        path: url.pathname + url.search,
        body: text ? JSON.parse(text) : null
      }
      seen.push(entry)
      return reply(entry)
    }
  })
})
afterAll(() => service.stop(true))

let tempDir: string
const context: MoiContext = { activeTab: 'overview' }

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'moi-memory-'))
  setAppSettingsDir(tempDir)
  setRegistryPath(join(tempDir, 'workspaces.json'))
  setUsageStorePath(join(tempDir, 'usage-snapshots.json'))
  clearMemoryProjectCache()
  seen = []
  reply = () => Response.json({})
  saveAppSettings({ memory: { url: `http://127.0.0.1:${service.port}` } })
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

const digest = (entries: MemoryDigest['entries']): MemoryDigest => ({
  enabled: true,
  projectKey: 'path:/work',
  entries
})

describe('withMemoryDigest', () => {
  test('appends digest lines after existing directives', async () => {
    reply = () =>
      Response.json(digest([{ id: 'a', scope: 'project', text: 'Use Bun.serve', pinned: false }]))
    const next = await withMemoryDigest(
      { ...context, directives: ['existing'] },
      { workspacePath: tempDir, sessionId: 's1', isNew: false, content: 'add a route' }
    )
    expect(next?.directives?.[0]).toBe('existing')
    expect(next?.directives?.at(-1)).toBe('- Use Bun.serve')
    expect(seen[0]).toMatchObject({
      method: 'POST',
      path: '/v1/digest',
      body: { project: tempDir, sessionId: 's1', message: 'add a route', limit: 12 }
    })
  })

  test('new chats send no session id', async () => {
    reply = () => Response.json(digest([]))
    await withMemoryDigest(context, {
      workspacePath: tempDir,
      sessionId: 'draft-123',
      isNew: true,
      content: 'hi'
    })
    expect((seen[0]!.body as { sessionId: unknown }).sessionId).toBeNull()
  })

  test.each<[string, () => Response | Promise<Response>]>([
    ['server error', () => new Response('boom', { status: 500 })],
    ['refusal', () => new Response('not allowed', { status: 403 })],
    [
      'timeout',
      async () => {
        await Bun.sleep(1_500)
        return Response.json(
          digest([{ id: 'late', scope: 'project', text: 'late', pinned: false }])
        )
      }
    ],
    ['disabled', () => Response.json({ enabled: false, projectKey: 'path:/work', entries: [] })]
  ])('leaves the context unchanged on %s', async (_name, handler) => {
    reply = handler
    const started = Date.now()
    const next = await withMemoryDigest(context, {
      workspacePath: tempDir,
      sessionId: 's1',
      isNew: false,
      content: 'hi'
    })
    expect(next).toEqual(context)
    expect(Date.now() - started).toBeLessThan(1_400)
  })

  test('does nothing without a URL or context', async () => {
    saveAppSettings({ memory: { url: null } })
    const input = { workspacePath: tempDir, sessionId: 's1', isNew: false, content: 'hi' }
    expect(await withMemoryDigest(context, input)).toEqual(context)
    saveAppSettings({ memory: { url: `http://127.0.0.1:${service.port}` } })
    expect(await withMemoryDigest(undefined, input)).toBeUndefined()
    expect(seen).toHaveLength(0)
  })

  test('an unreachable service is skipped', async () => {
    saveAppSettings({ memory: { url: 'http://127.0.0.1:1' } })
    expect(
      await withMemoryDigest(context, {
        workspacePath: tempDir,
        sessionId: 's1',
        isNew: false,
        content: 'hi'
      })
    ).toEqual(context)
  })
})

describe('memoryProjectFor', () => {
  test('prefers the origin remote, falls back to the path', async () => {
    const repo = join(tempDir, 'repo')
    await mkdir(repo)
    await Bun.$`git -C ${repo} init -q && git -C ${repo} remote add origin git@github.com:goingafk/moi.git`.quiet()
    expect(await memoryProjectFor(repo)).toBe('git@github.com:goingafk/moi.git')
    const plain = join(tempDir, 'plain')
    await mkdir(plain)
    expect(await memoryProjectFor(plain)).toBe(plain)
  })
})

describe('addMemory', () => {
  test('sends project, provenance and scope', async () => {
    reply = () =>
      Response.json({ outcome: 'added', entry: { id: 'm1' }, supersededId: null }, { status: 201 })
    await addMemory({
      workspacePath: tempDir,
      text: 'Use Bun.serve',
      scope: 'project',
      agent: { type: 'ollama', serverId: 'home' },
      model: 'qwen3.8:27b'
    })
    expect(seen[0]!.body).toMatchObject({
      text: 'Use Bun.serve',
      scope: 'project',
      project: tempDir,
      provenance: { agent: 'ollama:home', model: 'qwen3.8:27b' }
    })
    await addMemory({ workspacePath: tempDir, text: 'Global', scope: 'global' })
    expect(seen[1]!.body).toMatchObject({ scope: 'global', provenance: { agent: 'moi-cli' } })
    expect((seen[1]!.body as { project?: string }).project).toBeUndefined()
  })
})

describe('/api/memory routes', () => {
  test('status reports off, ok and unreachable', async () => {
    reply = () =>
      Response.json({
        enabled: true,
        scorer: 'jev',
        threshold: 0.3,
        available: { jev: true, laya: false, embeddings: { configured: false, model: null } }
      })
    expect(await (await api.request('/api/memory/status')).json()).toMatchObject({
      state: 'ok',
      config: { scorer: 'jev' }
    })
    saveAppSettings({ memory: { url: 'http://127.0.0.1:1' } })
    expect((await (await api.request('/api/memory/status')).json()).state).toBe('unreachable')
    saveAppSettings({ memory: { url: null } })
    expect(await (await api.request('/api/memory/status')).json()).toEqual({ state: 'off' })
  })

  test('entries list resolves a workspace to its project', async () => {
    const workspace = await registerWorkspace(tempDir)
    reply = () => Response.json({ entries: [], total: 0 })
    const res = await api.request(
      `/api/memory/entries?workspaceId=${workspace.id}&status=active&bogus=1`
    )
    expect(res.status).toBe(200)
    const url = new URL(`http://x${seen[0]!.path}`)
    expect(url.pathname).toBe('/v1/memories')
    expect(url.searchParams.get('project')).toBe(tempDir)
    expect(url.searchParams.get('status')).toBe('active')
    expect(url.searchParams.has('bogus')).toBe(false)
  })

  test('service errors pass through with a usable message', async () => {
    reply = () => Response.json({ error: 'text must not be empty' }, { status: 400 })
    const res = await api.request('/api/memory/entries/abc', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '' })
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('text must not be empty')
  })

  test('a refusal explains the allow-list', async () => {
    reply = () => new Response('This Tailscale device is not allowed.', { status: 403 })
    const res = await api.request('/api/memory/entries')
    expect(res.status).toBe(502)
    expect(await res.text()).toContain('allowedIps')
  })

  test('adding a project memory needs a workspace', async () => {
    const res = await api.request('/api/memory/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x', scope: 'project' })
    })
    expect(res.status).toBe(400)
    expect(seen).toHaveLength(0)
  })

  test('memory off returns a clear conflict', async () => {
    saveAppSettings({ memory: { url: null } })
    const res = await api.request('/api/memory/entries')
    expect(res.status).toBe(409)
  })
})

describe('Jev usage from the memory service', () => {
  test('a refresh records priced cumulative spend', async () => {
    reply = () =>
      Response.json({
        jev: { inputTokens: 2_000_000, outputTokens: 50, requests: 40 },
        laya: { inputTokens: 0, outputTokens: 0, requests: 0 }
      })
    await usageOverview(true)
    const snapshot = (await getUsageSnapshots()).find(s => s.id === 'jev:memory-service')
    expect(snapshot).toMatchObject({ provider: 'jev', kind: 'spend', inputTokens: 2_000_000 })
    expect(snapshot?.spentUsd).toBeCloseTo(0.084)
  })

  test('no requests yet keeps the placeholder', async () => {
    reply = () =>
      Response.json({
        jev: { inputTokens: 0, outputTokens: 0, requests: 0 },
        laya: { inputTokens: 0, outputTokens: 0, requests: 0 }
      })
    const overview = await usageOverview(true)
    expect(overview.snapshots.some(s => s.id === 'jev:unobserved')).toBe(true)
  })
})
