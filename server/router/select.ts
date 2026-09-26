import type {
  CatalogModel,
  Difficulty,
  EligibilityTable,
  RouteMatcher,
  SessionAgent,
  TaskKind,
  UsageSnapshot
} from '@/lib/types'
import { sameSessionAgent } from '@/lib/session-agent'

import type { Classification, Selection, SelectionCandidate } from './types'

type SelectOptions = {
  claudeReservePercent: number
  restrictToAgent?: SessionAgent
}

const DIFFICULTIES: Difficulty[] = ['trivial', 'medium', 'hard']

function difficultyOrder(difficulty: Difficulty): Difficulty[] {
  const index = DIFFICULTIES.indexOf(difficulty)
  return [difficulty, ...DIFFICULTIES.slice(index + 1), ...DIFFICULTIES.slice(0, index).reverse()]
}

function matcherMatches(row: CatalogModel, matcher: RouteMatcher): boolean {
  if (row.agent.type !== matcher.agent) return false
  return !matcher.match || row.value.toLowerCase().includes(matcher.match.toLowerCase())
}

function snapshotsFor(row: CatalogModel, snapshots: UsageSnapshot[]): UsageSnapshot[] {
  if (row.agent.type === 'ollama') {
    const serverId = row.agent.serverId
    return snapshots.filter(snapshot => snapshot.id === `ollama:${serverId}`)
  }
  const provider = row.agent.type === 'claude-code' ? 'claude' : 'codex'
  return snapshots.filter(snapshot => snapshot.provider === provider)
}

function liveQuota(row: CatalogModel, snapshots: UsageSnapshot[]): UsageSnapshot | undefined {
  return snapshotsFor(row, snapshots)
    .filter(snapshot => snapshot.kind === 'quota' && !snapshot.stale)
    .sort((a, b) => (b.usedPercent ?? -1) - (a.usedPercent ?? -1))[0]
}

function unavailable(row: CatalogModel, snapshots: UsageSnapshot[]): boolean {
  return snapshotsFor(row, snapshots).some(
    snapshot => !snapshot.stale && ['exhausted', 'unavailable'].includes(snapshot.status)
  )
}

function claudeReserved(
  row: CatalogModel,
  difficulty: Difficulty,
  snapshots: UsageSnapshot[],
  threshold: number
): boolean {
  if (row.agent.type !== 'claude-code' || difficulty === 'hard') return false
  return snapshotsFor(row, snapshots).some(
    snapshot =>
      !snapshot.stale && (snapshot.status === 'warning' || (snapshot.usedPercent ?? 0) > threshold)
  )
}

function score(row: CatalogModel, snapshots: UsageSnapshot[], now: number): number {
  if (row.agent.type === 'ollama') return 1000
  const quota = liveQuota(row, snapshots)
  if (quota?.usedPercent === undefined) return 50
  const reset = quota.resetsAt ? Date.parse(quota.resetsAt) : Number.NaN
  const hours = Number.isFinite(reset) ? Math.max((reset - now) / 3_600_000, 0.25) : Infinity
  return (100 - quota.usedPercent) * (1 + (Number.isFinite(hours) ? 1 / hours : 0))
}

function modelLabel(row: CatalogModel): string {
  return row.displayName || row.value
}

function resetPhrase(snapshot: UsageSnapshot | undefined, now: number): string | null {
  if (!snapshot?.resetsAt) return null
  const minutes = Math.max(0, Math.round((Date.parse(snapshot.resetsAt) - now) / 60_000))
  if (!Number.isFinite(minutes)) return null
  return minutes < 60
    ? `${snapshot.label} usage resets in ${minutes} min`
    : `${snapshot.label} usage resets in ${Math.round(minutes / 60)} hr`
}

function reasonFor(
  row: CatalogModel,
  classification: Pick<Classification, 'difficulty' | 'kind' | 'lowConfidence'>,
  snapshots: UsageSnapshot[],
  now: number
): string {
  const prefix = `${modelLabel(row)} · ${classification.kind}, ${classification.difficulty}`
  if (row.agent.type === 'ollama') return `${prefix} · local and ${row.ready ? 'warm' : 'cold'}`
  const quota = liveQuota(row, snapshots)
  const reset = resetPhrase(quota, now)
  const usage =
    quota?.usedPercent === undefined ? null : `${quota.label} ${quota.usedPercent}% used`
  const confidence = classification.lowConfidence
    ? ' · low-confidence difficulty treated as medium'
    : ''
  return `${prefix} · ${reset ?? usage ?? 'usage unknown'}${confidence}`
}

function selectScoped(
  classification: Classification,
  catalog: CatalogModel[],
  snapshots: UsageSnapshot[],
  table: EligibilityTable,
  options: SelectOptions,
  now: number
): Selection | null {
  const candidates: SelectionCandidate[] = []
  for (const tier of difficultyOrder(classification.difficulty)) {
    for (let groupIndex = 0; groupIndex < table[tier].length; groupIndex += 1) {
      const group = table[tier][groupIndex]
      const groupRows: { row: CatalogModel; rank: number; score: number }[] = []
      for (const row of catalog) {
        const rank = group.findIndex(matcher => matcherMatches(row, matcher))
        if (rank < 0) continue
        let dropped: string | null = null
        if (row.disabledReason) dropped = row.disabledReason
        else if (options.restrictToAgent && !sameSessionAgent(row.agent, options.restrictToAgent))
          dropped = 'different agent'
        else if (unavailable(row, snapshots)) dropped = 'unavailable'
        else if (claudeReserved(row, tier, snapshots, options.claudeReservePercent))
          dropped = 'Claude reserve'
        const rowScore = dropped ? null : score(row, snapshots, now)
        candidates.push({ selectionId: row.selectionId, score: rowScore, dropped })
        if (!dropped) groupRows.push({ row, rank, score: rowScore! })
      }
      const warm = groupRows.filter(candidate => candidate.row.ready !== false)
      const eligible = warm.length > 0 ? warm : groupRows
      if (eligible.length === 0) continue
      eligible.sort((a, b) => b.score - a.score || a.rank - b.rank)
      const row = eligible[0].row
      return {
        row,
        tier,
        groupIndex,
        candidates,
        reason: reasonFor(row, classification, snapshots, now)
      }
    }
  }
  return null
}

export function selectRoute(
  classification: Classification,
  catalog: CatalogModel[],
  snapshots: UsageSnapshot[],
  table: EligibilityTable,
  options: SelectOptions,
  now = Date.now()
): Selection | null {
  const selected = selectScoped(classification, catalog, snapshots, table, options, now)
  if (!selected || !options.restrictToAgent) return selected
  const unrestricted = selectScoped(
    classification,
    catalog,
    snapshots,
    table,
    { claudeReservePercent: options.claudeReservePercent },
    now
  )
  if (
    unrestricted &&
    !sameSessionAgent(unrestricted.row.agent, selected.row.agent) &&
    (difficultyOrder(classification.difficulty).indexOf(unrestricted.tier) <
      difficultyOrder(classification.difficulty).indexOf(selected.tier) ||
      (unrestricted.tier === selected.tier && unrestricted.groupIndex < selected.groupIndex))
  ) {
    selected.suggestion = {
      agent: unrestricted.row.agent,
      model: unrestricted.row.value,
      label: modelLabel(unrestricted.row)
    }
  }
  return selected
}

export function routeReasonForTest(
  row: CatalogModel,
  difficulty: Difficulty,
  kind: TaskKind,
  snapshots: UsageSnapshot[],
  now: number
): string {
  return reasonFor(row, { difficulty, kind }, snapshots, now)
}
