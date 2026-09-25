import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DATA_DIR } from './data-dir'
import {
  attachTerminal,
  createTerminal,
  getTerminal,
  killTerminal,
  listTerminals,
  renameTerminal,
  setTerminalStoreDir,
  tmuxEnvironment
} from './terminal'

test('tmux uses browser terminal capabilities under a non-interactive service', () => {
  expect(tmuxEnvironment({ TERM: 'dumb', MOI_SERVER: '1' })).toEqual({
    TERM: 'xterm-256color',
    MOI_SERVER: '1'
  })
  expect(tmuxEnvironment({ MOI_SERVER: '1' }).TERM).toBe('xterm-256color')
})

test('Bun native PTY accepts input and delivers output', async () => {
  let output = ''
  const process = Bun.spawn(['sh'], {
    terminal: {
      cols: 80,
      rows: 24,
      data: (_terminal, chunk) => {
        output += new TextDecoder().decode(chunk)
      }
    }
  })
  try {
    await Bun.sleep(100)
    process.terminal?.write('printf pty-round-trip\\n\n')
    const deadline = Date.now() + 5_000
    while (!output.includes('pty-round-trip') && Date.now() < deadline) await Bun.sleep(20)
    expect(output).toContain('pty-round-trip')
  } finally {
    process.terminal?.write('exit\n')
    process.kill()
    await process.exited
  }
}, 10_000)

if (Bun.which('tmux')) {
  test('tmux terminal survives client detach and supports rename, list, and kill', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moi-tmux-test-'))
    setTerminalStoreDir(dir)
    let entry: Awaited<ReturnType<typeof createTerminal>> | undefined
    try {
      entry = await createTerminal('workspace', dir, 'First')
      expect(await listTerminals('workspace')).toEqual([entry])
      expect((await renameTerminal('workspace', entry.id, 'Renamed'))?.name).toBe('Renamed')
      let output = ''
      const first = attachTerminal(entry.id, chunk => {
        output += new TextDecoder().decode(chunk)
      })
      await Bun.sleep(100)
      first.terminal?.write('printf reattach-marker\\n\n')
      const deadline = Date.now() + 5_000
      while (!output.includes('reattach-marker') && Date.now() < deadline) await Bun.sleep(20)
      expect(output).toContain('reattach-marker')
      first.kill()
      await first.exited
      expect(await getTerminal('workspace', entry.id)).not.toBeNull()
      let resumed = ''
      const second = attachTerminal(entry.id, chunk => {
        resumed += new TextDecoder().decode(chunk)
      })
      await Bun.sleep(100)
      second.terminal?.write('printf second-attach\\n\n')
      const secondDeadline = Date.now() + 5_000
      while (!resumed.includes('second-attach') && Date.now() < secondDeadline) await Bun.sleep(20)
      expect(resumed).toContain('second-attach')
      second.kill()
      await second.exited
      expect(await killTerminal('workspace', entry.id)).toBe(true)
      expect(await listTerminals('workspace')).toEqual([])
    } finally {
      if (entry) await killTerminal('workspace', entry.id).catch(() => {})
      setTerminalStoreDir(DATA_DIR)
      await rm(dir, { recursive: true, force: true })
    }
  })
} else {
  test.skip('tmux reattach requires tmux installed on the test host', () => {})
}
