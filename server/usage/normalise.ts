import type { UsageSnapshot, UsageStatus } from '@/lib/types'

const QUOTA_STALE_MS = 15 * 60_000

export type ClaudeRateLimitInfo = {
  status?: unknown
  resetsAt?: unknown
  rateLimitType?: unknown
  utilization?: unknown
}

export type CodexRateLimitWindow = {
  usedPercent?: unknown
  windowDurationMins?: unknown
  resetsAt?: unknown
}

export type CodexRateLimitSnapshot = {
  limitId?: unknown
  limitName?: unknown
  primary?: CodexRateLimitWindow | null
  secondary?: CodexRateLimitWindow | null
  spendControlReached?: unknown
  rateLimitReachedType?: unknown
  planType?: unknown
}

export type CodexRateLimitsResponse = {
  rateLimits?: CodexRateLimitSnapshot
  rateLimitsByLimitId?: Record<string, CodexRateLimitSnapshot> | null
  accountId?: unknown
}

function isoFromEpoch(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  // Codex reports Unix seconds. Claude's SDK only declares `number`, so accept
  // either seconds or milliseconds without guessing at the provider boundary.
  const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value
  const date = new Date(milliseconds)
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString()
}

function percent(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  // Claude rate-limit events have shipped both ratio-like and percentage-like
  // utilization values. Codex already supplies a percentage.
  const normalised = value >= 0 && value <= 1 ? value * 100 : value
  return Math.min(100, Math.max(0, normalised))
}

function staleAt(observedAt: string, afterMs = QUOTA_STALE_MS): string {
  return new Date(new Date(observedAt).valueOf() + afterMs).toISOString()
}

function claudeWindow(value: unknown): string {
  switch (value) {
    case 'five_hour':
      return '5 hours'
    case 'seven_day':
      return '7 days'
    case 'seven_day_opus':
      return '7 days · Opus'
    case 'seven_day_sonnet':
      return '7 days · Sonnet'
    case 'seven_day_overage_included':
      return '7 days · extra usage'
    case 'overage':
      return 'Extra usage'
    default:
      return 'Current window'
  }
}

function claudeStatus(value: unknown): UsageStatus {
  if (value === 'allowed') return 'available'
  if (value === 'allowed_warning') return 'warning'
  if (value === 'rejected') return 'exhausted'
  return 'unknown'
}

export function normaliseClaudeRateLimit(
  input: ClaudeRateLimitInfo,
  observedAt = new Date().toISOString()
): UsageSnapshot {
  const window = claudeWindow(input.rateLimitType)
  return {
    id: `claude:${String(input.rateLimitType ?? 'current')}`,
    provider: 'claude',
    label: 'Claude',
    kind: 'quota',
    status: claudeStatus(input.status),
    window,
    ...(percent(input.utilization) === undefined
      ? {}
      : { usedPercent: percent(input.utilization) }),
    ...(isoFromEpoch(input.resetsAt) ? { resetsAt: isoFromEpoch(input.resetsAt) } : {}),
    observedAt,
    staleAt: staleAt(observedAt)
  }
}

function durationLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  if (value % 10_080 === 0) return `${value / 10_080} ${value === 10_080 ? 'week' : 'weeks'}`
  if (value % 1_440 === 0) return `${value / 1_440} ${value === 1_440 ? 'day' : 'days'}`
  if (value % 60 === 0) return `${value / 60} ${value === 60 ? 'hour' : 'hours'}`
  return `${value} minutes`
}

function codexStatus(
  snapshot: CodexRateLimitSnapshot,
  usedPercent: number | undefined
): UsageStatus {
  if (
    snapshot.rateLimitReachedType ||
    snapshot.spendControlReached === true ||
    usedPercent === 100
  ) {
    return 'exhausted'
  }
  if (usedPercent !== undefined && usedPercent >= 80) return 'warning'
  return usedPercent === undefined ? 'unknown' : 'available'
}

export function normaliseCodexRateLimits(
  input: CodexRateLimitsResponse,
  observedAt = new Date().toISOString()
): UsageSnapshot[] {
  const accountId = typeof input.accountId === 'string' ? input.accountId : undefined
  const buckets = input.rateLimitsByLimitId
    ? Object.entries(input.rateLimitsByLimitId)
    : input.rateLimits
      ? [[String(input.rateLimits.limitId ?? 'codex'), input.rateLimits] as const]
      : []
  const snapshots: UsageSnapshot[] = []

  for (const [bucketId, bucket] of buckets) {
    const label =
      typeof bucket.limitName === 'string' && bucket.limitName.trim()
        ? `Codex · ${bucket.limitName}`
        : 'Codex'
    for (const [windowId, window, fallback] of [
      ['primary', bucket.primary, 'Primary window'],
      ['secondary', bucket.secondary, 'Secondary window']
    ] as const) {
      if (!window) continue
      const usedPercent = percent(window.usedPercent)
      snapshots.push({
        id: `codex:${accountId ?? 'default'}:${bucketId}:${windowId}`,
        provider: 'codex',
        label,
        kind: 'quota',
        status: codexStatus(bucket, usedPercent),
        window: durationLabel(window.windowDurationMins, fallback),
        ...(accountId ? { accountId } : {}),
        ...(usedPercent === undefined ? {} : { usedPercent }),
        ...(isoFromEpoch(window.resetsAt) ? { resetsAt: isoFromEpoch(window.resetsAt) } : {}),
        observedAt,
        staleAt: staleAt(observedAt),
        ...(typeof bucket.planType === 'string' ? { detail: `${bucket.planType} plan` } : {})
      })
    }
  }
  return snapshots
}

export function markUsageStaleness(snapshots: UsageSnapshot[], now = Date.now()): UsageSnapshot[] {
  return snapshots.map(snapshot => ({
    ...snapshot,
    stale: new Date(snapshot.staleAt).valueOf() <= now
  }))
}
