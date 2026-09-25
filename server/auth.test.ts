import { describe, expect, test } from 'bun:test'

import type { AuthPolicy } from './auth'
import {
  authorizeRequest,
  checkBindHost,
  isLoopbackAddress,
  isLoopbackHostname,
  resolveAuthPolicy
} from './auth'
import { CONTROL_HOST } from './constants'

const TAILSCALE: AuthPolicy = resolveAuthPolicy(
  { auth: 'tailscale', allowedUsers: ['Me@Example.com'] },
  false
)
const OFF: AuthPolicy = resolveAuthPolicy({ auth: 'off', allowedUsers: [] }, false)

const SERVE_HOST = 'moi.tail1234.ts.net'

// What Tailscale Serve forwards for a browser on the tailnet.
function serveRequest(headers: Record<string, string> = {}, init: RequestInit = {}): Request {
  return new Request('http://127.0.0.1:13337/api/config', {
    ...init,
    headers: {
      host: '127.0.0.1:13337',
      'x-forwarded-host': SERVE_HOST,
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '100.64.0.2',
      'tailscale-user-login': 'me@example.com',
      'tailscale-headers-info': 'https://tailscale.com/s/serve-headers',
      ...headers
    }
  })
}

function localRequest(headers: Record<string, string> = {}, init: RequestInit = {}): Request {
  return new Request('http://localhost:13337/api/config', {
    ...init,
    headers: { host: 'localhost:13337', ...headers }
  })
}

describe('isLoopbackAddress', () => {
  test('accepts IPv4, IPv6, and IPv4-mapped loopback', () => {
    for (const address of ['127.0.0.1', '127.1.2.3', '::1', '[::1]', '::ffff:127.0.0.1']) {
      expect(isLoopbackAddress(address)).toBe(true)
    }
  })

  test('rejects everything else', () => {
    for (const address of [
      '100.64.0.2',
      '0.0.0.0',
      '::',
      '::ffff:10.0.0.1',
      '1127.0.0.1',
      '',
      null
    ]) {
      expect(isLoopbackAddress(address)).toBe(false)
    }
  })

  test('hostnames add localhost', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('LOCALHOST')).toBe(true)
    expect(isLoopbackHostname('localhost.evil.com')).toBe(false)
  })
})

describe('resolveAuthPolicy', () => {
  test('unset auth is off under the dev supervisor and Tailscale otherwise', () => {
    expect(resolveAuthPolicy({ auth: null, allowedUsers: [] }, true).mode).toBe('off')
    expect(resolveAuthPolicy({ auth: null, allowedUsers: [] }, false).mode).toBe('tailscale')
  })

  test('an explicit setting wins over dev', () => {
    expect(resolveAuthPolicy({ auth: 'tailscale', allowedUsers: [] }, true).mode).toBe('tailscale')
  })
})

