import { IconChartBar } from '@tabler/icons-react'

import { Button } from '@/client/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '@/client/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/client/components/ui/tooltip'

import { useUsage } from './api'
import { UsageRow } from './UsageRows'

export function UsageIndicator() {
  const { data, isPending } = useUsage()
  const snapshots = data?.snapshots ?? []
  const constrained = snapshots.some(snapshot =>
    ['warning', 'exhausted', 'unavailable'].includes(snapshot.status)
  )

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Usage"
                  className={constrained ? 'text-foreground' : 'text-muted-foreground'}
                >
                  <IconChartBar stroke={1.75} />
                </Button>
              }
            />
          }
        />
        <TooltipContent>Usage</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Usage</PopoverTitle>
          <PopoverDescription>Provider limits and local availability.</PopoverDescription>
        </PopoverHeader>
        {isPending && <p className="py-2 text-xs text-muted-foreground">Checking usage…</p>}
        {!isPending && snapshots.length === 0 && (
          <p className="py-2 text-xs text-muted-foreground">
            Usage appears after Claude or Codex reports a limit.
          </p>
        )}
        {snapshots.map(snapshot => (
          <UsageRow key={snapshot.id} snapshot={snapshot} compact />
        ))}
      </PopoverContent>
    </Popover>
  )
}
