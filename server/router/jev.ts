import type { Difficulty, TaskKind } from '@/lib/types'

import { getAppSecret } from '../app-secrets'
import { recordJevUsage } from '../usage'
import { RouteClassifierError, type Classification, type RouteClassifier } from './types'

export const TYPESAFE_ROUTER_URL = 'https://api.typesafe.ai/v1/systemone'
const TIMEOUT_MS = 4_000

type JevOptions = {
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  getKey?: () => Promise<string | null>
  onUsage?: (input: number, output: number) => Promise<void>
  url?: string
}

type ChoiceAnswer = { type: 'choice'; choice: string; confidence: number }

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function answer(
  answers: Record<string, unknown>,
  id: string,
  allowed: readonly string[]
): ChoiceAnswer {
  const value = answers[id]
  if (
    !record(value) ||
    value.type !== 'choice' ||
    typeof value.choice !== 'string' ||
    !allowed.includes(value.choice) ||
    typeof value.confidence !== 'number' ||
    !Number.isFinite(value.confidence)
  ) {
    throw new RouteClassifierError(`Jev answer for ${id} is missing or mistyped`)
  }
  return value as ChoiceAnswer
}

export function createJevClassifier(options: JevOptions = {}): RouteClassifier {
  const doFetch = options.fetch ?? fetch
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms))
  const now = options.now ?? Date.now
  const getKey = options.getKey ?? (() => getAppSecret('typesafe-api-key'))
  const onUsage = options.onUsage ?? recordJevUsage
  const url = options.url ?? TYPESAFE_ROUTER_URL

  return {
    id: 'jev',
    configured: async () => Boolean(await getKey()),
    async classify({ message, project }): Promise<Classification> {
      const key = await getKey()
      if (!key) throw new RouteClassifierError('Jev is not configured')
      const body = JSON.stringify({
        model: 'jev-latest',
        state: { message: message.slice(0, 800), project: project.slice(0, 300) },
        questions: {
          difficulty: {
            type: 'choice',
            instructions: 'Classify the engineering effort required to handle this request.',
            criteria: {
              trivial: 'A one-line change, lookup, rename, or quick question.',
              medium:
                'A focused implementation, ordinary refactor, debugging task, or test change.',
              hard: 'Multi-file design, subtle debugging, architecture, or high-risk implementation.'
            }
          },
          kind: {
            type: 'choice',
            instructions: 'Classify the primary kind of work requested.',
            criteria: {
              'ui-scaffold': 'Build or substantially compose a user interface.',
              refactor: 'Restructure existing code without primarily fixing a defect.',
              debug: 'Diagnose or fix incorrect behaviour.',
              tests: 'Create, repair, or extend automated tests.',
              docs: 'Write or revise documentation.',
              other: 'Any request that does not fit the other labels.'
            }
          }
        }
      })
      const started = now()
      let response: Response | null = null
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const remaining = TIMEOUT_MS - (now() - started)
        if (remaining <= 0) throw new RouteClassifierError('Jev routing timed out')
        try {
          response = await doFetch(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body,
            signal: AbortSignal.timeout(remaining)
          })
        } catch (error) {
          throw new RouteClassifierError(`Jev request failed: ${(error as Error).message}`)
        }
        if ((response.status === 429 || response.status === 529) && attempt === 0) {
          const retryAfter = Number(response.headers.get('retry-after'))
          const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500
          if (now() - started + delay >= TIMEOUT_MS)
            throw new RouteClassifierError('Jev routing timed out')
          await sleep(delay)
          continue
        }
        break
      }
      if (!response?.ok) throw new RouteClassifierError(`Jev returned HTTP ${response?.status}`)
      const json: unknown = await response.json().catch(() => null)
      if (!record(json) || !record(json.answers))
        throw new RouteClassifierError('Jev response has no answers')
      const difficulty = answer(json.answers, 'difficulty', ['trivial', 'medium', 'hard'])
      const kind = answer(json.answers, 'kind', [
        'ui-scaffold',
        'refactor',
        'debug',
        'tests',
        'docs',
        'other'
      ])
      const inputTokens = record(json.usage) ? Number(json.usage.input_tokens) || 0 : 0
      const outputTokens = record(json.usage) ? Number(json.usage.output_tokens) || 0 : 0
      await onUsage(inputTokens, outputTokens).catch(() => {})
      const lowConfidence = difficulty.confidence < 0.5
      return {
        difficulty: (lowConfidence ? 'medium' : difficulty.choice) as Difficulty,
        kind: kind.choice as TaskKind,
        confidence: Math.min(difficulty.confidence, kind.confidence),
        classifier: 'jev',
        inputTokens,
        outputTokens,
        ...(lowConfidence ? { lowConfidence: true } : {})
      }
    }
  }
}
