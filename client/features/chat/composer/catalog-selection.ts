import type { CatalogModel, SessionAgent } from '@/lib/types'
import { defaultSessionAgent, sameSessionAgent } from '@/lib/session-agent'

export function selectedCatalogModel(
  models: readonly CatalogModel[],
  agent: SessionAgent | undefined,
  model: string | undefined,
  draftSelection?: string,
  allowOtherAgent = true
): CatalogModel | undefined {
  if (draftSelection) {
    const draft = models.find(row => row.selectionId === draftSelection && !row.disabledReason)
    if (draft) return draft
  }
  const target = agent ?? defaultSessionAgent()
  return (
    models.find(
      row => sameSessionAgent(row.agent, target) && row.value === model && !row.disabledReason
    ) ??
    models.find(row => sameSessionAgent(row.agent, target) && !row.disabledReason) ??
    (allowOtherAgent ? models.find(row => !row.disabledReason) : undefined)
  )
}
