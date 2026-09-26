import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { jsonRequest, requestJson, requestVoid } from '@/client/api/http'
import type {
  MemoryConfigPatch,
  MemoryEntry,
  MemoryEntryPatch,
  MemoryList,
  MemoryRememberResult,
  MemoryScope,
  MemoryServiceConfig,
  MemoryStatus,
  MemoryStatusView
} from '@/lib/memory'

// Shared memory (Phase 6). Everything goes through moi's /api/memory proxy;
// the browser never calls the memory service directly.
export const memoryKeys = {
  all: ['memory'] as const,
  status: ['memory', 'status'] as const,
  entries: (filter: MemoryFilter) => ['memory', 'entries', filter] as const
}

export type MemoryFilter = {
  status: MemoryStatus | 'archived' | 'all'
  scope: MemoryScope | 'all'
  // Narrow to this workspace's project when set.
  workspaceId: string | null
  q: string
  limit: number
}

export function useMemoryStatus() {
  return useQuery<MemoryStatusView>({
    queryKey: memoryKeys.status,
    queryFn: () => requestJson('/api/memory/status'),
    staleTime: 15_000
  })
}

export function useMemoryEntries(filter: MemoryFilter, enabled: boolean) {
  return useQuery<MemoryList>({
    queryKey: memoryKeys.entries(filter),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const query = new URLSearchParams({ limit: String(filter.limit) })
      if (filter.scope !== 'all') query.set('scope', filter.scope)
      if (filter.workspaceId) query.set('workspaceId', filter.workspaceId)
      if (filter.q.trim()) query.set('q', filter.q.trim())
      if (filter.status !== 'all' && filter.status !== 'archived')
        query.set('status', filter.status)
      if (filter.status !== 'archived') {
        return requestJson<MemoryList>(`/api/memory/entries?${query}`)
      }
      // "Archived" spans two service statuses; merge them newest first.
      const lists = await Promise.all(
        (['superseded', 'evicted'] as const).map(status => {
          const q = new URLSearchParams(query)
          q.set('status', status)
          return requestJson<MemoryList>(`/api/memory/entries?${q}`)
        })
      )
      return {
        entries: lists
          .flatMap(list => list.entries)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, filter.limit),
        total: lists.reduce((sum, list) => sum + list.total, 0)
      }
    }
  })
}

function useInvalidateMemory() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: memoryKeys.all })
}

export function useUpdateMemoryConfig() {
  const invalidate = useInvalidateMemory()
  return useMutation<MemoryServiceConfig, Error, MemoryConfigPatch>({
    mutationFn: patch =>
      requestJson(
        '/api/memory/config',
        jsonRequest('PATCH', patch),
        'Could not save memory settings'
      ),
    onSettled: invalidate
  })
}

export function useAddMemory() {
  const invalidate = useInvalidateMemory()
  return useMutation<
    MemoryRememberResult,
    Error,
    { text: string; scope: 'project' | 'global'; workspaceId: string }
  >({
    mutationFn: body =>
      requestJson('/api/memory/entries', jsonRequest('POST', body), 'Could not save the memory'),
    onSuccess: invalidate
  })
}

export function useUpdateMemory() {
  const invalidate = useInvalidateMemory()
  return useMutation<MemoryEntry, Error, { id: string; patch: MemoryEntryPatch }>({
    mutationFn: ({ id, patch }) =>
      requestJson(
        `/api/memory/entries/${encodeURIComponent(id)}`,
        jsonRequest('PATCH', patch),
        'Could not update the memory'
      ),
    onSuccess: invalidate
  })
}

export function useDeleteMemory() {
  const invalidate = useInvalidateMemory()
  return useMutation<void, Error, string>({
    mutationFn: id =>
      requestVoid(
        `/api/memory/entries/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        'Could not delete the memory'
      ),
    onSuccess: invalidate
  })
}
