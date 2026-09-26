import { useState } from 'react'

import { IconLoader2, IconTrash } from '@tabler/icons-react'

import { Button } from '@/client/components/ui/button'
import { Input } from '@/client/components/ui/input'
import { useModelCatalog } from '@/client/features/workspace/api'
import { useWorkspaceLayoutCtx } from '@/client/features/workspace/WorkspaceLayoutContext'
import { randomId } from '@/client/lib/random-id'

import { useAppSettings, useSaveAppSettings } from './api'
import { SettingsPage, SettingsRow, SettingsSection } from './SettingsLayout'

export function ModelsSettings() {
  const { workspaceId } = useWorkspaceLayoutCtx()
  const { data: settings } = useAppSettings()
  const save = useSaveAppSettings()
  const catalog = useModelCatalog(workspaceId)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [mcpNames, setMcpNames] = useState<string | null>(null)

  function addServer() {
    if (!settings || !name.trim() || !baseUrl.trim()) return
    save.mutate(
      {
        ollamaServers: [
          ...settings.ollamaServers,
          { id: randomId(), name: name.trim(), baseUrl: baseUrl.trim() }
        ]
      },
      {
        onSuccess: () => {
          setName('')
          setBaseUrl('')
          void catalog.refetch()
        }
      }
    )
  }

  return (
    <SettingsPage
      title="Models"
      description="Choose agents and connect Ollama servers for local models."
    >
      <SettingsSection label="Local model tools">
        <div className="flex flex-col gap-2 p-3.5">
          <p className="text-xs text-muted-foreground">
            Only these named servers from the space’s .mcp.json are available to Ollama chats. Leave
            blank for none.
          </p>
          <Input
            aria-label="Allowed local MCP servers"
            placeholder="github, filesystem"
            value={mcpNames ?? settings?.localMcpServers.join(', ') ?? ''}
            onChange={event => setMcpNames(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            className="self-start"
            disabled={!settings || save.isPending || mcpNames === null}
            onClick={() =>
              save.mutate(
                {
                  localMcpServers: [
                    ...new Set(
                      (mcpNames ?? '')
                        .split(',')
                        .map(name => name.trim())
                        .filter(Boolean)
                    )
                  ]
                },
                { onSuccess: () => setMcpNames(null) }
              )
            }
          >
            Save tool allow-list
          </Button>
        </div>
      </SettingsSection>
      <SettingsSection label="Ollama servers">
        {settings?.ollamaServers.map(server => (
          <SettingsRow
            key={server.id}
            title={server.name}
            description={server.baseUrl}
            control={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${server.name}`}
                disabled={save.isPending}
                onClick={() =>
                  save.mutate(
                    { ollamaServers: settings.ollamaServers.filter(item => item.id !== server.id) },
                    { onSuccess: () => void catalog.refetch() }
                  )
                }
              >
                <IconTrash stroke={1.75} />
              </Button>
            }
          />
        ))}
        <div className="flex flex-col gap-2 p-3.5">
          <Input
            aria-label="Server name"
            placeholder="Server name"
            value={name}
            onChange={event => setName(event.target.value)}
          />
          <Input
            aria-label="Ollama URL"
            placeholder="http://100.x.y.z:11434"
            value={baseUrl}
            onChange={event => setBaseUrl(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            disabled={!settings || save.isPending || !name.trim() || !baseUrl.trim()}
            onClick={addServer}
            className="self-start"
          >
            {save.isPending && (
              <IconLoader2 data-icon="inline-start" stroke={1.75} className="animate-spin" />
            )}
            Add server
          </Button>
          {save.isError && <p className="text-xs text-destructive">{save.error.message}</p>}
        </div>
      </SettingsSection>
    </SettingsPage>
  )
}
