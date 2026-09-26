import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CatalogModel, RoutingDecisionLog, WorkspaceEntry } from '@/lib/types'

import { DATA_DIR } from '../data-dir'
import { setAppSettingsDir } from '../app-settings'
import { routeMessage } from './index'

let dir = ''
let workspace: WorkspaceEntry
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'moi-route-message-'))
  setAppSettingsDir(dir)
  workspace = { id: 'one', path: dir, type: 'claude-code', addedAt: new Date().toISOString() }
})
afterEach(async () => {
  setAppSettingsDir(DATA_DIR)
  await rm(dir, { recursive: true, force: true })
})

const catalog: CatalogModel[] = [
  {
    selectionId: 'ollama:home:qwen',
    value: 'qwen',
    displayName: 'Qwen',
    agent: { type: 'ollama', serverId: 'home' },
    ready: true
  }
]

test('routes, logs only a preview, and never throws when dependencies fail', async () => {
  const logged: RoutingDecisionLog[] = []
  const decision = await routeMessage(
    { workspace, sessionId: 's', isNew: true, content: `${'x'.repeat(130)} SECRET` },
    {
      summary: async () => 'project',
      classify: async () => ({
        difficulty: 'trivial',
        kind: 'other',
        confidence: 1,
        classifier: 'jev'
      }),
      catalog: async () => catalog,
      usage: async () => [],
      append: async entry => {
        logged.push(entry)
      }
    }
  )
  expect(decision).toMatchObject({ model: 'qwen', agent: { type: 'ollama' } })
  expect(logged[0].messagePreview).toHaveLength(120)
  expect(JSON.stringify(logged[0])).not.toContain('SECRET')

  const fallback = await routeMessage(
    {
      workspace,
      sessionId: 's',
      isNew: false,
      content: 'x',
      boundAgent: { type: 'codex' },
      currentModel: 'gpt'
    },
    {
      summary: async () => {
        throw new Error('down')
      },
      lastChoice: async () => null,
      append: async () => {}
    }
  )
  expect(fallback).toMatchObject({
    agent: { type: 'codex' },
    model: 'gpt',
    fallback: 'Routing unavailable'
  })
})
