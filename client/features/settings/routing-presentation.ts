import type { RoutingDecisionLog } from '@/lib/types'

export function routingDecisionSummary(entry: RoutingDecisionLog): string {
  const classification = entry.classification
    ? `${entry.classification.kind}, ${entry.classification.difficulty}`
    : 'Fallback'
  return `${classification} · ${entry.chosen.label} · ${entry.reason}`
}

export function routingDecisionTime(at: string): string {
  const value = new Date(at)
  return Number.isNaN(value.valueOf())
    ? 'Unknown time'
    : value.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}
