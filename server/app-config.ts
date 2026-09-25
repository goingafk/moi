import { readFileSync } from 'node:fs'
import { join } from 'path'

import type { ClientAppConfig } from '@/lib/types'

import { DATA_DIR } from './data-dir'
import { isTailnetIpv4 } from './tailnet-ip'

// Startup (deployment) config, read once per process from `config.json` in
// moi's data dir and overridable by `MOI_*` env vars (env wins). Distinct from
// `settings.json` (user settings: conf-backed, API-mutable, changes at
// runtime): config.json describes the deployment itself — nothing here changes
// without a server restart, and no API writes it.
//
// Resolution: defaults < config.json < env. A missing file is the normal local
// case; a malformed file or wrong-typed key warns on stderr and falls back
// per-key, so a broken config never takes the CLI or server down with it.
export type AppConfig = {
  // Cloud demo deployment: workspace creation is blocked (UI shows the
  // cloud-demo promo dialog instead) and `moi` system commands are disabled.
  cloudDemo: boolean
  // Gated experimental features, checked by slug.
  experiments: string[]
  // Link target for the cloud-demo promo dialog.
  demoInstallUrl: string
  // npm self-update (`moi update`, the in-app update check and install). Off by
  // default in this fork: the published `moi-computer` package is upstream, and
  // installing it would replace the fork.
  selfUpdate: boolean
  // HTTP/WebSocket auth (`server/auth.ts`). 'tailscale' trusts Tailscale Serve
  // identity headers on loopback requests; 'tailnet-ip' accepts only listed
  // Tailscale device IPs at the configured Tailscale bind IP; 'off' accepts
  // only direct loopback requests. null resolves to 'off' under dev and
  // 'tailscale' everywhere else.
  auth: AuthSetting | null
  // Tailscale logins allowed in 'tailscale' mode (case-insensitive).
  allowedUsers: string[]
  // Direct-tailnet mode: server IP and client IP allow-list. These are device
  // identities, not user identities; an empty list denies every request.
  tailnetIp: string | null
  allowedIps: string[]
  // Browser-visible HTTPS origin published by Tailscale Serve. Used only for
  // CLI links; server-to-server commands keep using the control port.
  publicUrl: string | null
}

export type AuthSetting = 'tailscale' | 'tailnet-ip' | 'off'

const DEFAULTS: AppConfig = {
  cloudDemo: false,
  experiments: [],
  demoInstallUrl: 'https://moi.computer',
  selfUpdate: false,
  auth: null,
  allowedUsers: [],
  tailnetIp: null,
  allowedIps: [],
  publicUrl: null
}

export const APP_CONFIG_FILE = join(DATA_DIR, 'config.json')

function warn(message: string): void {
  console.error(`[moi] config: ${message}`)
}

// '1'/'true' (case-insensitive) are true, '0'/'false' are false, anything
// else — including empty — leaves the lower-precedence value in place.
function parseBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined
  const value = raw.trim().toLowerCase()
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return undefined
}

// "a, b,c" → ['a','b','c']; empty entries dropped. An empty string clears the
// list (explicitly setting MOI_EXPERIMENTS= disables file-set experiments).
function parseList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined
  return raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function parseString(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  return raw.trim()
}

function parseAuth(raw: string | undefined): AuthSetting | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const value = raw.trim().toLowerCase()
  if (value === 'tailscale' || value === 'tailnet-ip' || value === 'off') return value
  warn(`ignoring MOI_AUTH=${raw} — expected "tailscale", "tailnet-ip", or "off"`)
  return undefined
}

function parseTailnetIp(raw: string | undefined, label: string): string | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const ip = raw.trim()
  if (isTailnetIpv4(ip)) return ip
  warn(`ignoring ${label}=${raw} — expected a Tailscale IPv4 address in 100.64.0.0/10`)
  return undefined
}

function parseAllowedIps(raw: string[] | undefined, label: string): string[] | undefined {
  if (raw === undefined) return undefined
  const valid = raw.map(ip => ip.trim()).filter(isTailnetIpv4)
  if (valid.length !== raw.length) {
    warn(`ignoring invalid entries in ${label} — expected Tailscale IPv4 addresses`)
  }
  return valid
}