describe('Tailscale mode', () => {
  test('allows a listed login, case-insensitively', () => {
    expect(authorizeRequest(serveRequest(), '127.0.0.1', TAILSCALE)).toEqual({
      ok: true,
      user: 'me@example.com'
    })
  })

  test('401 without an identity (direct local request, tagged device)', () => {
    const decision = authorizeRequest(localRequest(), '127.0.0.1', TAILSCALE)
    expect(decision).toMatchObject({ ok: false, status: 401 })
  })

  test('403 for a login that is not listed', () => {
    const decision = authorizeRequest(
      serveRequest({ 'tailscale-user-login': 'someone@example.com' }),
      '127.0.0.1',
      TAILSCALE
    )
    expect(decision).toMatchObject({ ok: false, status: 403 })
  })

  test('403 for an RFC 2047-encoded login', () => {
    const decision = authorizeRequest(
      serveRequest({ 'tailscale-user-login': '=?utf-8?q?m=C3=A9@example.com?=' }),
      '127.0.0.1',
      TAILSCALE
    )
    expect(decision).toMatchObject({ ok: false, status: 403 })
  })

  test('ignores identity headers from a non-loopback peer (spoofing)', () => {
    expect(authorizeRequest(serveRequest(), '100.64.0.2', TAILSCALE)).toMatchObject({
      ok: false,
      status: 401
    })
    expect(authorizeRequest(serveRequest(), '::ffff:192.168.1.5', TAILSCALE)).toMatchObject({
      ok: false,
      status: 401
    })
  })

  test('refuses Funnel traffic', () => {
    const decision = authorizeRequest(
      serveRequest({ 'tailscale-funnel-request': '?1' }),
      '127.0.0.1',
      TAILSCALE
    )
    expect(decision).toMatchObject({ ok: false, status: 403 })
  })

  test('an empty allow-list refuses everyone', () => {
    const empty = resolveAuthPolicy({ auth: 'tailscale', allowedUsers: [] }, false)
    expect(authorizeRequest(serveRequest(), '127.0.0.1', empty)).toMatchObject({ status: 403 })
  })

  test('allows same-origin browser requests and plain navigations', () => {
    const sameOrigin = serveRequest(
      { origin: `https://${SERVE_HOST}`, 'sec-fetch-site': 'same-origin' },
      { method: 'POST' }
    )
    expect(authorizeRequest(sameOrigin, '127.0.0.1', TAILSCALE).ok).toBe(true)
    const linkFromElsewhere = serveRequest({
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'navigate'
    })
    expect(authorizeRequest(linkFromElsewhere, '127.0.0.1', TAILSCALE).ok).toBe(true)
  })

  test('refuses cross-site requests even with a valid identity', () => {
    const cases = [
      serveRequest({ origin: 'https://evil.example' }, { method: 'POST' }),
      serveRequest({ origin: 'null' }, { method: 'POST' }),
      // A cross-site WebSocket or fetch; the identity is the victim's.
      serveRequest({ origin: 'https://evil.example', upgrade: 'websocket' }),
      serveRequest({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' }),
      serveRequest({ 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'no-cors' }),
      // A cross-site form POST is a navigation but not a GET.
      serveRequest(
        { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' },
        { method: 'POST' }
      )
    ]
    for (const req of cases) {
      expect(authorizeRequest(req, '127.0.0.1', TAILSCALE)).toMatchObject({
        ok: false,
        status: 403
      })
    }
  })
})

describe('auth off', () => {
  test('allows direct loopback requests', () => {
    expect(authorizeRequest(localRequest(), '127.0.0.1', OFF)).toEqual({ ok: true, user: null })
    expect(authorizeRequest(localRequest({ host: '[::1]:13337' }), '::1', OFF).ok).toBe(true)
  })

  test('the bypass never applies off loopback', () => {
    expect(authorizeRequest(localRequest(), '100.64.0.2', OFF)).toMatchObject({ status: 401 })
    expect(authorizeRequest(localRequest(), null, OFF)).toMatchObject({ status: 401 })
  })

  test('refuses anything that came through a proxy, including Tailscale Serve', () => {
    const proxied: Record<string, string>[] = [
      { 'x-forwarded-for': '100.64.0.2' },
      { 'x-forwarded-host': SERVE_HOST },
      { forwarded: 'for=100.64.0.2' },
      { 'x-real-ip': '100.64.0.2' },
      { 'tailscale-user-login': 'me@example.com' },
      { 'tailscale-funnel-request': '?1' }
    ]
    for (const headers of proxied) {
      expect(authorizeRequest(localRequest(headers), '127.0.0.1', OFF)).toMatchObject({
        ok: false,
        status: 401
      })
    }
  })

  test('refuses a non-loopback Host (DNS rebinding)', () => {
    const decision = authorizeRequest(
      localRequest({ host: 'evil.example:13337' }),
      '127.0.0.1',
      OFF
    )
    expect(decision).toMatchObject({ ok: false, status: 403 })
  })

  test('refuses cross-site requests', () => {
    const req = localRequest({ origin: 'http://evil.example' }, { method: 'POST' })
    expect(authorizeRequest(req, '127.0.0.1', OFF)).toMatchObject({ ok: false, status: 403 })
    const sameOrigin = localRequest({ origin: 'http://localhost:13337' }, { method: 'POST' })
    expect(authorizeRequest(sameOrigin, '127.0.0.1', OFF).ok).toBe(true)
  })
})

describe('checkBindHost', () => {
  test('loopback binds are always fine', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]']) {
      expect(checkBindHost(host, OFF)).toEqual({ ok: true })
      expect(checkBindHost(host, TAILSCALE)).toEqual({ ok: true })
    }
  })

  test('auth off refuses a non-loopback bind', () => {
    for (const host of ['0.0.0.0', '::', '100.64.0.1', 'my-host']) {
      expect(checkBindHost(host, OFF).ok).toBe(false)
    }
  })

  test('Tailscale auth warns on a non-loopback bind', () => {
    const check = checkBindHost('0.0.0.0', TAILSCALE)
    expect(check.ok).toBe(true)
    expect(check.ok && check.warning).toContain('0.0.0.0')
  })
})

test('the control port is loopback-only and has no HOST override', async () => {
  expect(CONTROL_HOST).toBe('127.0.0.1')
  // The control server must bind this constant, never an env-derived host.
  const source = await Bun.file(new URL('./control.ts', import.meta.url)).text()
  expect(source).toContain('hostname: CONTROL_HOST')
})
