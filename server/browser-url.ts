import type { AuthPolicy } from './auth'
import type { AppConfig } from './app-config'

export function browserBaseUrl(
  config: Pick<AppConfig, 'publicUrl' | 'tailnetIp'>,
  policy: Pick<AuthPolicy, 'mode'>,
  port: number
): string | null {
  if (policy.mode === 'tailscale') return config.publicUrl
  if (policy.mode === 'tailnet-ip')
    return config.tailnetIp ? `http://${config.tailnetIp}:${port}` : null
  return `http://localhost:${port}`
}

export function workspaceBrowserUrl(
  config: Pick<AppConfig, 'publicUrl' | 'tailnetIp'>,
  policy: Pick<AuthPolicy, 'mode'>,
  port: number,
  workspaceId: string
): string | null {
  const base = browserBaseUrl(config, policy, port)
  return base === null ? null : `${base}/workspace/${encodeURIComponent(workspaceId)}`
}
