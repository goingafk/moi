import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'

type QueryCall = {
  options: {
    cwd: string
    settingSources: string[]
    pathToClaudeCodeExecutable: string
    strictMcpConfig?: boolean
    mcpServers?: Record<string, unknown>
    env?: Record<string, string | undefined>
  }
}

const queryCalls: QueryCall[] = []
const agentSdk = await import('@anthropic-ai/claude-agent-sdk')
let closeError: Error | null = null

mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  // Module mocks are process-wide in Bun. Preserve the real SDK exports so
  // tests loaded after this file can still import session helpers.
  ...agentSdk,
  query: (call: QueryCall) => {
    queryCalls.push(call)
    return {
      mcpServerStatus: async () => [],
      close: () => {
        if (closeError) throw closeError
      }
    }
  }
}))

const { getMcpStatus } = await import('./mcp')

let logSpy: ReturnType<typeof spyOn>
let whichSpy: ReturnType<typeof spyOn>

beforeEach(() => {
  queryCalls.length = 0
  closeError = null
  logSpy = spyOn(console, 'log').mockImplementation(() => {})
  whichSpy = spyOn(Bun, 'which').mockImplementation(command =>
    command === 'claude' ? '/test/bin/claude' : null
  )
})

afterEach(() => {
  logSpy.mockRestore()
  whichSpy.mockRestore()
})

test('SDK mock preserves unrelated session exports', async () => {
  const sdk = await import('@anthropic-ai/claude-agent-sdk')

  expect(sdk.getSessionMessages).toBe(agentSdk.getSessionMessages)
  expect(sdk.listSessions).toBe(agentSdk.listSessions)
})

test('MCP status probes effective user and project settings for the workspace', async () => {
  await getMcpStatus('/test/workspace/effective')

  expect(queryCalls).toHaveLength(1)
  expect(queryCalls[0]?.options.cwd).toBe('/test/workspace/effective')
  expect(queryCalls[0]?.options.settingSources).toEqual(['user', 'project'])
  expect(queryCalls[0]?.options.pathToClaudeCodeExecutable).toBe('/test/bin/claude')
})

test('settled MCP status survives an SDK cleanup error', async () => {
  closeError = new Error('Query closed before response received')

  expect(await getMcpStatus('/test/workspace/close-error')).toEqual([])
})

test('local MCP status uses only its explicit allow-list and Ollama env', async () => {
  expect(
    await getMcpStatus('/test/workspace/local-empty', {
      baseUrl: 'http://127.0.0.1:11434',
      servers: {}
    })
  ).toEqual([])
  expect(queryCalls).toHaveLength(0)
  await getMcpStatus('/test/workspace/local-allowed', {
    baseUrl: 'http://127.0.0.1:11434',
    servers: { chosen: { command: 'bun', args: ['server.ts'] } }
  })
  expect(queryCalls[0]?.options).toMatchObject({
    strictMcpConfig: true,
    settingSources: ['project'],
    mcpServers: { chosen: { command: 'bun', args: ['server.ts'] } },
    env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:11434', ANTHROPIC_AUTH_TOKEN: 'ollama' }
  })
})
