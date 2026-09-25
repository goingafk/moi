import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CODEX_LOCAL_CONTROL_CONTEXT,
  CODEX_LOCAL_CONTROL_FALLBACK,
  CODEX_THREAD_ACCESS,
  CODEX_TURN_ACCESS,
  codexServerRequestResponse,
  handleCodexServerRequest,
  registerCodexApprovalContext,
  removeCodexApprovalContext
} from './permissions'
import { stripMoiContext } from '@/lib/moi-context'
import {
  answerApproval,
  cancelSessionApprovals,
  flushPermissionAudit,
  pendingApprovalSnapshot,
  setPermissionAuditDir
} from '../../permissions/pending'

describe('Codex reviewed access', () => {
  test('defines sandboxed workspace access for threads', () => {
    expect(CODEX_THREAD_ACCESS).toEqual({
      sandbox: 'workspace-write',
      approvalPolicy: 'on-request'
    })
  })

  test('defines sandboxed network access for turns', () => {
    expect(CODEX_TURN_ACCESS).toEqual({
      approvalPolicy: 'on-request',
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false
      }
    })
  })

  test('explains reviewed local control access without leaking into replay', () => {
    expect(CODEX_LOCAL_CONTROL_CONTEXT).toEqual({
      'moi-control-access': {
        value: expect.stringContaining('sandbox_permissions set to require_escalated'),
        kind: 'application'
      }
    })
    expect(stripMoiContext(CODEX_LOCAL_CONTROL_FALLBACK)).toBe('')
  })
})

describe('codexServerRequestResponse', () => {
  test('accepts v2 approval requests', () => {
    for (const method of [
      'item/commandExecution/requestApproval',
      'item/fileChange/requestApproval'
    ]) {
      expect(codexServerRequestResponse(method)).toEqual({ result: { decision: 'accept' } })
    }
  })

  test('accepts legacy v1 approval requests with their decision vocabulary', () => {
    expect(codexServerRequestResponse('applyPatchApproval')).toEqual({
      result: { decision: 'approved' }
    })
    expect(codexServerRequestResponse('execCommandApproval')).toEqual({
      result: { decision: 'approved' }
    })
  })

  test('grants requested permissions for one turn using the native grant schema', () => {
    expect(
      codexServerRequestResponse('item/permissions/requestApproval', {
        permissions: { network: { enabled: true }, fileSystem: null, unexpected: true }
      })
    ).toEqual({ result: { permissions: { network: { enabled: true } }, scope: 'turn' } })
  })

  test('rejects non-approval requests as unsupported', () => {
    for (const method of ['item/tool/call', 'item/tool/requestUserInput']) {
      expect(codexServerRequestResponse(method)).toEqual({
        error: { code: -32601, message: `moi does not handle ${method}` }
      })
    }
  })
})

test('Codex ask-risky approval waits for the browser and answers in native vocabulary', async () => {
  const auditDir = await mkdtemp(join(tmpdir(), 'moi-codex-approval-'))
  setPermissionAuditDir(auditDir)
  const context = {
    workspaceId: 'codex-workspace',
    sessionId: 'thread-1',
    workspacePath: '/tmp/codex-workspace',
    mode: 'ask-risky' as const
  }
  registerCodexApprovalContext(context)
  try {
    const result = handleCodexServerRequest(
      context.workspacePath,
      'item/commandExecution/requestApproval',
      { threadId: context.sessionId, command: 'git push origin main' }
    )
    const request = pendingApprovalSnapshot().find(item => item.sessionId === context.sessionId)
    expect(request?.reason).toContain('Git')
    expect(
      answerApproval(context.workspaceId, context.sessionId, request!.id, 'once', 'test browser')
    ).toBe(true)
    expect(await result).toEqual({ result: { decision: 'accept' } })
    const denied = await handleCodexServerRequest(
      context.workspacePath,
      'item/commandExecution/requestApproval',
      { threadId: 'unknown', command: 'git push origin main' }
    )
    expect(denied).toEqual({ result: { decision: 'decline' } })
  } finally {
    cancelSessionApprovals(context.workspaceId, context.sessionId)
    removeCodexApprovalContext(context.workspacePath, context.sessionId)
    await flushPermissionAudit()
    await rm(auditDir, { recursive: true, force: true })
  }
})
