// moi's side of shared memory (Phase 6): digest injection before chat sends,
// the `moi memory add` path, and the Jev spend the service reports.

import { hostname } from 'os'

import {
  MEMORY_DIGEST_LIMIT,
  renderMemoryDirectives,
  type MemoryRememberResult,
  type MemoryScope
} from '@/lib/memory'
import type { MoiContext } from '@/lib/moi-context'
import type { SessionAgent } from '@/lib/types'

import { fetchDigest, memoryApi, memoryServiceUrl } from './client'
import { memoryProjectFor } from './project'

export { MemoryServiceError, memoryApi, memoryServiceUrl } from './client'
export { memoryProjectFor } from './project'

const MAX_CONTEXT_CHARS = 500

// Append the memory digest to a chat send's context. Returns the context
// unchanged when memory is off, the service is slow or unreachable, or there
// is nothing to add. Brand-new chats carry a temporary id, so their first send
// asks for no session memories and advertises no session id.
export async function withMemoryDigest(
  context: MoiContext | undefined,
  input: { workspacePath: string; sessionId: string; isNew: boolean; content: string }
): Promise<MoiContext | undefined> {
  if (!context || !memoryServiceUrl()) return context
  const sessionId = input.isNew ? null : input.sessionId
  const digest = await fetchDigest({
    project: await memoryProjectFor(input.workspacePath),
    sessionId,
    message: input.content.slice(0, MAX_CONTEXT_CHARS),
    limit: MEMORY_DIGEST_LIMIT
  })
  if (!digest) return context
  const lines = renderMemoryDirectives(digest, sessionId)
  if (lines.length === 0) return context
  return { ...context, directives: [...(context.directives ?? []), ...lines] }
}

export function agentLabel(agent: SessionAgent | undefined): string | null {
  if (!agent) return null
  return agent.type === 'ollama' ? `ollama:${agent.serverId}` : agent.type
}

// `moi memory add`: save a fact for the workspace's project (or globally, or
// for one chat), with provenance from the chat's agent binding when known.
export async function addMemory(input: {
  workspacePath: string
  text: string
  scope: MemoryScope
  sessionId?: string
  agent?: SessionAgent
  model?: string
}): Promise<MemoryRememberResult> {
  return memoryApi.remember({
    text: input.text,
    scope: input.scope,
    project: input.scope === 'global' ? undefined : await memoryProjectFor(input.workspacePath),
    sessionId: input.scope === 'session' ? input.sessionId : undefined,
    provenance: {
      agent: agentLabel(input.agent) ?? 'moi-cli',
      model: input.model ?? null,
      machine: hostname()
    }
  })
}
