import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { saveAppSettings, setAppSettingsDir } from '../app-settings'
import { DATA_DIR } from '../data-dir'
import { localMcpConfig } from './mcp'

const dirs: string[] = []
afterEach(async () => {
  setAppSettingsDir(DATA_DIR)
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

test('local MCP profile uses only named project servers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moi-local-mcp-'))
  dirs.push(dir)
  setAppSettingsDir(dir)
  await Bun.write(
    join(dir, '.mcp.json'),
    JSON.stringify({
      mcpServers: {
        chosen: { command: 'bun', args: ['chosen.ts'] },
        ignored: { command: 'bun', args: ['ignored.ts'] }
      }
    })
  )
  expect(await localMcpConfig(dir)).toEqual({})
  saveAppSettings({ localMcpServers: ['chosen'] })
  expect(await localMcpConfig(dir)).toEqual({ chosen: { command: 'bun', args: ['chosen.ts'] } })
})
