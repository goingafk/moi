import { useState } from 'react'

import {
  IconChevronDown,
  IconChevronUp,
  IconLoader2,
  IconPlus,
  IconTrash
} from '@tabler/icons-react'

import { Button } from '@/client/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/client/components/ui/dropdown-menu'
import { Input } from '@/client/components/ui/input'
import { Skeleton } from '@/client/components/ui/skeleton'
import { Switch } from '@/client/components/ui/switch'
import { DEFAULT_ELIGIBILITY_TABLE } from '@/lib/routing'
import type { Difficulty, RouteAgent, RouteMatcher, RoutingSettings } from '@/lib/types'

import {
  useAppSettings,
  useRemoveTypeSafeKey,
  useRoutingDecisions,
  useRoutingStatus,
  useSaveAppSettings,
  useSaveTypeSafeKey
} from './api'
import { routingDecisionSummary, routingDecisionTime } from './routing-presentation'
import { SettingsPage, SettingsRow, SettingsSection } from './SettingsLayout'

type ChoiceProps<T extends string> = {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}

function Choice<T extends string>({ label, value, options, onChange }: ChoiceProps<T>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="outline" size="sm" aria-label={label} />}
      >
        {options.find(option => option.value === value)?.label ?? value}
        <IconChevronDown data-icon="inline-end" stroke={1.75} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup value={value} onValueChange={next => onChange(next as T)}>
            {options.map(option => (
              <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const AGENTS: readonly { value: RouteAgent; label: string }[] = [
  { value: 'claude-code', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'ollama', label: 'Ollama' }
]

export function RoutingSettingsPage() {
  const { data: settings } = useAppSettings()
  if (!settings) {
    return <Skeleton className="h-64 w-full" />
  }
  return <RoutingSettingsContent routing={settings.routing} modelMode={settings.modelMode} />
}

type RoutingSettingsContentProps = {
  routing: RoutingSettings
  modelMode: 'manual' | 'auto'
}

function RoutingSettingsContent({ routing, modelMode }: RoutingSettingsContentProps) {
  const save = useSaveAppSettings()
  const status = useRoutingStatus()
  const saveKey = useSaveTypeSafeKey()
  const removeKey = useRemoveTypeSafeKey()
  const decisions = useRoutingDecisions()
  const [key, setKey] = useState('')
  const [layaUrl, setLayaUrl] = useState(routing.laya?.baseUrl ?? '')
  const [layaModel, setLayaModel] = useState(routing.laya?.model ?? '')

  const saveRouting = (patch: Partial<RoutingSettings>) =>
    save.mutate({ routing: { ...routing, ...patch } })

  const updateMatcher = (
    tier: Difficulty,
    groupIndex: number,
    matcherIndex: number,
    next: RouteMatcher | null
  ) => {
    const table = structuredClone(routing.table)
    if (next) table[tier][groupIndex][matcherIndex] = next
    else {
      table[tier][groupIndex].splice(matcherIndex, 1)
      if (table[tier][groupIndex].length === 0) table[tier].splice(groupIndex, 1)
    }
    saveRouting({ table })
  }

  const moveGroup = (tier: Difficulty, index: number, direction: -1 | 1) => {
    const table = structuredClone(routing.table)
    const target = index + direction
    if (!table[tier][target]) return
    ;[table[tier][index], table[tier][target]] = [table[tier][target], table[tier][index]]
    saveRouting({ table })
  }

  return (
    <SettingsPage
      title="Routing"
      description="Let Jev or Laya classify each request, then choose an available model from your routing table."
    >
      <SettingsSection label="Defaults">
        <SettingsRow
          title="Auto for new chats"
          description="Classify and choose a model for every message. Existing chats keep their current mode."
          control={
            <Switch
              aria-label="Auto for new chats"
              checked={modelMode === 'auto'}
              disabled={save.isPending}
              onCheckedChange={auto => save.mutate({ modelMode: auto ? 'auto' : 'manual' })}
            />
          }
        />
        <SettingsRow
          title="Primary classifier"
          description="The other configured classifier is used if this one fails."
          control={
            <Choice
              label="Primary classifier"
              value={routing.classifier}
              options={[
                { value: 'jev', label: 'Jev' },
                { value: 'laya', label: 'Laya' }
              ]}
              onChange={classifier => saveRouting({ classifier })}
            />
          }
        />
        <SettingsRow
          title="Claude reserve"
          description="Skip Claude for trivial and medium work above this used percentage."
          control={
            <Input
              aria-label="Claude reserve percent"
              type="number"
              min={0}
              max={100}
              className="w-20 tabular-nums"
              defaultValue={routing.claudeReservePercent}
              onBlur={event => {
                const value = Number(event.target.value)
                if (Number.isFinite(value) && value >= 0 && value <= 100)
                  saveRouting({ claudeReservePercent: value })
              }}
            />
          }
        />
      </SettingsSection>

      <SettingsSection label="TypeSafe">
        <div className="flex flex-col gap-2 p-3.5">
          <p className="text-xs text-muted-foreground">
            {status.data?.jevKeySet ? 'Key saved in moi’s secret store.' : 'No TypeSafe key saved.'}
          </p>
          <div className="flex gap-2">
            <Input
              aria-label="TypeSafe API key"
              type="password"
              autoComplete="off"
              placeholder="TypeSafe API key"
              value={key}
              onChange={event => setKey(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              disabled={!key.trim() || saveKey.isPending}
              onClick={() => saveKey.mutate(key, { onSuccess: () => setKey('') })}
            >
              {saveKey.isPending && (
                <IconLoader2 data-icon="inline-start" stroke={1.75} className="animate-spin" />
              )}
              Save key
            </Button>
            {status.data?.jevKeySet && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={removeKey.isPending}
                onClick={() => removeKey.mutate()}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection label="Laya">
        <div className="flex flex-col gap-2 p-3.5">
          <Input
            aria-label="Laya base URL"
            placeholder="http://100.x.y.z:11434"
            value={layaUrl}
            onChange={event => setLayaUrl(event.target.value)}
          />
          <Input
            aria-label="Laya model"
            placeholder="Model name"
            value={layaModel}
            onChange={event => setLayaModel(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={save.isPending || !layaUrl.trim() || !layaModel.trim()}
              onClick={() =>
                saveRouting({ laya: { baseUrl: layaUrl.trim(), model: layaModel.trim() } })
              }
            >
              Save endpoint
            </Button>
            {routing.laya && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => saveRouting({ laya: null })}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection label="Eligibility table">
        {(['trivial', 'medium', 'hard'] as const).map(tier => (
          <div key={tier} className="flex flex-col gap-2 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {tier.charAt(0).toUpperCase() + tier.slice(1)}
              </span>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() =>
                  saveRouting({
                    table: {
                      ...routing.table,
                      [tier]: [...routing.table[tier], [{ agent: 'codex' }]]
                    }
                  })
                }
              >
                <IconPlus data-icon="inline-start" stroke={1.75} />
                Add group
              </Button>
            </div>
            {routing.table[tier].map((group, groupIndex) =>
              group.map((matcher, matcherIndex) => (
                <div key={`${groupIndex}:${matcherIndex}`} className="flex items-center gap-2">
                  <span className="w-8 shrink-0 text-xs text-muted-foreground">
                    {groupIndex + 1}
                  </span>
                  <Choice
                    label="Agent"
                    value={matcher.agent}
                    options={AGENTS}
                    onChange={agent =>
                      updateMatcher(tier, groupIndex, matcherIndex, { ...matcher, agent })
                    }
                  />
                  <Input
                    aria-label={`${tier} model match`}
                    placeholder="Any model"
                    defaultValue={matcher.match ?? ''}
                    onBlur={event =>
                      updateMatcher(tier, groupIndex, matcherIndex, {
                        agent: matcher.agent,
                        ...(event.target.value.trim() ? { match: event.target.value.trim() } : {})
                      })
                    }
                  />
                  {matcherIndex === 0 && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Move group up"
                        disabled={groupIndex === 0}
                        onClick={() => moveGroup(tier, groupIndex, -1)}
                      >
                        <IconChevronUp stroke={1.75} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Move group down"
                        disabled={groupIndex === routing.table[tier].length - 1}
                        onClick={() => moveGroup(tier, groupIndex, 1)}
                      >
                        <IconChevronDown stroke={1.75} />
                      </Button>
                    </>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Remove matcher"
                    onClick={() => updateMatcher(tier, groupIndex, matcherIndex, null)}
                  >
                    <IconTrash stroke={1.75} />
                  </Button>
                </div>
              ))
            )}
          </div>
        ))}
        <div className="p-3.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => saveRouting({ table: structuredClone(DEFAULT_ELIGIBILITY_TABLE) })}
          >
            Reset to defaults
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection label="Recent decisions">
        {decisions.isPending && (
          <div className="flex flex-col gap-2 p-3.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        {decisions.data?.length === 0 && (
          <p className="p-3.5 text-sm text-muted-foreground">No routed messages yet.</p>
        )}
        {decisions.data?.map(entry => (
          <div key={`${entry.at}:${entry.sessionId}`} className="flex flex-col gap-0.5 p-3.5">
            <span className="truncate text-sm">
              {entry.messagePreview || 'Attachment-only message'}
            </span>
            <span className="text-xs text-muted-foreground">
              {routingDecisionTime(entry.at)} · {routingDecisionSummary(entry)}
            </span>
          </div>
        ))}
      </SettingsSection>
      {(save.isError || saveKey.isError || removeKey.isError) && (
        <p className="text-xs text-destructive">
          Couldn’t save routing settings. Check the endpoint and table values.
        </p>
      )}
    </SettingsPage>
  )
}
