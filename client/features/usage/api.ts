import { useQuery, useQueryClient } from '@tanstack/react-query'

import { requestJson } from '@/client/api/http'
import { useWorkspaceEvent } from '@/client/runtime/useWorkspaceEvents'
import type { UsageOverview, UsageSnapshot } from '@/lib/types'

export const usageKey = ['usage'] as const

export function mergeUsageSnapshots(
  current: UsageOverview | undefined,
  next: UsageSnapshot[]
): UsageOverview {
  const merged = new Map((current?.snapshots ?? []).map(snapshot => [snapshot.id, snapshot]))
  for (const snapshot of next) {
    if (!snapshot.id.endsWith(':unobserved')) {
      for (const [id, existing] of merged) {
        if (existing.provider === snapshot.provider && id.endsWith(':unobserved')) merged.delete(id)
      }
    }
    merged.set(snapshot.id, snapshot)
  }
  return { snapshots: [...merged.values()], generatedAt: new Date().toISOString() }
}

export function useUsage() {
  const queryClient = useQueryClient()
  useWorkspaceEvent(event => {
    if (event.type !== 'usage:updated') return
    queryClient.setQueryData<UsageOverview>(usageKey, current =>
      mergeUsageSnapshots(current, event.snapshots)
    )
  })
  return useQuery<UsageOverview>({
    queryKey: usageKey,
    queryFn: () => requestJson('/api/usage?refresh=1'),
    staleTime: 30_000,
    refetchInterval: 60_000
  })
}
