import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parse } from 'shell-quote'

import type { PermissionRule, PermissionSettings, SessionAgent } from '@/lib/types'
import { DATA_DIR } from '../data-dir'

export type ToolRequest = {
  agent: SessionAgent
  tool: string
  command?: string
  paths?: string[]
  cwd: string
  workspaceRoot: string
}

export type Risk = { level: 'safe' | 'risky'; rule?: PermissionRule | 'alwaysAsk'; reason: string }

const SAFE: Risk = { level: 'safe', reason: 'No enabled risk rule matched' }
const SHELL_TOOLS = new Set(['Bash', 'bash', 'shell', 'exec_command', 'commandExecution'])
const NETWORK_TOOLS = /(?:web|fetch|search|http|browser)/i
const WRITE_TOOLS = /(?:write|edit|patch|delete|move|rename)/i
const READ_ONLY_SHELL = new Set([
  'pwd',
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'stat',
  'grep',
  'rg',
  'echo',
  'printf',
  'test',
  'true',
  'false'
])
const READ_ONLY_GIT = new Set(['status', 'log', 'diff', 'show'])
const CLASSIFIED_SHELL = new Set([
  'rm',
  'rmdir',
  'unlink',
  'mv',
  'curl',
  'wget',
  'ssh',
  'scp',
  'rsync',
  'nc',
  'sudo',
  'su',
  'kill',
  'pkill',
  'launchctl',
  'systemctl',
  'crontab',
  'chmod',
  'chown'
])

function existingRealpath(path: string): string {
  let current = path
  const missing: string[] = []
  while (true) {
    try {
      return resolve(realpathSync(current), ...missing.reverse())
    } catch {
      const parent = dirname(current)
      if (parent === current) return path
      missing.push(current.slice(parent.length + (parent === '/' ? 0 : 1)))
      current = parent
    }
  }
}

