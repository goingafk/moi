// Who may use the HTTP port (API, WebSockets, /status). Two modes:
//
// - 'tailscale': moi sits behind Tailscale Serve on the same machine. Serve
//   connects from loopback, strips any client-sent `Tailscale-User-*` headers,
//   and sets `Tailscale-User-Login` for untagged tailnet users (never for
//   Funnel, which gets `Tailscale-Funnel-Request` instead). Only loopback
//   requests carrying an allowed login pass. Verified against
//   tailscale/ipn/ipnlocal/serve.go (`addTailscaleIdentityHeaders`) and
//   https://tailscale.com/kb/1312/serve — see docs/fork/remote-setup.md.
// - 'off': local use only. Direct loopback requests with a loopback Host and
//   no proxy headers pass; anything that came through a proxy is refused.
//
// Loopback is the trust boundary in both modes: a process on this machine can
// already forge Serve's headers, and can already drive the (unauthenticated,
// loopback-only) control port. Both modes also refuse cross-site browser
// requests, because Serve stamps the identity of whoever's browser sent the
// request — including a request a malicious page made on their behalf.
import type { AppConfig, AuthSetting } from './app-config'
import { getAppConfig } from './app-config'

export type AuthMode = AuthSetting

export type AuthPolicy = {
  mode: AuthMode
  // Lowercased.
  allowedUsers: ReadonlySet<string>
}

export type AuthDecision =
  | { ok: true; user: string | null }
  | { ok: false; status: 401 | 403; reason: string }

export function resolveAuthPolicy(
  config: Pick<AppConfig, 'auth' | 'allowedUsers'>,
  dev: boolean
): AuthPolicy {
  return {
    mode: config.auth ?? (dev ? 'off' : 'tailscale'),
    allowedUsers: new Set(config.allowedUsers.map(user => user.trim().toLowerCase()))
  }
}

let _policy: AuthPolicy | null = null

export function getAuthPolicy(): AuthPolicy {
  _policy ??= resolveAuthPolicy(getAppConfig(), Boolean(process.env.MOI_DEV))
  return _policy
}

// Test seam, alongside `resetAppConfig`.
export function resetAuthPolicy(): void {
  _policy = null
}

// ---- address helpers --------------------------------------------------------

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

// A peer IP as Bun reports it (`server.requestIP`): IPv4, IPv6, or IPv4-mapped
// IPv6 (`::ffff:127.0.0.1`).
export function isLoopbackAddress(address: string | null | undefined): boolean {
  if (!address) return false
  const ip = stripBrackets(address.trim().toLowerCase())
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true
  const v4 = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip
  return /^127(\.\d{1,3}){3}$/.test(v4)
}

// A bind hostname or Host-header host (no port).
export function isLoopbackHostname(host: string | null | undefined): boolean {
  if (!host) return false
  const name = host.trim().toLowerCase()
  return name === 'localhost' || isLoopbackAddress(name)
}

// `localhost:13337`, `127.0.0.1`, `[::1]:13337` → the host part.
function hostWithoutPort(hostHeader: string): string {
  const value = hostHeader.trim()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end === -1 ? value : value.slice(0, end + 1)
  }
  const colon = value.lastIndexOf(':')
  return colon === -1 ? value : value.slice(0, colon)
}

// Headers a reverse proxy adds. Their presence on a loopback request means the
// request did not come from this machine directly.
const PROXY_HEADERS = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip']

function hasProxyHeaders(headers: Headers): boolean {
  if (PROXY_HEADERS.some(name => headers.has(name))) return true
  for (const name of headers.keys()) {
    if (name.startsWith('tailscale-')) return true
  }
  return false
}

// ---- cross-site check -------------------------------------------------------

const CROSS_SITE_REASON = 'Cross-site requests to moi are not allowed.'

// Browsers send `Origin` on every cross-origin request except plain GET/HEAD
// subresource loads, and `Sec-Fetch-Site` on all of them. A top-level
// navigation from another site (a link to moi) stays allowed; it can't read
// the response or carry a body.
function crossSiteViolation(req: Request, expectedHost: string): boolean {
  const origin = req.headers.get('origin')
  if (origin !== null) {
    let originHost: string
    try {
      originHost = new URL(origin).host
    } catch {
      return true // includes the opaque "null" origin
    }
    if (originHost.toLowerCase() !== expectedHost.toLowerCase()) return true
  }
  const site = req.headers.get('sec-fetch-site')
  if (site === 'cross-site' || site === 'same-site') {
    return req.headers.get('sec-fetch-mode') !== 'navigate' || req.method !== 'GET'
  }
  return false
}

