import type {
  CatalogModel,
  RoutingClassification,
  RoutingDecisionLog,
  SessionAgent
} from '@/lib/types'

export type Classification = RoutingClassification

export type RouteClassifier = {
  id: 'jev' | 'laya'
  configured(): Promise<boolean>
  classify(input: { message: string; project: string }): Promise<Classification>
}

export type SelectionCandidate = RoutingDecisionLog['candidates'][number]

export type Selection = {
  row: CatalogModel
  reason: string
  candidates: SelectionCandidate[]
  suggestion?: { agent: SessionAgent; model: string; label: string }
  groupIndex: number
  tier: Classification['difficulty']
}

export type RouteDecision = {
  agent: SessionAgent
  model?: string
  label: string
  reason: string
  classification?: Classification
  fallback?: string
  suggestion?: { agent: SessionAgent; model: string; label: string }
  candidates: SelectionCandidate[]
}

export class RouteClassifierError extends Error {}
