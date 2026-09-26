import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { RoutingDecisionLog, SessionAgent } from '@/lib/types'
import { sameSessionAgent } from '@/lib/session-agent'

import { DATA_DIR } from '../data-dir'

export const DEFAULT_ROUTING_LOG_PATH = join(DATA_DIR, 'routing-decisions.jsonl')
let logPath = DEFAULT_ROUTING_LOG_PATH
let writeChain: Promise<unknown> = Promise.resolve()

export function setRoutingLogPath(path: string): void {
  logPath = path
  writeChain = Promise.resolve()
}

export async function appendRoutingDecision(entry: RoutingDecisionLog): Promise<void> {
  const run = writeChain.then(async () => {
    await mkdir(dirname(logPath), { recursive: true })
    await appendFile(logPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
  })
  writeChain = run.catch(() => {})
  await run
}

export async function recentRoutingDecisions(limit = 20): Promise<RoutingDecisionLog[]> {
  try {
    const lines = (await Bun.file(logPath).text()).trim().split('\n').filter(Boolean)
    const entries: RoutingDecisionLog[] = []
    for (const line of lines.slice(-Math.max(1, Math.min(limit, 100))).reverse()) {
      try {
        const value: unknown = JSON.parse(line)
        if (value && typeof value === 'object') entries.push(value as RoutingDecisionLog)
      } catch {}
    }
    return entries
  } catch {
    return []
  }
}

export async function lastRoutedChoice(
  workspacePath: string,
  restrictToAgent?: SessionAgent
): Promise<RoutingDecisionLog['chosen'] | null> {
  const entries = await recentRoutingDecisions(100)
  return (
    entries.find(
      entry =>
        entry.workspacePath === workspacePath &&
        (!restrictToAgent || sameSessionAgent(entry.chosen.agent, restrictToAgent))
    )?.chosen ?? null
  )
}
