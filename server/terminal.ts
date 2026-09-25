import Conf from 'conf'
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'

import { DATA_DIR } from './data-dir'

export type TerminalInfo = {
  id: string
  workspaceId: string
  name: string
  createdAt: number
}

type TerminalStore = { terminals: TerminalInfo[] }
let storeDir = DATA_DIR
let config: Conf<TerminalStore> | null = null

export function setTerminalStoreDir(dir: string): void {
  storeDir = dir
  config = null
}

function store(): Conf<TerminalStore> {
  config ??= new Conf<TerminalStore>({
    cwd: storeDir,
    configName: 'terminals',
    defaults: { terminals: [] }
  })
  return config
}

function sessionName(id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid terminal ID')
  return `moi-${id}`
}

async function tmux(...args: string[]): Promise<{ code: number; output: string }> {
  let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
  try {
    proc = Bun.spawn(['tmux', '-L', 'moi', ...args], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe'
    })
  } catch {
    throw new Error('tmux is not installed. Install tmux on the moi server first.')
  }
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ])
  return { code, output: (stdout || stderr).trim() }
}

export async function terminalExists(id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return false
  return (await tmux('has-session', '-t', `=${sessionName(id)}`)).code === 0
}

export async function listTerminals(workspaceId: string): Promise<TerminalInfo[]> {
  const entries = store()
    .get('terminals')
    .filter(item => item.workspaceId === workspaceId)
  const active = await Promise.all(
    entries.map(async item => ({ item, exists: await terminalExists(item.id) }))
  )
  const missing = active.filter(result => !result.exists)
  if (missing.length > 0) {
    const gone = new Set(missing.map(result => result.item.id))
    store().set(
      'terminals',
      store()
        .get('terminals')
        .filter(item => !gone.has(item.id))
    )
  }
  return active.filter(result => result.exists).map(result => result.item)
}

export async function getTerminal(workspaceId: string, id: string): Promise<TerminalInfo | null> {
  const entry = store()
    .get('terminals')
    .find(item => item.id === id && item.workspaceId === workspaceId)
  return entry && (await terminalExists(id)) ? entry : null
}

export async function createTerminal(
  workspaceId: string,
  cwd: string,
  name = 'Terminal'
): Promise<TerminalInfo> {
  const id = crypto.randomUUID()
  const entry = {
    id,
    workspaceId,
    name: name.trim().slice(0, 80) || 'Terminal',
    createdAt: Date.now()
  }
  const shell =
    process.env.SHELL && isAbsolute(process.env.SHELL) && existsSync(process.env.SHELL)
      ? process.env.SHELL
      : '/bin/sh'
  const result = await tmux('new-session', '-d', '-s', sessionName(id), '-c', cwd, shell)
  if (result.code !== 0) throw new Error(result.output || 'Could not start terminal')
  if (!(await terminalExists(id))) throw new Error('The terminal shell exited immediately')
  store().set('terminals', [...store().get('terminals'), entry])
  return entry
}

export async function renameTerminal(
  workspaceId: string,
  id: string,
  name: string
): Promise<TerminalInfo | null> {
  const entry = await getTerminal(workspaceId, id)
  if (!entry) return null
  const next = { ...entry, name: name.trim().slice(0, 80) || entry.name }
  store().set(
    'terminals',
    store()
      .get('terminals')
      .map(item => (item.id === id ? next : item))
  )
  return next
}

export async function killTerminal(workspaceId: string, id: string): Promise<boolean> {
  const entry = await getTerminal(workspaceId, id)
  if (!entry) return false
  const result = await tmux('kill-session', '-t', `=${sessionName(id)}`)
  if (result.code !== 0) throw new Error(result.output || 'Could not stop terminal')
  store().set(
    'terminals',
    store()
      .get('terminals')
      .filter(item => item.id !== id)
  )
  return true
}

export function attachTerminal(id: string, onData: (chunk: Uint8Array) => void) {
  return Bun.spawn(['tmux', '-L', 'moi', 'attach-session', '-t', `=${sessionName(id)}`], {
    cwd: storeDir,
    terminal: { cols: 80, rows: 24, data: (_terminal, chunk) => onData(chunk) }
  })
}
