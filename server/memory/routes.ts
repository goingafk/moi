// /api/memory/* — moi's proxy to the memory service for the Settings → Memory
// page. The browser never talks to the service directly: these routes sit
// behind moi's own auth (server/auth.ts via web.ts), and only moi's server is
// on the service's device allow-list.

import { Hono, type Context } from 'hono'

import type {
  MemoryConfigPatch,
  MemoryEntryPatch,
  MemoryScope,
  MemoryStatusView
} from '@/lib/memory'

import { getWorkspace } from '../registry'
import { MemoryServiceError, memoryApi, memoryServiceUrl } from './client'
import { addMemory } from './index'
import { memoryProjectFor } from './project'

export const memoryRoutes = new Hono()

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new MemoryServiceError('Invalid JSON body', 400)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new MemoryServiceError('Body must be an object', 400)
  }
  return body as Record<string, unknown>
}

memoryRoutes.onError((error, c) => {
  if (error instanceof MemoryServiceError) {
    return c.text(error.message, error.status as 400 | 404 | 409 | 502)
  }
  console.error('[memory] route failed:', error)
  return c.text('Memory request failed', 500)
})

memoryRoutes.get('/api/memory/status', async c => {
  const url = memoryServiceUrl()
  if (!url) return c.json({ state: 'off' } satisfies MemoryStatusView)
  try {
    return c.json({ state: 'ok', url, config: await memoryApi.config() } satisfies MemoryStatusView)
  } catch (error) {
    return c.json({
      state: 'unreachable',
      url,
      error: error instanceof Error ? error.message : 'Unreachable'
    } satisfies MemoryStatusView)
  }
})

memoryRoutes.patch('/api/memory/config', async c => {
  const body = await jsonBody(c)
  const patch: MemoryConfigPatch = {}
  if (body.enabled !== undefined) patch.enabled = body.enabled as boolean
  if (body.scorer !== undefined) patch.scorer = body.scorer as MemoryConfigPatch['scorer']
  if (body.threshold !== undefined) patch.threshold = body.threshold as number
  // The service validates values; moi only forwards the known keys.
  return c.json(await memoryApi.updateConfig(patch))
})

// Optional `workspaceId` narrows the list to that workspace's project.
memoryRoutes.get('/api/memory/entries', async c => {
  const query = new URLSearchParams()
  for (const key of ['status', 'scope', 'q', 'limit', 'offset']) {
    const value = c.req.query(key)
    if (value) query.set(key, value)
  }
  const workspaceId = c.req.query('workspaceId')
  if (workspaceId) {
    const workspace = await getWorkspace(workspaceId)
    if (!workspace) return c.text('Workspace not found', 404)
    query.set('project', await memoryProjectFor(workspace.path))
  }
  return c.json(await memoryApi.list(query))
})

memoryRoutes.post('/api/memory/entries', async c => {
  const body = await jsonBody(c)
  const scope = (body.scope ?? 'project') as MemoryScope
  if (typeof body.text !== 'string') throw new MemoryServiceError('text is required', 400)
  if (scope !== 'global' && scope !== 'project') {
    throw new MemoryServiceError('scope must be "project" or "global"', 400)
  }
  let workspacePath = ''
  if (scope === 'project') {
    const workspace =
      typeof body.workspaceId === 'string' ? await getWorkspace(body.workspaceId) : null
    if (!workspace)
      throw new MemoryServiceError('workspaceId is required for project memories', 400)
    workspacePath = workspace.path
  }
  const result = await addMemory({ workspacePath, text: body.text, scope })
  return c.json(result, result.outcome === 'duplicate' ? 200 : 201)
})

memoryRoutes.patch('/api/memory/entries/:id', async c => {
  const body = await jsonBody(c)
  const patch: MemoryEntryPatch = {}
  if (body.text !== undefined) patch.text = body.text as string
  if (body.pinned !== undefined) patch.pinned = body.pinned as boolean
  if (body.status !== undefined) patch.status = body.status as 'active'
  return c.json(await memoryApi.update(c.req.param('id'), patch))
})

memoryRoutes.delete('/api/memory/entries/:id', async c => {
  await memoryApi.remove(c.req.param('id'))
  return c.body(null, 204)
})
