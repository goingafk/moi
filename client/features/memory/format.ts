import type { MemoryEntry } from '@/lib/memory'

// Compact, sentence-case metadata for one memory row.
export function memoryMeta(entry: MemoryEntry, now = Date.now()): string {
  const parts: string[] = [scopeLabel(entry)]
  if (entry.status === 'superseded') parts.push('Replaced by a newer fact')
  if (entry.status === 'evicted') parts.push('Archived')
  parts.push(
    entry.relevance === null
      ? 'Relevance not scored'
      : `Relevance ${Math.round(entry.relevance * 100)}%`
  )
  parts.push(entry.useCount === 1 ? '1 use' : `${entry.useCount} uses`)
  const source = [entry.provenance.agent, entry.provenance.machine].filter(Boolean).join(' on ')
  if (source) parts.push(`From ${source}`)
  parts.push(relativeTime(entry.updatedAt, now))
  return parts.join(' · ')
}

function scopeLabel(entry: MemoryEntry): string {
  if (entry.scope === 'global') return 'All projects'
  if (entry.scope === 'session') return 'One chat'
  return entry.projectKey?.replace(/^path:/, '') ?? 'Project'
}

export function relativeTime(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}
