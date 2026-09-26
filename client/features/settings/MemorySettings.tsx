import { useState } from 'react'

import { IconLoader2 } from '@tabler/icons-react'

import { Button } from '@/client/components/ui/button'
import { Input } from '@/client/components/ui/input'
import { Skeleton } from '@/client/components/ui/skeleton'
import { Switch } from '@/client/components/ui/switch'
import { Textarea } from '@/client/components/ui/textarea'
import { cn } from '@/client/lib/cn'
import {
  type MemoryFilter,
  useAddMemory,
  useMemoryEntries,
  useMemoryStatus,
  useUpdateMemoryConfig
} from '@/client/features/memory/api'
import { MemoryEntryRow } from '@/client/features/memory/MemoryEntryRow'
import { MemorySelect } from '@/client/features/memory/MemorySelect'
import { useWorkspaceLayoutCtx } from '@/client/features/workspace/WorkspaceLayoutContext'
import type { MemoryServiceConfig } from '@/lib/memory'

import { useAppSettings, useSaveAppSettings } from './api'
import { SettingsPage, SettingsRow, SettingsSection } from './SettingsLayout'

const PAGE_SIZE = 50

export function MemorySettings() {
  const status = useMemoryStatus()
  const connected = status.data?.state === 'ok' ? status.data.config : null

  return (
    <SettingsPage
      title="Memory"
      description="Facts every agent shares across chats and machines. Agents save them; the scorer keeps the useful ones."
    >
      <ServiceSection />
      {connected && <BehaviourSection config={connected} />}
      {connected && <EntriesSection />}
    </SettingsPage>
  )
}

