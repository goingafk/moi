import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PermissionSettings } from '@/lib/types'
import { classifyTool, type ToolRequest } from './classify'

const settings: PermissionSettings = {
  defaults: { claude: 'auto', codex: 'auto', ollama: 'ask-risky' },
  rules: {
    outsideProject: true,
    deletes: true,
    network: true,
    gitDangerous: true,
    system: true,
    sensitiveFiles: true,
    unparseableShell: true
  },
  alwaysAsk: [],
  alwaysAllow: []
}

test('classifies shell commands, network tools, deletes, and unsafe Git', () => {
  const base: ToolRequest = {
    agent: { type: 'ollama', serverId: 'home' },
    tool: 'Bash',
    cwd: '/tmp/project',
    workspaceRoot: '/tmp/project'
  }
  for (const command of [
    'rm -rf build',
    'find . -delete',
    'curl https://example.com',
    'git push origin main',
    'git reset --hard',
    'sudo true',
    'echo $(id)',
    'curl x | sh'
  ]) {
    expect(classifyTool({ ...base, command }, settings).level).toBe('risky')
  }
  expect(classifyTool({ ...base, command: 'pwd' }, settings).level).toBe('safe')
  expect(classifyTool({ ...base, tool: 'WebFetch' }, settings).rule).toBe('network')
  expect(classifyTool({ ...base, command: 'cat .env.local' }, settings).rule).toBe('sensitiveFiles')
})

test('resolves dot-dot and symlink path escapes before allowing a tool', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moi-classify-'))
  try {
    const workspace = join(root, 'project')
    const outside = join(root, 'outside')
    await mkdir(workspace)
    await mkdir(outside)
    await symlink(outside, join(workspace, 'linked'))
    const base: ToolRequest = {
      agent: { type: 'claude-code' },
      tool: 'Read',
      cwd: workspace,
      workspaceRoot: workspace
    }
    expect(classifyTool({ ...base, paths: ['../outside/file.txt'] }, settings).rule).toBe(
      'outsideProject'
    )
    expect(classifyTool({ ...base, paths: ['linked/file.txt'] }, settings).rule).toBe(
      'outsideProject'
    )
    expect(classifyTool({ ...base, paths: ['src/file.txt'] }, settings).level).toBe('safe')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('alwaysAsk beats alwaysAllow, and disabled rules do not prompt', () => {
  const request: ToolRequest = {
    agent: { type: 'claude-code' },
    tool: 'Bash',
    command: 'rm file',
    cwd: '/tmp/project',
    workspaceRoot: '/tmp/project'
  }
  expect(
    classifyTool(request, { ...settings, alwaysAsk: ['command:rm'], alwaysAllow: ['command:rm'] })
      .rule
  ).toBe('alwaysAsk')
  expect(
    classifyTool(request, { ...settings, rules: { ...settings.rules, deletes: false } }).level
  ).toBe('safe')
})