function parsePublicUrl(raw: string | undefined, label: string): string | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  try {
    const url = new URL(raw.trim())
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error('not an HTTPS origin')
    }
    return url.origin
  } catch {
    warn(`ignoring ${label}=${raw} — expected an HTTPS origin with no path`)
    return undefined
  }
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function fileValues(file: string): Partial<AppConfig> {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    // Only a missing file is silent (the normal local case). Anything else —
    // permissions, mount errors — is loud: a deployment relying on config.json
    // must not boot un-gated without a diagnostic. Deployments that need the
    // demo gate guaranteed should pin MOI_CLOUD_DEMO=1 in the environment,
    // which has no read-failure mode.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      warn(`could not read ${file}: ${err instanceof Error ? err.message : String(err)}`)
    }
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    warn(`ignoring ${file} — invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    warn(`ignoring ${file} — expected a JSON object`)
    return {}
  }
  const raw = parsed as Record<string, unknown>
  const out: Partial<AppConfig> = {}
  if (raw.cloudDemo !== undefined) {
    if (typeof raw.cloudDemo === 'boolean') out.cloudDemo = raw.cloudDemo
    else warn('ignoring "cloudDemo" — expected a boolean')
  }
  if (raw.experiments !== undefined) {
    if (isStringList(raw.experiments)) {
      out.experiments = raw.experiments
    } else warn('ignoring "experiments" — expected an array of strings')
  }
  if (raw.demoInstallUrl !== undefined) {
    if (typeof raw.demoInstallUrl === 'string') out.demoInstallUrl = raw.demoInstallUrl
    else warn('ignoring "demoInstallUrl" — expected a string')
  }
  if (raw.selfUpdate !== undefined) {
    if (typeof raw.selfUpdate === 'boolean') out.selfUpdate = raw.selfUpdate
    else warn('ignoring "selfUpdate" — expected a boolean')
  }
  if (raw.auth !== undefined) {
    if (raw.auth === 'tailscale' || raw.auth === 'tailnet-ip' || raw.auth === 'off')
      out.auth = raw.auth
    else warn('ignoring "auth" — expected "tailscale", "tailnet-ip", or "off"')
  }
  if (raw.allowedUsers !== undefined) {
    if (isStringList(raw.allowedUsers)) out.allowedUsers = raw.allowedUsers
    else warn('ignoring "allowedUsers" — expected an array of strings')
  }
  if (raw.tailnetIp !== undefined) {
    if (typeof raw.tailnetIp === 'string') {
      out.tailnetIp = parseTailnetIp(raw.tailnetIp, '"tailnetIp"') ?? null
    } else warn('ignoring "tailnetIp" — expected a Tailscale IPv4 address')
  }
  if (raw.allowedIps !== undefined) {
    if (isStringList(raw.allowedIps)) {
      out.allowedIps = parseAllowedIps(raw.allowedIps, '"allowedIps"') ?? []
    } else warn('ignoring "allowedIps" — expected an array of Tailscale IPv4 addresses')
  }
  if (raw.publicUrl !== undefined) {
    if (typeof raw.publicUrl === 'string') {
      out.publicUrl = parsePublicUrl(raw.publicUrl, '"publicUrl"') ?? null
    } else warn('ignoring "publicUrl" — expected an HTTPS origin')
  }
  return out
}

// Pure resolver, exported for tests. `getAppConfig` is the cached entrypoint.
export function loadAppConfig(
  file: string = APP_CONFIG_FILE,
  env: Record<string, string | undefined> = process.env
): AppConfig {
  const fromFile = fileValues(file)
  const fromEnv: Partial<AppConfig> = {
    cloudDemo: parseBool(env.MOI_CLOUD_DEMO),
    experiments: parseList(env.MOI_EXPERIMENTS),
    demoInstallUrl: parseString(env.MOI_DEMO_INSTALL_URL),
    selfUpdate: parseBool(env.MOI_SELF_UPDATE),
    auth: parseAuth(env.MOI_AUTH),
    allowedUsers: parseList(env.MOI_ALLOWED_USERS),
    tailnetIp: parseTailnetIp(env.MOI_TAILNET_IP, 'MOI_TAILNET_IP'),
    allowedIps: parseAllowedIps(parseList(env.MOI_ALLOWED_IPS), 'MOI_ALLOWED_IPS'),
    publicUrl: parsePublicUrl(env.MOI_PUBLIC_URL, 'MOI_PUBLIC_URL')
  }
  const merged = { ...DEFAULTS, ...fromFile }
  for (const key of Object.keys(fromEnv) as (keyof AppConfig)[]) {
    if (fromEnv[key] === undefined) delete fromEnv[key]
  }
  return Object.freeze({ ...merged, ...fromEnv })
}

let _config: AppConfig | null = null

export function getAppConfig(): AppConfig {
  _config ??= loadAppConfig()
  return _config
}

// Test seam: drop the cached config so the next getAppConfig() re-resolves
// (tests point MOI_DATA_DIR elsewhere or set MOI_CLOUD_DEMO).
export function resetAppConfig(): void {
  _config = null
}

// The only shape that reaches the browser (GET /api/config). Server-only keys
// added to AppConfig later stay out unless explicitly forwarded here.
export function clientAppConfig(): ClientAppConfig {
  const { cloudDemo, experiments, demoInstallUrl } = getAppConfig()
  return { cloudDemo, experiments: [...experiments], demoInstallUrl }
}
