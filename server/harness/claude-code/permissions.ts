import type {
  HookCallbackMatcher,
  Options,
  SyncHookJSONOutput
} from '@anthropic-ai/claude-agent-sdk'
import type { PermissionMode, SessionAgent } from '@/lib/types'
import { reviewTool } from '../../permissions/pending'
import { toolRequest } from '../../permissions/normalize'

export const CLAUDE_APPROVAL_REASON =
  'Approved by moi: agent sessions run with default-approve access until UI approvals land.'

// A `PreToolUse` hook returning `allow` short-circuits the whole permission
// chain — settings rules, the `auto` mode classifier, and `canUseTool` alike —
// so nothing a moi session does comes back as a denial the model has to work
// around. `canUseTool` alone was not enough: the classifier's *deny* verdict
// (e.g. `curl … | sh`) never escalates to a prompt, it short-circuits into an
// error tool_result, so the callback was never consulted.
//
// This grants moi's Claude Code sessions strictly more than the CLI default:
// the classifier's safety judgment is off, and nothing replaces it until the
// UI approval flow lands. Narrow this to a real prompt before then.
export function claudeToolApproval(): SyncHookJSONOutput {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: CLAUDE_APPROVAL_REASON
    }
  }
}

// No `matcher` — the hook runs for every tool, built-in and MCP alike.
export const CLAUDE_APPROVAL_HOOKS: Partial<Record<'PreToolUse', HookCallbackMatcher[]>> = {
  PreToolUse: [{ hooks: [async () => claudeToolApproval()] }]
} satisfies Options['hooks']

export function claudeApprovalHooks(context: {
  workspaceId: string
  sessionId: () => string
  workspacePath: string
  agent: SessionAgent
  mode: PermissionMode
}): Options['hooks'] {
  if (context.mode === 'auto') return CLAUDE_APPROVAL_HOOKS
  return {
    PreToolUse: [
      {
        // A human decision has no application timeout. The SDK matcher accepts
        // a long bound; Stop aborts the pending promise immediately.
        timeout: 86_400,
        hooks: [
          async (input, _toolUseId, options) => {
            if (input.hook_event_name !== 'PreToolUse') return { continue: true }
            const result = await reviewTool(
              context.workspaceId,
              context.sessionId(),
              context.mode,
              toolRequest(context.agent, input.tool_name, input.tool_input, context.workspacePath),
              options.signal
            )
            return {
              continue: true,
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: result.decision === 'deny' ? 'deny' : 'allow',
                permissionDecisionReason:
                  result.decision === 'deny' ? result.note || 'Denied in moi' : 'Approved in moi'
              }
            }
          }
        ]
      }
    ]
  }
}
