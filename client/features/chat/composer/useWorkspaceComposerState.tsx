import {
  startWorkspaceLogin,
  useModelCatalog,
  useWorkspaceAgent
} from '@/client/features/workspace/api'
import { useSessionConfig } from '../sessions/api'
import { selectedCatalogModel } from './catalog-selection'
import { useUiStore } from '@/client/store/ui'
import { resolveAgentAvailability, type AgentAvailability } from '@/client/lib/agent-availability'

import { ErrorBanner } from './banners/ErrorBanner'
import { resolveComposerBanner, type ComposerBanner } from './banners/ComposerBanner'
import { AgentAvailabilityBanner } from './banners/AgentAvailabilityBanner'
import { SkillUpdateBanner } from './banners/SkillUpdateBanner'
import { useWorkspaceSkillUpdates } from './useWorkspaceSkillUpdates'

type WorkspaceComposerStateOptions = {
  sessionId: string | null
  chatError: string | null
  onDismissChatError: () => void
  chatLoadError?: string | null
  onRetryChatLoad?: () => void
}

type WorkspaceComposerState = {
  composerBanner?: ComposerBanner
  builderComposerBanner?: ComposerBanner
  agentAvailability: AgentAvailability
  builderAgentAvailability: AgentAvailability
}

export function useWorkspaceComposerState(
  workspaceId: string,
  {
    sessionId,
    chatError,
    onDismissChatError,
    chatLoadError,
    onRetryChatLoad
  }: WorkspaceComposerStateOptions
): WorkspaceComposerState {
  const { data: agent, error } = useWorkspaceAgent(workspaceId)
  const catalog = useModelCatalog(workspaceId).data
  const sessionConfig = useSessionConfig(workspaceId, sessionId).data
  const draftSelection = useUiStore(state => state.modelSelections[workspaceId])
  const availability = agent?.availability
  const { bannerProps: skillUpdateBanner } = useWorkspaceSkillUpdates(workspaceId)
  const workspaceAvailability = resolveAgentAvailability(availability, Boolean(error))
  const selected = selectedCatalogModel(
    catalog ?? [],
    sessionConfig?.agent ?? { type: agent?.provider ?? 'claude-code' },
    sessionConfig?.model,
    sessionId ? undefined : draftSelection,
    !sessionId
  )
  const alternate = selected && selected.agent.type !== agent?.provider
  const agentAvailability: AgentAvailability = alternate
    ? { status: 'available' }
    : workspaceAvailability
  const unavailable =
    agentAvailability.status === 'checking' || agentAvailability.status === 'available'
      ? undefined
      : agentAvailability

  const agentUnavailableBanner: ComposerBanner | undefined = unavailable
    ? {
        tone: 'default',
        content: (
          <AgentAvailabilityBanner
            availability={unavailable}
            login={agent?.login}
            onStartLogin={() => startWorkspaceLogin(workspaceId)}
          />
        )
      }
    : undefined
  let chatErrorBanner: ComposerBanner | undefined
  if (chatLoadError) {
    chatErrorBanner = {
      tone: 'error',
      content: <ErrorBanner error={chatLoadError} onRetry={onRetryChatLoad} />
    }
  } else if (chatError) {
    chatErrorBanner = {
      tone: 'error',
      content: <ErrorBanner error={chatError} onDismiss={onDismissChatError} />
    }
  }
  const skillUpdate: ComposerBanner | undefined = skillUpdateBanner
    ? {
        tone: 'default',
        content: <SkillUpdateBanner {...skillUpdateBanner} />
      }
    : undefined
  const composerBanner = resolveComposerBanner({
    agentUnavailable: agentUnavailableBanner,
    chatError: chatErrorBanner,
    skillUpdate
  })
  const builderComposerBanner = resolveComposerBanner({
    agentUnavailable:
      workspaceAvailability.status === 'checking' || workspaceAvailability.status === 'available'
        ? undefined
        : {
            tone: 'default',
            content: (
              <AgentAvailabilityBanner
                availability={workspaceAvailability}
                login={agent?.login}
                onStartLogin={() => startWorkspaceLogin(workspaceId)}
              />
            )
          },
    skillUpdate
  })

  return {
    agentAvailability,
    builderAgentAvailability: workspaceAvailability,
    composerBanner,
    builderComposerBanner
  }
}
