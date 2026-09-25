import type { PermissionMode, SessionAgent, SessionInfo, WorkspaceEntry } from '@/lib/types'
import { defaultSessionAgent, sameSessionAgent } from '@/lib/session-agent'

import { getAppSettings } from './app-settings'
import { allHarnesses, harnessFor } from './harness/registry'
import type { Harness, WorkspaceActivityPreview } from './harness/types'
import { cachedOllamaModels } from './ollama/discovery'
import {
  bindDiscoveredSessionAgents,
  getSessionConfig,
  getSessionConfigs,
  saveSessionConfig
} from './session-config'
import { installBundledSkills } from './skills-template'
import { permissionModeFor } from './permissions/pending'

export function harnessForSessionAgent(agent: SessionAgent): Harness {
  return harnessFor(agent.type === 'ollama' ? 'claude-code' : agent.type)
}

export async function sessionAgentFor(
  ws: WorkspaceEntry,
  sessionId: string
): Promise<SessionAgent> {
  const stored = (await getSessionConfig(ws.path, sessionId)).agent
  if (stored) return stored
  // Legacy histories have no binding until first listed. Resolve before a
  // direct events/archive request rather than assuming the workspace default.
  const discovered = await listWorkspaceSessions(ws)
  return (
    discovered.find(session => session.sessionId === sessionId)?.agent ??
    defaultSessionAgent(ws.type)
  )
}

// The browser chooses an agent, not an executable path or environment. Ollama
// server IDs resolve only through validated server-side settings.
export async function bindSessionAgent(
  ws: WorkspaceEntry,
  sessionId: string,
  agent: SessionAgent
): Promise<void> {
  if (agent.type === 'ollama') {
    if (!getAppSettings().ollamaServers.some(server => server.id === agent.serverId)) {
      throw new Error('This Ollama server is no longer configured')
    }
  }
  const current = await getSessionConfig(ws.path, sessionId)
  if (current.agent && !sameSessionAgent(current.agent, agent)) {
    throw new Error('A chat cannot change agents; start a new chat instead')
  }
  if (!current.agent) {
    const skillsDir = harnessForSessionAgent(agent).skillsDir?.(ws.path)
    if (skillsDir) await installBundledSkills(skillsDir)
    await saveSessionConfig(ws.path, sessionId, { agent })
  }
}

export async function resolveSessionRun(
  ws: WorkspaceEntry,
  sessionId: string,
  requestedAgent: SessionAgent | undefined,
  requestedModel: string | undefined,
  requestedPermissionMode?: PermissionMode
): Promise<{
  harness: Harness
  agent: SessionAgent
  model: string | undefined
  agentEnv?: Record<string, string>
  permissionMode: PermissionMode
}> {
  const existing = await getSessionConfig(ws.path, sessionId)
  if (existing.agent && requestedAgent && !sameSessionAgent(existing.agent, requestedAgent)) {
    throw new Error('A chat cannot change agents; start a new chat instead')
  }
  const agent = existing.agent ?? requestedAgent ?? defaultSessionAgent(ws.type)
  const permissionMode =
    existing.permissionMode ?? requestedPermissionMode ?? permissionModeFor(agent)
  if (agent.type === 'codex' && permissionMode === 'ask-all')
    throw new Error('Codex cannot ask before every tool call')
  const harness = harnessForSessionAgent(agent)
  if (agent.type !== 'ollama') {
    await bindSessionAgent(ws, sessionId, agent)
    if (!existing.permissionMode) await saveSessionConfig(ws.path, sessionId, { permissionMode })
    return { harness, agent, model: requestedModel, permissionMode }
  }

  const server = getAppSettings().ollamaServers.find(item => item.id === agent.serverId)
  if (!server) throw new Error('This Ollama server is no longer configured')
  const model = requestedModel ?? existing.model
  if (!model) throw new Error('Choose an Ollama model before sending')
  const available = await cachedOllamaModels(server)
  if (!available.some(item => item.name === model && item.supportsTools)) {
    throw new Error('This Ollama model is unavailable or does not support tools')
  }
  await bindSessionAgent(ws, sessionId, agent)
  if (!existing.permissionMode) await saveSessionConfig(ws.path, sessionId, { permissionMode })
  return {
    harness,
    agent,
    model,
    permissionMode,
    agentEnv: {
      ANTHROPIC_BASE_URL: server.baseUrl,
      ANTHROPIC_AUTH_TOKEN: 'ollama',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: model
    }
  }
}

// Merge histories from every harness available in this workspace. A stored
// binding is authoritative for dispatch and keeps Ollama-backed Claude sessions
// distinct from subscription-backed Claude sessions.
export async function listWorkspaceSessions(ws: WorkspaceEntry): Promise<SessionInfo[]> {
  const harnesses = sessionHarnesses(ws)
  const [configs, ...lists] = await Promise.all([
    getSessionConfigs(ws.path),
    ...harnesses.map(harness => harness.listSessions(ws).catch(() => []))
  ])
  const discovered: { sessionId: string; agent: SessionAgent }[] = []
  const sessions: SessionInfo[] = []
  const seen = new Set<string>()
  lists.forEach((list, index) => {
    const agent = defaultSessionAgent(harnesses[index].id)
    for (const session of list) {
      const bound = configs[session.sessionId]?.agent
      if (bound && harnessForSessionAgent(bound).id !== harnesses[index].id) continue
      if (seen.has(session.sessionId)) continue
      seen.add(session.sessionId)
      if (!bound) discovered.push({ sessionId: session.sessionId, agent })
      sessions.push({ ...session, agent: bound ?? agent })
    }
  })
  await bindDiscoveredSessionAgents(ws.path, discovered)
  return sessions.sort((a, b) => b.lastModified - a.lastModified)
}

function sessionHarnesses(ws: WorkspaceEntry): Harness[] {
  return allHarnesses()
    .filter(
      harness => harness.id === 'claude-code' || harness.id === 'codex' || harness.id === ws.type
    )
    .sort((a, b) => Number(b.id === ws.type) - Number(a.id === ws.type))
}

export async function workspaceSessionPreview(
  ws: WorkspaceEntry,
  includeFirstUserMessage: boolean
): Promise<WorkspaceActivityPreview> {
  const previews = await Promise.all(
    sessionHarnesses(ws).map(harness =>
      harness
        .workspacePreview(ws, includeFirstUserMessage)
        .catch((): WorkspaceActivityPreview => ({}))
    )
  )
  return previews.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] ?? {}
}
