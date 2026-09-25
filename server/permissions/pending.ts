import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { ApprovalRequest, PermissionMode, SessionAgent } from '@/lib/types'
import { getAppSettings } from '../app-settings'
import { DATA_DIR } from '../data-dir'
import { broadcast } from '../state'
import { classifyTool, type ToolRequest } from './classify'

export type ApprovalDecision = 'once' | 'session' | 'deny'
export type ApprovalAnswer = { decision: ApprovalDecision; note?: string }
type Pending = {
  request: ApprovalRequest
  resolve: (answer: ApprovalAnswer) => void
}
const pending = new Map<string, Pending>()
const allowedForSession = new Map<string, Set<string>>()
let auditQueue: Promise<unknown> = Promise.resolve()
let auditDir = DATA_DIR

export function setPermissionAuditDir(dir: string): void {
  auditDir = dir
}

export async function flushPermissionAudit(): Promise<void> {
  await auditQueue
}

function key(workspaceId: string, sessionId: string): string {
  return `${workspaceId}\0${sessionId}`
}

function fingerprint(request: ToolRequest): string {
  return `${request.tool}\0${request.command ?? ''}\0${(request.paths ?? []).join('\0')}`
}

function audit(entry: Record<string, unknown>): void {
  auditQueue = auditQueue
    .then(async () => {
      await mkdir(auditDir, { recursive: true, mode: 0o700 })
      await appendFile(join(auditDir, 'permission-audit.jsonl'), `${JSON.stringify(entry)}\n`, {
        mode: 0o600
      })
    })
    .catch(error => console.error('[permissions] Could not write audit log', error))
}

export function permissionModeFor(agent: SessionAgent): PermissionMode {
  const defaults = getAppSettings().permissions.defaults
  return agent.type === 'ollama'
    ? defaults.ollama
    : agent.type === 'codex'
      ? defaults.codex
      : defaults.claude
}

export function pendingApprovalSnapshot(): ApprovalRequest[] {
  return [...pending.values()].map(item => item.request)
}

export function hasPendingApproval(workspaceId: string, sessionId: string): boolean {
  return [...pending.values()].some(
    item => item.request.workspaceId === workspaceId && item.request.sessionId === sessionId
  )
}

export async function reviewTool(
  workspaceId: string,
  sessionId: string,
  mode: PermissionMode,
  request: ToolRequest,
  signal?: AbortSignal
): Promise<ApprovalAnswer> {
  if (mode === 'auto') {
    audit({
      at: new Date().toISOString(),
      action: 'decision',
      workspaceId,
      sessionId,
      tool: request.tool,
      mode,
      decision: 'once',
      who: 'automatic'
    })
    return { decision: 'once' }
  }
  const risk = classifyTool(request, getAppSettings().permissions)
  if (mode === 'ask-risky' && risk.level === 'safe') {
    audit({
      at: new Date().toISOString(),
      action: 'decision',
      workspaceId,
      sessionId,
      tool: request.tool,
      mode,
      rule: risk.rule,
      decision: 'once',
      who: 'classifier'
    })
    return { decision: 'once' }
  }
  const sessionKey = key(workspaceId, sessionId)
  if (risk.rule !== 'alwaysAsk' && allowedForSession.get(sessionKey)?.has(fingerprint(request)))
    return { decision: 'once' }
  if (signal?.aborted) return { decision: 'deny' }
  const id = crypto.randomUUID()
  const approval: ApprovalRequest = {
    id,
    workspaceId,
    sessionId,
    agent: request.agent,
    tool: request.tool,
    command: request.command,
    paths: request.paths ?? [],
    reason: mode === 'ask-all' ? 'This chat asks before every tool' : risk.reason,
    mode,
    createdAt: Date.now()
  }
  // The audit log deliberately records a fingerprint, not raw tool input or
  // command arguments, which can contain credentials. The browser gets the
  // live request over the authenticated socket only.
  const digest = new Bun.CryptoHasher('sha256').update(fingerprint(request)).digest('hex')
  audit({
    at: new Date().toISOString(),
    action: 'request',
    id,
    workspaceId,
    sessionId,
    tool: request.tool,
    fingerprint: digest,
    rule: risk.rule,
    mode
  })
  return new Promise<ApprovalAnswer>(resolve => {
    const abort = () => answerApproval(workspaceId, approval.sessionId, id, 'deny', 'interrupt')
    const settle = (answer: ApprovalAnswer) => {
      signal?.removeEventListener('abort', abort)
      resolve(answer)
    }
    pending.set(id, { request: approval, resolve: settle })
    signal?.addEventListener('abort', abort, { once: true })
    broadcast(workspaceId, { type: 'approval:request', request: approval })
    broadcast(workspaceId, { type: 'status', sessionId, activity: 'requires-action' })
  })
}

export function answerApproval(
  workspaceId: string,
  sessionId: string,
  requestId: string,
  decision: ApprovalDecision,
  who = 'authenticated browser',
  note?: string
): boolean {
  const item = pending.get(requestId)
  if (!item || item.request.workspaceId !== workspaceId || item.request.sessionId !== sessionId)
    return false
  pending.delete(requestId)
  if (decision === 'session') {
    const sessionKey = key(workspaceId, sessionId)
    const set = allowedForSession.get(sessionKey) ?? new Set<string>()
    set.add(`${item.request.tool}\0${item.request.command ?? ''}\0${item.request.paths.join('\0')}`)
    allowedForSession.set(sessionKey, set)
  }
  audit({
    at: new Date().toISOString(),
    action: 'decision',
    id: requestId,
    workspaceId,
    sessionId,
    decision,
    who,
    note: note?.slice(0, 500)
  })
  item.resolve({ decision, note: note?.slice(0, 500) })
  broadcast(workspaceId, { type: 'approval:resolved', requestId, sessionId })
  if (!hasPendingApproval(workspaceId, sessionId))
    broadcast(workspaceId, { type: 'status', sessionId, activity: 'running' })
  return true
}

export function cancelSessionApprovals(workspaceId: string, sessionId: string): void {
  for (const item of [...pending.values()]) {
    if (item.request.workspaceId === workspaceId && item.request.sessionId === sessionId)
      answerApproval(workspaceId, sessionId, item.request.id, 'deny', 'interrupt')
  }
  allowedForSession.delete(key(workspaceId, sessionId))
}

export function renameSessionApprovals(workspaceId: string, from: string, to: string): void {
  const grants = allowedForSession.get(key(workspaceId, from))
  if (grants) {
    allowedForSession.set(key(workspaceId, to), grants)
    allowedForSession.delete(key(workspaceId, from))
  }
  for (const item of pending.values()) {
    if (item.request.workspaceId === workspaceId && item.request.sessionId === from)
      item.request.sessionId = to
  }
}
