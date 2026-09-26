import type { Difficulty, TaskKind } from '@/lib/types'

import { RouteClassifierError, type RouteClassifier } from './types'

type LayaOptions = {
  baseUrl: string
  model: string
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
}

const RESPONSE_RE =
  /^difficulty=(trivial|medium|hard) kind=(ui-scaffold|refactor|debug|tests|docs|other)$/

export function createLayaClassifier(options: LayaOptions): RouteClassifier {
  const doFetch = options.fetch ?? fetch
  return {
    id: 'laya',
    configured: async () => Boolean(options.baseUrl && options.model),
    async classify({ message, project }) {
      let response: Response
      try {
        response = await doFetch(`${options.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(4_000),
          body: JSON.stringify({
            model: options.model,
            temperature: 0,
            messages: [
              {
                role: 'system',
                content:
                  'Classify the request. Reply exactly: difficulty=<trivial|medium|hard> kind=<ui-scaffold|refactor|debug|tests|docs|other>'
              },
              {
                role: 'user',
                content: `Project: ${project.slice(0, 300)}\nRequest: ${message.slice(0, 800)}`
              }
            ]
          })
        })
      } catch (error) {
        throw new RouteClassifierError(`Laya request failed: ${(error as Error).message}`)
      }
      if (!response.ok) throw new RouteClassifierError(`Laya returned HTTP ${response.status}`)
      const json: unknown = await response.json().catch(() => null)
      const content =
        json &&
        typeof json === 'object' &&
        'choices' in json &&
        Array.isArray(json.choices) &&
        json.choices[0] &&
        typeof json.choices[0] === 'object' &&
        'message' in json.choices[0] &&
        json.choices[0].message &&
        typeof json.choices[0].message === 'object' &&
        'content' in json.choices[0].message
          ? json.choices[0].message.content
          : null
      const match = typeof content === 'string' ? RESPONSE_RE.exec(content) : null
      if (!match) throw new RouteClassifierError('Laya returned an invalid classification')
      return {
        difficulty: match[1] as Difficulty,
        kind: match[2] as TaskKind,
        confidence: 1,
        classifier: 'laya'
      }
    }
  }
}
