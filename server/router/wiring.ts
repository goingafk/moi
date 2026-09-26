import type { RoutingMode, SessionConfig } from '@/lib/types'

export function routingModeForSend(input: {
  config: SessionConfig
  isNew: boolean
  requested?: RoutingMode
  defaultMode: RoutingMode
}): RoutingMode {
  return input.config.routing ?? (input.isNew ? (input.requested ?? input.defaultMode) : 'manual')
}