function ServiceSection() {
  const { data: settings } = useAppSettings()
  const save = useSaveAppSettings()
  const status = useMemoryStatus()
  const [url, setUrl] = useState<string | null>(null)
  const current = settings?.memory.url ?? ''
  const value = url ?? current

  function saveUrl(next: string | null) {
    save.mutate(
      { memory: { url: next } },
      {
        onSuccess: () => {
          setUrl(null)
          void status.refetch()
        }
      }
    )
  }

  const view = status.data
  const description =
    view?.state === 'ok'
      ? `Connected. Jev ${view.config.available.jev ? 'ready' : 'not configured'}, Laya ${view.config.available.laya ? 'ready' : 'not configured'}, embeddings ${view.config.available.embeddings.model ?? 'off'}.`
      : view?.state === 'unreachable'
        ? view.error
        : 'Memory is off. Add the memory service address to turn it on.'

  return (
    <SettingsSection label="Service">
      <div className="flex flex-col gap-2 p-3.5">
        <div className="flex gap-2">
          <Input
            aria-label="Memory service URL"
            placeholder="http://100.x.y.z:13380"
            value={value}
            onChange={event => setUrl(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            disabled={!settings || save.isPending || url === null || url.trim() === current}
            onClick={() => saveUrl(url?.trim() || null)}
          >
            {save.isPending && (
              <IconLoader2 data-icon="inline-start" stroke={1.75} className="animate-spin" />
            )}
            Save address
          </Button>
          {current && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={save.isPending}
              onClick={() => saveUrl(null)}
            >
              Turn off
            </Button>
          )}
        </div>
        {status.isPending ? (
          <Skeleton className="h-4 w-64 max-w-full" />
        ) : (
          <p
            className={cn(
              'text-xs',
              view?.state === 'unreachable' ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            {description}
          </p>
        )}
        {save.isError && (
          <p className="text-xs text-destructive">
            Enter an address like http://100.x.y.z:13380, without a path or credentials.
          </p>
        )}
      </div>
    </SettingsSection>
  )
}

type BehaviourSectionProps = {
  config: MemoryServiceConfig
}

function BehaviourSection({ config }: BehaviourSectionProps) {
  const update = useUpdateMemoryConfig()
  const [threshold, setThreshold] = useState<string | null>(null)

  function saveThreshold() {
    if (threshold === null) return
    const value = Number(threshold)
    if (!Number.isFinite(value) || value < 0 || value > 1) return
    update.mutate({ threshold: value }, { onSuccess: () => setThreshold(null) })
  }

  return (
    <SettingsSection label="Behaviour">
      <SettingsRow
        title="Share memory with agents"
        description="Add the most relevant memories to each message. Agents can still save and search when this is off."
        control={
          <Switch
            aria-label="Share memory with agents"
            checked={config.enabled}
            disabled={update.isPending}
            onCheckedChange={enabled => update.mutate({ enabled })}
          />
        }
      />
      <SettingsRow
        title="Scorer"
        description="Judges relevance, importance, and duplicates. The other scorer is the fallback."
        control={
          <MemorySelect
            label="Scorer"
            value={config.scorer}
            disabled={update.isPending}
            onChange={scorer => update.mutate({ scorer })}
            options={[
              { value: 'jev', label: config.available.jev ? 'Jev' : 'Jev (no API key)' },
              { value: 'laya', label: config.available.laya ? 'Laya' : 'Laya (no endpoint)' }
            ]}
          />
        }
      />
      <SettingsRow
        title="Archive below relevance"
        description="0 to 1. Unpinned memories that stay below this and go unused are archived."
        control={
          <Input
            aria-label="Archive below relevance"
            type="number"
            min={0}
            max={1}
            step={0.05}
            className="w-20 tabular-nums"
            value={threshold ?? String(config.threshold)}
            onChange={event => setThreshold(event.target.value)}
            onBlur={saveThreshold}
            onKeyDown={event => {
              if (event.key === 'Enter') saveThreshold()
            }}
          />
        }
      />
      {update.isError && (
        <p className="px-3.5 py-2 text-xs text-destructive">{update.error.message}</p>
      )}
    </SettingsSection>
  )
}

function EntriesSection() {
  const { workspaceId } = useWorkspaceLayoutCtx()
  const [filter, setFilter] = useState<MemoryFilter>({
    status: 'active',
    scope: 'all',
    workspaceId,
    q: '',
    limit: PAGE_SIZE
  })
  const entries = useMemoryEntries(filter, true)
  const add = useAddMemory()
  const [text, setText] = useState('')
  const [scope, setScope] = useState<'project' | 'global'>('project')

  function patch(next: Partial<MemoryFilter>) {
    setFilter(previous => ({ ...previous, limit: PAGE_SIZE, ...next }))
  }

  return (
    <>
      <SettingsSection label="Add a memory">
        <div className="flex flex-col gap-2 p-3.5">
          <Textarea
            aria-label="New memory"
            placeholder="One durable fact, e.g. “Run tests with bun test before committing.”"
            value={text}
            maxLength={2000}
            onChange={event => setText(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <MemorySelect
              label="Memory scope"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'project', label: 'This project' },
                { value: 'global', label: 'All projects' }
              ]}
            />
            <Button
              type="button"
              size="sm"
              disabled={add.isPending || !text.trim()}
              onClick={() =>
                add.mutate({ text, scope, workspaceId }, { onSuccess: () => setText('') })
              }
            >
              {add.isPending && (
                <IconLoader2 data-icon="inline-start" stroke={1.75} className="animate-spin" />
              )}
              Remember
            </Button>
            {add.data && !add.isPending && (
              <span className="text-xs text-muted-foreground">
                {add.data.outcome === 'duplicate'
                  ? 'Already remembered.'
                  : add.data.outcome === 'superseded'
                    ? 'Remembered. It replaced an older fact.'
                    : 'Remembered.'}
              </span>
            )}
          </div>
          {add.isError && <p className="text-xs text-destructive">{add.error.message}</p>}
        </div>
      </SettingsSection>

      <SettingsSection label="Memories">
        <div className="flex flex-wrap items-center gap-2 p-3.5">
          <Input
            aria-label="Search memories"
            placeholder="Search"
            className="max-w-56"
            value={filter.q}
            onChange={event => patch({ q: event.target.value })}
          />
          <MemorySelect
            label="Status"
            value={filter.status}
            onChange={status => patch({ status })}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
              { value: 'all', label: 'All' }
            ]}
          />
          <MemorySelect
            label="Scope"
            value={filter.scope}
            onChange={scopeFilter => patch({ scope: scopeFilter })}
            options={[
              { value: 'all', label: 'Every scope' },
              { value: 'project', label: 'Project' },
              { value: 'global', label: 'All projects' },
              { value: 'session', label: 'One chat' }
            ]}
          />
          <label className="ml-auto flex items-center gap-2 text-sm">
            <Switch
              aria-label="This project only"
              checked={filter.workspaceId !== null}
              onCheckedChange={only => patch({ workspaceId: only ? workspaceId : null })}
            />
            This project only
          </label>
        </div>
        {entries.isPending &&
          [0, 1, 2].map(i => (
            <div key={i} className="flex flex-col gap-2 px-3.5 py-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        {entries.isError && (
          <p className="px-3.5 py-3 text-sm text-destructive">{entries.error.message}</p>
        )}
        {entries.data?.entries.length === 0 && (
          <p className="px-3.5 py-3 text-sm text-muted-foreground">
            {filter.q.trim()
              ? 'No memories match this search.'
              : 'No memories here yet. Agents save them with moi memory add or the memory MCP tools.'}
          </p>
        )}
        {entries.data?.entries.map(entry => (
          <MemoryEntryRow key={entry.id} entry={entry} />
        ))}
        {entries.data && entries.data.total > entries.data.entries.length && (
          <div className="px-3.5 py-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={entries.isFetching}
              onClick={() =>
                setFilter(previous => ({ ...previous, limit: previous.limit + PAGE_SIZE }))
              }
            >
              Show more ({entries.data.total - entries.data.entries.length} left)
            </Button>
          </div>
        )}
      </SettingsSection>
    </>
  )
}
