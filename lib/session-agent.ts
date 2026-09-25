import type { SessionAgent, WorkspaceType } from './types'

export function isSessionAgent(value: unknown): value is SessionAgent {
  if (!value || typeof value !== 'object' || !('type' in value)) return false
  if (value.type === 'ollama') {
    return 'serverId' in value && typeof value.serverId === 'string' && value.serverId.length > 0
  }
  return (
    value.type === 'claude-code' ||
    value.type === 'codex' ||
    value.type === 'hermes' ||
    value.type === 'openclaw'
  )
}

export function defaultSessionAgent(type?: WorkspaceType): SessionAgent {
  return { type: type ?? 'claude-code' }
}

export function sameSessionAgent(a: SessionAgent, b: SessionAgent): boolean {
  return (
    a.type === b.type && (a.type !== 'ollama' || (b.type === 'ollama' && a.serverId === b.serverId))
  )
}
