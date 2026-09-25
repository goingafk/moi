import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getAppSettings, saveAppSettings, setAppSettingsDir } from '../app-settings'
import {
  answerApproval,
  cancelSessionApprovals,
  flushPermissionAudit,
  pendingApprovalSnapshot,
  renameSessionApprovals,
  reviewTool,
  setPermissionAuditDir
} from './pending'

const dirs: string[] = []
afterEach(async () => {
  for (const item of pendingApprovalSnapshot())
    cancelSessionApprovals(item.workspaceId, item.sessionId)
  await flushPermissionAudit()
  setAppSettingsDir(join(tmpdir(), 'moi-settings-reset'))
  setPermissionAuditDir(join(tmpdir(), 'moi-audit-reset'))
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'moi-approval-'))
  dirs.push(dir)
  setAppSettingsDir(dir)
  setPermissionAuditDir(dir)
  const request = {
    agent: { type: 'claude-code' } as const,
    tool: 'Bash',
    command: 'curl https://example.com',
    cwd: dir,
    workspaceRoot: dir
  }
  return { dir, request }
}

test('pending approvals survive snapshot and rename, then resolve once', async () => {
  const { dir, request } = await setup()
  const result = reviewTool('workspace', 'draft', 'ask-risky', request)
  const approval = pendingApprovalSnapshot()[0]!
  expect(approval.command).toBe(request.command)
  expect(approval.reason).toContain('Network')
  renameSessionApprovals('workspace', 'draft', 'session')
  expect(pendingApprovalSnapshot()[0]?.sessionId).toBe('session')
  expect(answerApproval('workspace', 'session', approval.id, 'once', 'test browser')).toBe(true)
  expect((await result).decision).toBe('once')
  expect(pendingApprovalSnapshot()).toHaveLength(0)
  await flushPermissionAudit()
  const entries = (await readFile(join(dir, 'permission-audit.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as Record<string, unknown>)
  expect(entries.map(entry => entry.action)).toEqual(['request', 'decision'])
  expect(entries[1]?.who).toBe('test browser')
  expect(JSON.stringify(entries)).not.toContain('https://example.com')
})

test('interrupt denies; session grants do not bypass always ask', async () => {
  const { request } = await setup()
  const first = reviewTool('workspace', 'session', 'ask-all', request)
  const id = pendingApprovalSnapshot()[0]!.id
  expect(answerApproval('workspace', 'session', id, 'session')).toBe(true)
  expect((await first).decision).toBe('session')
  const cached = await reviewTool('workspace', 'session', 'ask-all', request)
  expect(cached.decision).toBe('once')
  saveAppSettings({ permissions: { ...getAppSettings().permissions, alwaysAsk: ['tool:Bash'] } })
  const next = reviewTool('workspace', 'session', 'ask-all', request)
  expect(pendingApprovalSnapshot()).toHaveLength(1)
  cancelSessionApprovals('workspace', 'session')
  expect((await next).decision).toBe('deny')
})
