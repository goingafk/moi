import { expect, test } from 'bun:test'

import { catalogRows, catalogSelectionId } from './model-catalog'

test('catalog keeps raw provider IDs distinct and groups rows', () => {
  const claude = catalogRows({ type: 'claude-code' }, 'Claude', [
    { value: 'default', displayName: 'Default' },
    { value: 'same', displayName: 'Claude model' }
  ])
  const codex = catalogRows({ type: 'codex' }, 'Codex', [
    { value: 'same', displayName: 'Codex model' }
  ])
  expect(claude).toHaveLength(1)
  expect(claude[0]?.selectionId).not.toBe(codex[0]?.selectionId)
  expect(claude[0]?.group).toBe('Claude')
  expect(catalogSelectionId({ type: 'ollama', serverId: 'home' }, 'qwen3.8:27b')).toBe(
    'ollama:home:qwen3.8%3A27b'
  )
})
