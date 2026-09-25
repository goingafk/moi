import { Button } from '@/client/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/client/components/ui/dropdown-menu'
import { useSessionConfig, useSaveSessionConfig } from '@/client/features/chat/sessions/api'
import { useAppSettings } from '@/client/features/settings/api'
import { useModelCatalog, useWorkspaceAgent } from '@/client/features/workspace/api'
import { useWorkspaceId } from '@/client/features/workspace/WorkspaceContext'
import { useUiStore } from '@/client/store/ui'
import { selectedCatalogModel } from './catalog-selection'
import type { PermissionMode } from '@/lib/types'

const labels: Record<PermissionMode, string> = {
  auto: 'Auto approve',
  'ask-risky': 'Ask for risky',
  'ask-all': 'Ask for all'
}

export function PermissionPicker({ sessionId }: { sessionId: string | null }) {
  const workspaceId = useWorkspaceId()
  const config = useSessionConfig(workspaceId, sessionId).data
  const save = useSaveSessionConfig(workspaceId)
  const settings = useAppSettings().data
  const catalog = useModelCatalog(workspaceId).data ?? []
  const defaultAgent = useWorkspaceAgent(workspaceId).data?.provider ?? 'claude-code'
  const draftModel = useUiStore(state => state.modelSelections?.[workspaceId])
  const draftMode = useUiStore(state => state.permissionSelections?.[workspaceId])
  const agent = sessionId
    ? config?.agent
    : (selectedCatalogModel(catalog, { type: defaultAgent }, undefined, draftModel, true)
        ?.agent ?? { type: defaultAgent })
  const defaults = settings?.permissions.defaults
  const mode =
    (sessionId ? config?.permissionMode : draftMode) ??
    (agent?.type === 'ollama'
      ? defaults?.ollama
      : agent?.type === 'codex'
        ? defaults?.codex
        : defaults?.claude) ??
    'auto'
  const choose = (value: string) => {
    if (value !== 'auto' && value !== 'ask-risky' && value !== 'ask-all') return
    if (agent?.type === 'codex' && value === 'ask-all') return
    if (sessionId) save.mutate({ sessionId, patch: { permissionMode: value } })
    else useUiStore.getState().setPermissionSelection(workspaceId, value)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Permissions: ${labels[mode]}`}
          >
            {labels[mode]}
          </Button>
        }
      />
      <DropdownMenuContent align="end" side="top">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Permissions</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={mode} onValueChange={choose}>
            <DropdownMenuRadioItem value="auto">{labels.auto}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="ask-risky"
              title={
                agent?.type === 'codex'
                  ? 'Codex asks only when its own sandbox requests approval'
                  : undefined
              }
            >
              {labels['ask-risky']}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="ask-all"
              disabled={agent?.type === 'codex'}
              title={
                agent?.type === 'codex'
                  ? 'Codex does not expose every tool call for approval'
                  : undefined
              }
            >
              {labels['ask-all']}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
