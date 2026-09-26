import type { SessionConfig, SystemNotice } from '@/lib/types'

type RouteNotice = Extract<SystemNotice, { kind: 'route' }>

export function routeOverridePatch(notice: RouteNotice): {
  routing: NonNullable<SessionConfig['routing']>
  model: string | null
} {
  return { routing: 'manual', model: notice.model === 'default' ? null : notice.model }
}

export function routeContinuation(
  notice: RouteNotice
): { agent: RouteNotice['agent']; model: string; message: string } | null {
  if (!notice.suggestion) return null
  return {
    agent: notice.suggestion.agent,
    model: notice.suggestion.model,
    message: notice.message
  }
}
