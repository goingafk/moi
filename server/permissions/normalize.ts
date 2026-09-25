import type { SessionAgent } from '@/lib/types'
import type { ToolRequest } from './classify'

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function toolRequest(
  agent: SessionAgent,
  tool: string,
  input: unknown,
  workspaceRoot: string
): ToolRequest {
  const fields = object(input)
  const command =
    typeof fields.command === 'string'
      ? fields.command
      : Array.isArray(fields.command) && fields.command.every(item => typeof item === 'string')
        ? fields.command.join(' ')
        : undefined
  const cwd = typeof fields.cwd === 'string' ? fields.cwd : workspaceRoot
  const paths = ['path', 'file_path', 'filePath', 'target', 'destination', 'old_path', 'new_path']
    .map(key => fields[key])
    .filter((value): value is string => typeof value === 'string')
  return { agent, tool, command, paths, cwd, workspaceRoot }
}
