// Auth against a real server process: Bun's peer address, route wrappers, and
// the WebSocket upgrade path, which unit tests of `authorizeRequest` can't see.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dir, '..', '..')
const ALLOWED = 'me@example.com'

type Server = { url: string; proc: ReturnType<typeof Bun.spawn> }

let home: string

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'moi-auth-e2e-'))
})

afterAll(async () => {
  await rm(home, { recursive: true, force: true })
})

function freePort(): number {
  const listener = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } })
  const port = listener.port
  listener.stop(true)
  return port
}

function spawnServer(env: Record<string, string>) {
  const port = freePort()
  const proc = Bun.spawn(['bun', join(REPO_ROOT, 'server', 'cli.ts'), 'start'], {
    cwd: REPO_ROOT,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      HOME: home,
      MOI_SERVER: '1',
      MOI_DATA_DIR: join(home, 'moi-data'),
      PORT: String(port),
      MOI_CONTROL_PORT: String(freePort()),
      NO_COLOR: '1',
      ...env
    }
  })
  return { proc, port }
}

// Any HTTP answer (even 401) means the server is listening.
async function startServer(env: Record<string, string>): Promise<Server> {
  const { proc, port } = spawnServer(env)
  const url = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`server exited early (${proc.exitCode})`)
    try {
      await (await fetch(`${url}/api/config`)).arrayBuffer()
      return { url, proc }
    } catch {}
    await Bun.sleep(100)
  }
  throw new Error('server never came up')
}

async function stopServer(server: Server | undefined): Promise<void> {
  if (!server || server.proc.exitCode !== null) return
  server.proc.kill('SIGKILL')
  await server.proc.exited
}

// Resolves 'open' once the socket delivers its first frame (the chat socket
// sends a status snapshot on connect), 'rejected' if the upgrade fails.
function tryWebSocket(url: string, headers: Record<string, string>): Promise<'open' | 'rejected'> {
  return new Promise(resolve => {
    // Bun's WebSocket takes `{ headers }`; the DOM constructor type only knows
    // protocols, so the options object is cast past it.
    const options = { headers } as unknown as string[]
    const ws = new WebSocket(url.replace(/^http/, 'ws') + '/ws', options)
    const timer = setTimeout(() => {
      ws.close()
      resolve('rejected')
    }, 10_000)
    ws.onmessage = () => {
      clearTimeout(timer)
      ws.close()
      resolve('open')
    }
    ws.onerror = () => {
      clearTimeout(timer)
      resolve('rejected')
    }
    ws.onclose = () => {
      clearTimeout(timer)
      resolve('rejected')
    }
  })
}

function serveHeaders(login: string, host = 'moi.tail1234.ts.net'): Record<string, string> {
  return {
    host,
    'x-forwarded-host': host,
    'x-forwarded-proto': 'https',
    'x-forwarded-for': '100.64.0.2',
    'tailscale-user-login': login,
    'tailscale-headers-info': 'https://tailscale.com/s/serve-headers'
  }
}

describe('Tailscale mode', () => {
  let server: Server | undefined

  beforeAll(async () => {
    server = await startServer({ MOI_AUTH: 'tailscale', MOI_ALLOWED_USERS: ALLOWED })
  }, 70_000)

  afterAll(() => stopServer(server))

  test('unauthenticated HTTP gets 401', async () => {
    for (const path of ['/api/config', '/api/settings', '/status']) {
      const res = await fetch(server!.url + path)
      expect(res.status).toBe(401)
      await res.arrayBuffer()
    }
  })

  test('an allowed identity gets through', async () => {
    const res = await fetch(`${server!.url}/api/config`, { headers: serveHeaders(ALLOWED) })
    expect(res.status).toBe(200)
    expect(await res.json()).toHaveProperty('cloudDemo')
  })

  test('a disallowed identity gets 403', async () => {
    const res = await fetch(`${server!.url}/api/config`, {
      headers: serveHeaders('someone@example.com')
    })
    expect(res.status).toBe(403)
    await res.arrayBuffer()
  })

  test('WebSocket upgrades need an allowed identity and a same-site origin', async () => {
    expect(await tryWebSocket(server!.url, {})).toBe('rejected')
    expect(await tryWebSocket(server!.url, serveHeaders('someone@example.com'))).toBe('rejected')
    expect(
      await tryWebSocket(server!.url, {
        ...serveHeaders(ALLOWED),
        origin: 'https://evil.example'
      })
    ).toBe('rejected')
    expect(
      await tryWebSocket(server!.url, {
        ...serveHeaders(ALLOWED),
        origin: 'https://moi.tail1234.ts.net'
      })
    ).toBe('open')
  }, 30_000)
})

describe('auth off', () => {
  let server: Server | undefined

  beforeAll(async () => {
    server = await startServer({ MOI_AUTH: 'off' })
  }, 70_000)

  afterAll(() => stopServer(server))

  test('direct loopback requests work, over HTTP and WebSocket', async () => {
    const res = await fetch(`${server!.url}/api/config`)
    expect(res.status).toBe(200)
    await res.arrayBuffer()
    expect(await tryWebSocket(server!.url, {})).toBe('open')
  }, 30_000)

  test('proxied requests are refused, even with a Tailscale identity', async () => {
    const res = await fetch(`${server!.url}/api/config`, { headers: serveHeaders(ALLOWED) })
    expect(res.status).toBe(401)
    await res.arrayBuffer()
    expect(await tryWebSocket(server!.url, serveHeaders(ALLOWED))).toBe('rejected')
  }, 30_000)
})

test('auth off refuses to start on a non-loopback HOST', async () => {
  const { proc } = spawnServer({ MOI_AUTH: 'off', HOST: '0.0.0.0' })
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
  expect(code).not.toBe(0)
  expect(stderr).toContain('Refusing to listen on 0.0.0.0 with auth off')
}, 60_000)

test('Tailscale auth refuses to start on a non-loopback HOST', async () => {
  const { proc } = spawnServer({
    MOI_AUTH: 'tailscale',
    MOI_ALLOWED_USERS: ALLOWED,
    HOST: '0.0.0.0'
  })
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
  expect(code).not.toBe(0)
  expect(stderr).toContain('Refusing to listen on 0.0.0.0 with auth tailscale')
}, 60_000)
