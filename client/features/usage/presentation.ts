import type { UsageSnapshot } from '@/lib/types'

export function usageSummary(snapshot: UsageSnapshot): string {
  if (snapshot.status === 'unknown' && snapshot.detail) return snapshot.detail
  if (snapshot.kind === 'availability') {
    if (snapshot.status === 'unavailable') return 'Unavailable'
    return `${snapshot.loadedModelCount ?? 0} loaded · ${snapshot.modelCount ?? 0} installed`
  }
  if (snapshot.kind === 'spend') {
    return `$${(snapshot.spentUsd ?? 0).toFixed(2)} spent locally`
  }
  if (snapshot.usedPercent === undefined) {
    if (snapshot.status === 'exhausted') return 'Limit reached'
    return 'Usage percentage unavailable'
  }
  return `${Math.round(snapshot.usedPercent)}% used · ${Math.round(100 - snapshot.usedPercent)}% left`
}

export function usageFreshness(snapshot: UsageSnapshot, now = Date.now()): string {
  const elapsed = Math.max(0, now - new Date(snapshot.observedAt).valueOf())
  if (elapsed < 60_000) return 'as of now'
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) return `as of ${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return `as of ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
}

export function resetLabel(snapshot: UsageSnapshot, now = Date.now()): string | undefined {
  if (!snapshot.resetsAt) return undefined
  const remaining = new Date(snapshot.resetsAt).valueOf() - now
  if (remaining <= 0) return 'Reset due'
  const minutes = Math.ceil(remaining / 60_000)
  if (minutes < 60) return `Resets in ${minutes} min`
  const hours = Math.ceil(minutes / 60)
  if (hours < 48) return `Resets in ${hours} hr`
  const days = Math.ceil(hours / 24)
  return `Resets in ${days} days`
}
