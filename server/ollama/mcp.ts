import { join } from 'node:path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'

import { getAppSettings } from '../app-settings'

// Strict mode ignores every ambient MCP source. Only named project entries
// are passed explicitly to the local model; defaults to no MCP servers.
export async function localMcpConfig(
  workspacePath: string
): Promise<NonNullable<Options['mcpServers']>> {
  const allowed = new Set(getAppSettings().localMcpServers)
  if (allowed.size === 0) return {}
  let document: unknown
  try {
    document = await Bun.file(join(workspacePath, '.mcp.json')).json()
  } catch {
    return {}
  }
  if (!document || typeof document !== 'object' || !('mcpServers' in document)) return {}
  const servers = document.mcpServers
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return {}
  return Object.fromEntries(
    Object.entries(servers).filter(
      ([name, value]) =>
        allowed.has(name) && value !== null && typeof value === 'object' && !Array.isArray(value)
    )
  ) as NonNullable<Options['mcpServers']>
}
