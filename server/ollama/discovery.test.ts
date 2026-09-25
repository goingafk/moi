import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { cachedOllamaModels, clearOllamaModelCache, discoverOllamaModels } from './discovery'

let server: Bun.Server<undefined>
let showCalls = 0

beforeAll(() => {
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (path === '/api/tags') {
        return Response.json({ models: [{ name: 'qwen3.8:27b' }, { model: 'embedding:latest' }] })
      }
      if (path === '/api/ps') return Response.json({ models: [{ name: 'qwen3.8:27b' }] })
      if (path === '/api/show') {
        showCalls++
        const body = (await request.json()) as { model: string }
        return Response.json({
          capabilities: body.model === 'qwen3.8:27b' ? ['completion', 'tools'] : ['embedding']
        })
      }
      return new Response(null, { status: 404 })
    }
  })
})

afterAll(() => {
  server.stop(true)
  clearOllamaModelCache()
})

describe('Ollama discovery', () => {
  test('checks tools through show and loaded state through ps', async () => {
    const models = await discoverOllamaModels({
      id: 'home',
      name: 'Home',
      baseUrl: `http://127.0.0.1:${server.port}`
    })
    expect(models).toEqual([
      { name: 'qwen3.8:27b', supportsTools: true, ready: true },
      { name: 'embedding:latest', supportsTools: false, ready: false }
    ])
  })

  test('uses a short cache and refreshes on demand', async () => {
    const target = { id: 'home', name: 'Home', baseUrl: `http://127.0.0.1:${server.port}` }
    showCalls = 0
    await cachedOllamaModels(target)
    await cachedOllamaModels(target)
    expect(showCalls).toBe(2)
    await cachedOllamaModels(target, true)
    expect(showCalls).toBe(4)
  })
})
