import type { UsageSnapshot } from '@/lib/types'

import { cn } from '@/client/lib/cn'

import { resetLabel, usageFreshness, usageSummary } from './presentation'

type UsageBarProps = {
  usedPercent: number
  status: UsageSnapshot['status']
}

function UsageBar({ usedPercent, status }: UsageBarProps) {
  const filled = Math.ceil((Math.min(100, Math.max(0, usedPercent)) / 100) * 10)
  return (
    <div
      className="grid grid-cols-10 gap-0.5"
      role="progressbar"
      aria-label="Usage used"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(usedPercent)}
    >
      {Array.from({ length: 10 }, (_, index) => (
        <span
          key={index}
          className={cn(
            'h-1.5 rounded-full bg-muted',
            index < filled && status === 'exhausted' && 'bg-destructive',
            index < filled && status !== 'exhausted' && 'bg-primary'
          )}
        />
      ))}
    </div>
  )
}

type UsageRowProps = {
  snapshot: UsageSnapshot
  compact?: boolean
}

export function UsageRow({ snapshot, compact = false }: UsageRowProps) {
  const reset = resetLabel(snapshot)
  return (
    <div className={cn('flex flex-col gap-2', compact ? 'py-1' : 'px-3.5 py-3')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{snapshot.label}</span>
            {snapshot.window && (
              <span className="truncate text-xs text-muted-foreground">{snapshot.window}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {usageSummary(snapshot)}
            {reset ? ` · ${reset}` : ''}
          </p>
        </div>
        <span
          className={cn(
            'mt-1 size-2 shrink-0 rounded-full bg-muted-foreground',
            snapshot.status === 'available' && 'bg-success',
            snapshot.status === 'exhausted' && 'bg-destructive'
          )}
          aria-label={snapshot.status}
        />
      </div>
      {snapshot.usedPercent !== undefined && (
        <UsageBar usedPercent={snapshot.usedPercent} status={snapshot.status} />
      )}
      {!snapshot.id.endsWith(':unobserved') && (
        <p className="text-xs text-muted-foreground">
          {usageFreshness(snapshot)}
          {snapshot.stale ? ' · stale' : ''}
        </p>
      )}
    </div>
  )
}
