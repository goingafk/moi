import { describe, expect, test } from 'bun:test'

import type { RoutingSettings } from '@/lib/types'

import { classifyRoute } from './classify'
import { createJevClassifier } from './jev'
import { createLayaClassifier } from './laya'
import type { RouteClassifier } from './types'

function jevResponse(difficulty = 'hard', confidence = 0.8): Response {
  return Response.json({
    answers: {
      difficulty: { type: 'choice', choice: difficulty, confidence },
      kind: { type: 'choice', choice: 'debug', confidence: 0.7 }
    },
    usage: { input_tokens: 12, output_tokens: 3 }
  })
}

describe('Jev routing classifier', () => {
  test('sends two compact choice questions and records usage', async () => {
    let body: Record<string, unknown> = {}
    const usage: number[] = []
    const classifier = createJevClassifier({
      getKey: async () => 'secret',
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body))
        return jevResponse()
      },
      onUsage: async (input, output) => {
        usage.push(input, output)
      }
    })
    const result = await classifier.classify({ message: 'x'.repeat(900), project: 'project' })
    expect(Object.keys(body.questions as object)).toEqual(['difficulty', 'kind'])
    expect((body.state as { message: string }).message).toHaveLength(800)
    expect(result).toMatchObject({ difficulty: 'hard', kind: 'debug', confidence: 0.7 })
    expect(usage).toEqual([12, 3])
  })

  test('retries one overload response and treats low-confidence difficulty as medium', async () => {
    let calls = 0
    const classifier = createJevClassifier({
      getKey: async () => 'secret',
      fetch: async () =>
        ++calls === 1 ? new Response('', { status: 529 }) : jevResponse('hard', 0.4),
      sleep: async () => {},
      onUsage: async () => {}
    })
    expect(await classifier.classify({ message: 'debug', project: 'project' })).toMatchObject({
      difficulty: 'medium',
      lowConfidence: true
    })
    expect(calls).toBe(2)
  })

  test('rejects mistyped answers', async () => {
    const classifier = createJevClassifier({
      getKey: async () => 'secret',
      fetch: async () => jevResponse('impossible'),
      onUsage: async () => {}
    })
    await expect(classifier.classify({ message: 'x', project: 'p' })).rejects.toThrow('mistyped')
  })
})

describe('Laya routing classifier', () => {
  test('accepts only the exact response grammar', async () => {
    const make = (content: string) =>
      createLayaClassifier({
        baseUrl: 'http://laya.test',
        model: 'laya',
        fetch: async () => Response.json({ choices: [{ message: { content } }] })
      })
    expect(
      await make('difficulty=trivial kind=docs').classify({ message: 'x', project: 'p' })
    ).toMatchObject({ difficulty: 'trivial', kind: 'docs' })
    await expect(
      make('Difficulty: trivial; kind: docs').classify({ message: 'x', project: 'p' })
    ).rejects.toThrow('invalid')
  })
})

test('classifier chain follows the preferred order and falls through', async () => {
  const calls: string[] = []
  const fake = (id: 'jev' | 'laya', fail: boolean): RouteClassifier => ({
    id,
    configured: async () => true,
    classify: async () => {
      calls.push(id)
      if (fail) throw new Error('no')
      return { difficulty: 'trivial', kind: 'other', confidence: 1, classifier: id }
    }
  })
  const settings: RoutingSettings = {
    classifier: 'laya',
    laya: { baseUrl: 'http://laya.test', model: 'laya' },
    claudeReservePercent: 70,
    table: { trivial: [], medium: [], hard: [] }
  }
  const result = await classifyRoute({ message: 'x', project: 'p' }, settings, {
    classifiers: { laya: fake('laya', true), jev: fake('jev', false) }
  })
  expect(result.classifier).toBe('jev')
  expect(calls).toEqual(['laya', 'jev'])
})
