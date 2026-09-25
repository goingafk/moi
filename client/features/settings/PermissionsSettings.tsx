import { useState } from 'react'

import { Input } from '@/client/components/ui/input'
import { Switch } from '@/client/components/ui/switch'
import { Button } from '@/client/components/ui/button'
import type { PermissionMode, PermissionRule } from '@/lib/types'

import { useAppSettings, useSaveAppSettings } from './api'
import { SettingsPage, SettingsRow, SettingsSection } from './SettingsLayout'

const ruleLabels: Record<PermissionRule, string> = {
  outsideProject: 'Outside the project',
  deletes: 'Deletes and overwrites',
  network: 'Network and installs',
  gitDangerous: 'Git publish and discard',
  system: 'System changes',
  sensitiveFiles: 'Sensitive files',
  unparseableShell: 'Unparseable commands'
}

function ModeSelect({
  value,
  disabled,
  onChange,
  codex = false
}: {
  value: PermissionMode
  disabled: boolean
  onChange: (mode: PermissionMode) => void
  codex?: boolean
}) {
  return (
    <select
      aria-label="Default permission mode"
      value={value}
      disabled={disabled}
      onChange={event => onChange(event.target.value as PermissionMode)}
      className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
    >
      <option value="auto">Auto approve</option>
      <option value="ask-risky">Ask for risky</option>
      {!codex && <option value="ask-all">Ask for all</option>}
    </select>
  )
}

export function PermissionsSettings() {
  const { data: settings } = useAppSettings()
  const save = useSaveAppSettings()
  const [askDraft, setAskDraft] = useState<string | null>(null)
  const [allowDraft, setAllowDraft] = useState<string | null>(null)
  const permissions = settings?.permissions

  return (
    <SettingsPage
      title="Permissions"
      description="Default approval behaviour for new chats. Each chat can override its default beside the model picker."
    >
      <SettingsSection label="Defaults">
        {permissions &&
          (['claude', 'codex', 'ollama'] as const).map(agent => (
            <SettingsRow
              key={agent}
              title={agent === 'claude' ? 'Claude Code' : agent === 'codex' ? 'Codex' : 'Ollama'}
              description={
                agent === 'codex'
                  ? 'Codex only sends approvals when its sandbox asks. Ask for all is unavailable.'
                  : undefined
              }
              control={
                <ModeSelect
                  value={permissions.defaults[agent]}
                  codex={agent === 'codex'}
                  disabled={save.isPending}
                  onChange={mode =>
                    save.mutate({
                      permissions: {
                        ...permissions,
                        defaults: { ...permissions.defaults, [agent]: mode }
                      }
                    })
                  }
                />
              }
            />
          ))}
      </SettingsSection>
      <SettingsSection label="Ask for risky rules">
        {permissions &&
          (Object.keys(ruleLabels) as PermissionRule[]).map(rule => (
            <SettingsRow
              key={rule}
              title={ruleLabels[rule]}
              control={
                <Switch
                  aria-label={ruleLabels[rule]}
                  checked={permissions.rules[rule]}
                  disabled={save.isPending}
                  onCheckedChange={checked =>
                    save.mutate({
                      permissions: {
                        ...permissions,
                        rules: { ...permissions.rules, [rule]: checked }
                      }
                    })
                  }
                />
              }
            />
          ))}
      </SettingsSection>
      <SettingsSection label="Custom rules">
        <div className="flex flex-col gap-4 p-3.5">
          <p className="text-xs text-muted-foreground">
            One rule per line: tool:Write, command:git push, or path:**/.env*. Always ask wins over
            always allow.
          </p>
          {permissions &&
            (
              [
                ['Always ask', 'alwaysAsk', askDraft, setAskDraft],
                ['Always allow', 'alwaysAllow', allowDraft, setAllowDraft]
              ] as const
            ).map(([label, field, draft, setDraft]) => (
              <div key={field} className="flex flex-col gap-2">
                <label htmlFor={field} className="text-sm font-medium">
                  {label}
                </label>
                <Input
                  id={field}
                  value={draft ?? permissions[field].join(', ')}
                  onChange={event => setDraft(event.target.value)}
                  placeholder="tool:Write, command:git push"
                />
                <Button
                  type="button"
                  size="sm"
                  className="self-start"
                  disabled={draft === null || save.isPending}
                  onClick={() =>
                    save.mutate(
                      {
                        permissions: {
                          ...permissions,
                          [field]: (draft ?? '')
                            .split(',')
                            .map(value => value.trim())
                            .filter(Boolean)
                        }
                      },
                      { onSuccess: () => setDraft(null) }
                    )
                  }
                >
                  Save {label.toLowerCase()}
                </Button>
              </div>
            ))}
          {save.isError && <p className="text-xs text-destructive">{save.error.message}</p>}
        </div>
      </SettingsSection>
    </SettingsPage>
  )
}
