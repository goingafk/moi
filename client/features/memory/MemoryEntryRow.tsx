import { useState } from 'react'

import { IconPencil, IconPin, IconPinnedOff, IconRestore, IconTrash } from '@tabler/icons-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/client/components/ui/alert-dialog'
import { Button } from '@/client/components/ui/button'
import { Textarea } from '@/client/components/ui/textarea'
import { cn } from '@/client/lib/cn'
import type { MemoryEntry } from '@/lib/memory'

import { useDeleteMemory, useUpdateMemory } from './api'
import { memoryMeta } from './format'

type MemoryEntryRowProps = {
  entry: MemoryEntry
}

export function MemoryEntryRow({ entry }: MemoryEntryRowProps) {
  const update = useUpdateMemory()
  const remove = useDeleteMemory()
  const [draft, setDraft] = useState<string | null>(null)
  const busy = update.isPending || remove.isPending
  const archived = entry.status !== 'active'
  const error = update.error ?? remove.error

  function saveText() {
    if (draft === null || !draft.trim() || draft.trim() === entry.text) {
      setDraft(null)
      return
    }
    update.mutate({ id: entry.id, patch: { text: draft } }, { onSuccess: () => setDraft(null) })
  }

  return (
    <div className="flex items-start gap-3 px-3.5 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {draft === null ? (
          <p className={cn('text-sm break-words', archived && 'text-muted-foreground')}>
            {entry.text}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <Textarea
              aria-label="Memory text"
              value={draft}
              onChange={event => setDraft(event.target.value)}
              maxLength={2000}
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={busy || !draft.trim()} onClick={saveText}>
                Save memory
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground tabular-nums">{memoryMeta(entry)}</p>
        {error && <p className="text-xs text-destructive">{error.message}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {archived ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Restore memory"
            title="Restore memory"
            disabled={busy}
            onClick={() => update.mutate({ id: entry.id, patch: { status: 'active' } })}
          >
            <IconRestore stroke={1.75} />
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={entry.pinned ? 'Unpin memory' : 'Pin memory'}
              title={entry.pinned ? 'Unpin memory' : 'Pin: always include, never archive'}
              aria-pressed={entry.pinned}
              disabled={busy}
              onClick={() => update.mutate({ id: entry.id, patch: { pinned: !entry.pinned } })}
            >
              {entry.pinned ? <IconPinnedOff stroke={1.75} /> : <IconPin stroke={1.75} />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Edit memory"
              title="Edit memory"
              disabled={busy || draft !== null}
              onClick={() => setDraft(entry.text)}
            >
              <IconPencil stroke={1.75} />
            </Button>
          </>
        )}
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Delete memory"
                title="Delete memory"
              />
            }
            disabled={busy}
          >
            <IconTrash stroke={1.75} />
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this memory?</AlertDialogTitle>
              <AlertDialogDescription>
                It is removed for every agent and machine and cannot be restored. Agents can save it
                again later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                type="button"
                variant="destructive"
                onClick={() => remove.mutate(entry.id)}
              >
                Delete memory
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