// ---- the decision -----------------------------------------------------------

export function authorizeRequest(
  req: Request,
  peerAddress: string | null | undefined,
  policy: AuthPolicy
): AuthDecision {
  if (!isLoopbackAddress(peerAddress)) {
    return {
      ok: false,
      status: 401,
      reason:
        policy.mode === 'tailscale'
          ? 'moi only accepts requests through Tailscale Serve on this machine.'
          : 'moi only accepts local requests.'
    }
  }

  if (policy.mode === 'off') {
    const host = req.headers.get('host') ?? ''
    if (hasProxyHeaders(req.headers)) {
      return {
        ok: false,
        status: 401,
        reason:
          'Auth is off, so moi only accepts direct local requests. Set MOI_AUTH=tailscale to use it through Tailscale Serve.'
      }
    }
    // A non-loopback Host on a loopback connection is a DNS-rebinding attempt.
    if (!isLoopbackHostname(stripBrackets(hostWithoutPort(host)))) {
      return { ok: false, status: 403, reason: 'Open moi at localhost or 127.0.0.1.' }
    }
    if (crossSiteViolation(req, host)) return { ok: false, status: 403, reason: CROSS_SITE_REASON }
    return { ok: true, user: null }
  }

  if (req.headers.has('tailscale-funnel-request')) {
    return { ok: false, status: 403, reason: 'Public Tailscale Funnel requests are not allowed.' }
  }
  const login = req.headers.get('tailscale-user-login')?.trim()
  if (!login) {
    return {
      ok: false,
      status: 401,
      reason:
        'No Tailscale identity on this request. Open moi at its Tailscale Serve address from a device signed in as a user (tagged devices carry no identity).'
    }
  }
  // Serve RFC 2047-encodes non-ASCII values. Logins are ASCII in practice;
  // an encoded one can never match the allow-list, so it falls through to 403.
  if (!policy.allowedUsers.has(login.toLowerCase())) {
    return {
      ok: false,
      status: 403,
      reason: `${login} is not allowed to use moi. Add it to allowedUsers in config.json or MOI_ALLOWED_USERS.`
    }
  }
  // Serve sets X-Forwarded-Host to the Host the browser used.
  const expectedHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  if (crossSiteViolation(req, expectedHost)) {
    return { ok: false, status: 403, reason: CROSS_SITE_REASON }
  }
  return { ok: true, user: login }
}

// ---- wiring -----------------------------------------------------------------

type RequestIpSource = {
  requestIP(req: Request): { address: string } | null
}

export function authorize(req: Request, server: RequestIpSource): AuthDecision {
  return authorizeRequest(req, server.requestIP(req)?.address, getAuthPolicy())
}

export function denied(decision: Extract<AuthDecision, { ok: false }>): Response {
  return new Response(decision.reason + '\n', {
    status: decision.status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  })
}

// Wrap a Bun route (or `fetch`) handler so it only runs for authorized requests.
export function withAuth<S extends RequestIpSource, R extends Response | Promise<Response>>(
  handler: (req: Request, server: S) => R
): (req: Request, server: S) => Response | R {
  return (req, server) => {
    const decision = authorize(req, server)
    return decision.ok ? handler(req, server) : denied(decision)
  }
}

// ---- bind safety ------------------------------------------------------------

export type BindCheck = { ok: true; warning?: string } | { ok: false; error: string }

// Auth off trusts loopback, so it must never listen anywhere else. With
// Tailscale auth a wider bind is not exploitable (non-loopback peers are
// always refused) but it is never what you want: Serve connects over loopback.
export function checkBindHost(host: string, policy: AuthPolicy): BindCheck {
  if (isLoopbackHostname(stripBrackets(host))) return { ok: true }
  if (policy.mode === 'off') {
    return {
      ok: false,
      error: `Refusing to listen on ${host} with auth off. Unset HOST to bind 127.0.0.1, or use MOI_AUTH=tailscale behind Tailscale Serve.`
    }
  }
  return {
    ok: true,
    warning: `Listening on ${host}. Only loopback requests from Tailscale Serve are accepted; other peers get 401. Unset HOST to bind 127.0.0.1.`
  }
}

export function describeAuth(policy: AuthPolicy): string {
  if (policy.mode === 'off') return 'auth off — direct local requests only'
  const count = policy.allowedUsers.size
  return count === 0
    ? 'auth: Tailscale — no allowed users yet, every request will be refused (set MOI_ALLOWED_USERS)'
    : `auth: Tailscale — ${count} allowed user${count === 1 ? '' : 's'}`
}