function inside(root: string, path: string): boolean {
  const rel = relative(existingRealpath(root), existingRealpath(path))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function expandPath(path: string, cwd: string): string {
  if (path.startsWith('~/')) return join(process.env.HOME ?? cwd, path.slice(2))
  return resolve(cwd, path)
}

function matchesPattern(pattern: string, request: ToolRequest): boolean {
  const [kind, value] = pattern.includes(':') ? pattern.split(/:(.*)/s, 2) : ['command', pattern]
  if (kind === 'tool') return request.tool === value
  if (kind === 'command') return (request.command ?? '').startsWith(value)
  if (kind === 'path') {
    const regex = new RegExp(
      `^${value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`
    )
    return (request.paths ?? []).some(path => regex.test(path))
  }
  return false
}

export function classifyTool(request: ToolRequest, settings: PermissionSettings): Risk {
  if (settings.alwaysAsk.some(pattern => matchesPattern(pattern, request)))
    return { level: 'risky', rule: 'alwaysAsk', reason: 'Always ask rule matched' }
  if (settings.alwaysAllow.some(pattern => matchesPattern(pattern, request))) return SAFE
  const risky = (rule: PermissionRule, reason: string): Risk | undefined =>
    settings.rules[rule] ? { level: 'risky', rule, reason } : undefined
  const paths = [...(request.paths ?? [])]
  if (
    settings.rules.sensitiveFiles &&
    paths.some(
      path =>
        /(^|\/)(\.env[^/]*|\.ssh|\.claude|\.codex|\.bashrc|\.zshrc|\.profile)(\/|$)/.test(path) ||
        inside(DATA_DIR, expandPath(path, request.cwd))
    )
  )
    return risky('sensitiveFiles', 'Touches a sensitive file or moi data')!
  if (
    settings.rules.outsideProject &&
    (!inside(request.workspaceRoot, request.cwd) ||
      paths.some(path => !inside(request.workspaceRoot, expandPath(path, request.cwd))))
  )
    return risky('outsideProject', 'Path is outside this workspace')!
  if (NETWORK_TOOLS.test(request.tool) && settings.rules.network)
    return risky('network', 'Network-capable tool')!
  if (/(?:delete|remove)/i.test(request.tool) && settings.rules.deletes)
    return risky('deletes', 'Delete tool')!
  if (!SHELL_TOOLS.has(request.tool)) {
    if (['Read', 'Glob', 'Grep', 'TodoWrite', 'TaskCreate', 'TaskUpdate'].includes(request.tool))
      return SAFE
    return (
      risky(
        'unparseableShell',
        WRITE_TOOLS.test(request.tool) ? 'Unclassified write tool' : 'Unclassified tool'
      ) ?? SAFE
    )
  }

  const command = request.command ?? ''
  if (!command || /[`$\n\r]/.test(command))
    return risky('unparseableShell', 'Shell expansion or command substitution') ?? SAFE
  let words: string[]
  try {
    const parsed = parse(command)
    if (parsed.some(item => typeof item !== 'string'))
      return risky('unparseableShell', 'Compound or unparseable shell command') ?? SAFE
    words = parsed as string[]
  } catch {
    return risky('unparseableShell', 'Could not parse shell command') ?? SAFE
  }
  const executable = words[0]?.split('/').pop() ?? ''
  if (!executable || executable === 'eval')
    return risky('unparseableShell', 'Dynamic shell command') ?? SAFE
  if (
    settings.rules.deletes &&
    (['rm', 'rmdir', 'unlink'].includes(executable) ||
      (executable === 'find' && words.includes('-delete')) ||
      (executable === 'git' && words[1] === 'rm') ||
      (executable === 'mv' && !words.includes('-n') && !words.includes('--no-clobber')))
  )
    return risky('deletes', 'Deletes files or may overwrite the destination')!
  if (
    executable === 'git' &&
    settings.rules.gitDangerous &&
    (/^(push|rebase)$/.test(words[1] ?? '') ||
      words.includes('--force') ||
      (words[1] === 'reset' && words.includes('--hard')) ||
      (words[1] === 'clean' &&
        words.slice(2).some(word => /^-[a-z]*f/.test(word) || word === '--force')) ||
      (words[1] === 'branch' && words.includes('-D')) ||
      (words[1] === 'checkout' && (words.includes('--') || words.includes('-f'))) ||
      (words[1] === 'restore' && !words.includes('--staged')) ||
      (words[1] === 'commit' && words.includes('--amend')) ||
      (words[1] === 'stash' && ['drop', 'clear'].includes(words[2] ?? '')))
  )
    return risky('gitDangerous', 'Publishes or discards Git work')!
  if (
    settings.rules.network &&
    (['curl', 'wget', 'ssh', 'scp', 'rsync', 'nc'].includes(executable) ||
      (['bun', 'npm', 'pnpm', 'yarn', 'pip', 'brew', 'cargo'].includes(executable) &&
        words.some(word => ['add', 'install'].includes(word))))
  )
    return risky('network', 'Network or package-install command')!
  if (
    settings.rules.system &&
    ['sudo', 'su', 'kill', 'pkill', 'launchctl', 'systemctl', 'crontab'].includes(executable)
  )
    return risky('system', 'Privileged or system command')!
  if (
    settings.rules.system &&
    ['chmod', 'chown'].includes(executable) &&
    words
      .slice(1)
      .some(
        word => word.includes('/') && !inside(request.workspaceRoot, expandPath(word, request.cwd))
      )
  )
    return risky('system', 'Changes permissions outside this workspace')!
  if (
    words.slice(1).some(word => word.startsWith('-') && word.includes('/') && !word.includes('='))
  )
    return risky('unparseableShell', 'Option contains a path that cannot be normalized') ?? SAFE
  // A bare relative argument can itself be a symlink out of the workspace.
  // Looking only for '/' or './' misses e.g. `cat linked/file` and `cat linked`.
  const argumentsWithPaths = words
    .slice(1)
    .map(word =>
      word.startsWith('--') && word.includes('=') ? word.slice(word.indexOf('=') + 1) : word
    )
    .filter(word => word && !word.startsWith('-') && !/^[a-z][a-z0-9+.-]*:\/\//i.test(word))
  for (const path of argumentsWithPaths) {
    const full = expandPath(path, request.cwd)
    if (
      settings.rules.sensitiveFiles &&
      (/(^|\/)(\.env[^/]*|\.ssh|\.claude|\.codex|\.bashrc|\.zshrc|\.profile)(\/|$)/.test(full) ||
        inside(DATA_DIR, full))
    )
      return risky('sensitiveFiles', 'Touches a sensitive file or moi data')!
    if (settings.rules.outsideProject && !inside(request.workspaceRoot, full))
      return risky('outsideProject', 'Path is outside this workspace')!
  }
  const knownGit =
    executable === 'git' &&
    (READ_ONLY_GIT.has(words[1] ?? '') ||
      [
        'push',
        'rebase',
        'reset',
        'clean',
        'branch',
        'checkout',
        'restore',
        'commit',
        'stash',
        'rm'
      ].includes(words[1] ?? ''))
  const knownPackageInstall =
    ['bun', 'npm', 'pnpm', 'yarn', 'pip', 'brew', 'cargo'].includes(executable) &&
    words.some(word => ['add', 'install'].includes(word))
  const knownFind =
    executable === 'find' &&
    !words.some(word => ['-exec', '-execdir', '-ok', '-okdir'].includes(word))
  if (
    settings.rules.unparseableShell &&
    !(
      READ_ONLY_SHELL.has(executable) ||
      CLASSIFIED_SHELL.has(executable) ||
      knownGit ||
      knownPackageInstall ||
      knownFind
    )
  )
    return risky('unparseableShell', 'Command is not in the known-safe shell set')!
  return SAFE
}
