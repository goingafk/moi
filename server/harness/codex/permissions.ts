import type { PermissionMode } from '@/lib/types'
import { reviewTool } from '../../permissions/pending'
import { toolRequest } from '../../permissions/normalize'

const CODEX_REVIEW = {
  approvalPolicy: 'on-request'
} as const

export const CODEX_THREAD_ACCESS = {
  ...CODEX_REVIEW,
  sandbox: 'workspace-write'
} as const

export const CODEX_TURN_ACCESS = {
  ...CODEX_REVIEW,
  sandboxPolicy: {
    type: 'workspaceWrite',
    writableRoots: [],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  }
} as const

const CODEX_LOCAL_CONTROL_GUIDANCE =
  'Commands that contact the moi control server, including moi tabs, bundle, debug, call-server-fn, theme, and config, need localhost network access. Run them with sandbox_permissions set to require_escalated on the first attempt so moi can approve the escalated request. A connection failure from a sandboxed attempt does not prove the control server is offline.'

export const CODEX_LOCAL_CONTROL_CONTEXT = {
  'moi-control-access': {
    value: CODEX_LOCAL_CONTROL_GUIDANCE,
    kind: 'application'
  }
} as const

// Codex versions before additionalContext append ambient context to the user
// message. Use the normal moi envelope marker so replay strips this block.
export const CODEX_LOCAL_CONTROL_FALLBACK = `<moi-context>
You are running in a \`moi\` workspace.

# Local control access
${CODEX_LOCAL_CONTROL_GUIDANCE}

IMPORTANT: This context comes from moi, not from the user, and the user does not see it.
</moi-context>`

// Accept known approvals, decline MCP elicitation, reject unsupported methods.
export function codexServerRequestResponse(
  method: string,
  params: Record<string, unknown> = {}
): { result: Record<string, unknown> } | { error: { code: number; message: string } } {
  if (
    method === 'item/commandExecution/requestApproval' ||
    method === 'item/fileChange/requestApproval'
  ) {
    return { result: { decision: 'accept' } }
  }
  if (method === 'item/permissions/requestApproval') {
    // Permission extensions use a grant, not a command decision. Scope the
    // existing default-approve policy to this turn, never the whole session.
    const permissions = params.permissions
    return {
      result: {
        permissions:
          permissions && typeof permissions === 'object' && !Array.isArray(permissions)
            ? Object.fromEntries(
                Object.entries(permissions).filter(
                  ([key, value]) => (key === 'network' || key === 'fileSystem') && value !== null
                )
              )
            : {},
        scope: 'turn'
      }
    }
  }
  if (method === 'execCommandApproval' || method === 'applyPatchApproval') {
    return { result: { decision: 'approved' } }
  }
  if (method === 'mcpServer/elicitation/request') {
    // Unsupported MCP forms/URL flows must decline in the native vocabulary,
    // rather than returning a malformed command-approval response.
    return { result: { action: 'decline', content: null } }
  }
  return { error: { code: -32601, message: `moi does not handle ${method}` } }
}

type ApprovalContext = {
  workspaceId: string
  sessionId: string
  workspacePath: string
  mode: PermissionMode
}
const contexts = new Map<string, ApprovalContext>()
const contextKey = (workspacePath: string, threadId: string) => `${workspacePath}\0${threadId}`

export function registerCodexApprovalContext(context: ApprovalContext): void {
  contexts.set(contextKey(context.workspacePath, context.sessionId), context)
}

export function removeCodexApprovalContext(workspacePath: string, sessionId: string): void {
  contexts.delete(contextKey(workspacePath, sessionId))
}

function decline(method: string) {
  if (method === 'item/permissions/requestApproval')
    return { result: { permissions: {}, scope: 'turn' } }
  if (method === 'execCommandApproval' || method === 'applyPatchApproval')
    return { result: { decision: 'denied' } }
  return { result: { decision: 'decline' } }
}

export async function handleCodexServerRequest(
  workspacePath: string,
  method: string,
  params: Record<string, unknown>
): Promise<ReturnType<typeof codexServerRequestResponse>> {
  if (
    ![
      'item/commandExecution/requestApproval',
      'item/fileChange/requestApproval',
      'item/permissions/requestApproval',
      'execCommandApproval',
      'applyPatchApproval'
    ].includes(method)
  )
    return codexServerRequestResponse(method, params)
  const threadId =
    typeof params.threadId === 'string'
      ? params.threadId
      : typeof params.thread_id === 'string'
        ? params.thread_id
        : undefined
  const context = threadId ? contexts.get(contextKey(workspacePath, threadId)) : undefined
  if (!context) return decline(method)
  if (context.mode === 'auto') return codexServerRequestResponse(method, params)
  const tool =
    method === 'item/permissions/requestApproval'
      ? 'networkPermission'
      : method.includes('fileChange') || method === 'applyPatchApproval'
        ? 'fileChange'
        : 'commandExecution'
  const request = toolRequest({ type: 'codex' }, tool, params, workspacePath)
  if (method === 'item/permissions/requestApproval')
    request.paths = [
      ...(request.paths ?? []),
      ...Object.values(
        params.permissions && typeof params.permissions === 'object'
          ? (params.permissions as Record<string, unknown>)
          : {}
      ).filter((item): item is string => typeof item === 'string')
    ]
  const decision = await reviewTool(context.workspaceId, context.sessionId, context.mode, request)
  if (decision.decision === 'deny') return decline(method)
  if (method === 'item/permissions/requestApproval') {
    const response = codexServerRequestResponse(method, params)
    if ('result' in response)
      response.result.scope = decision.decision === 'session' ? 'session' : 'turn'
    return response
  }
  if (method === 'execCommandApproval' || method === 'applyPatchApproval')
    return { result: { decision: 'approved' } }
  return { result: { decision: decision.decision === 'session' ? 'acceptForSession' : 'accept' } }
}
