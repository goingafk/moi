import { expect, test } from 'bun:test'

import type { CatalogModel } from '@/lib/types'
import { selectedCatalogModel } from './catalog-selection'

const models: CatalogModel[] = [
  {
    value: 'same',
    displayName: 'Claude model',
    selectionId: 'claude-code:same',
    agent: { type: 'claude-code' },
    group: 'Claude'
  },
  {
    value: 'same',
    displayName: 'Codex model',
    selectionId: 'codex:same',
    agent: { type: 'codex' },
    group: 'Codex'
  },
  {
    value: 'qwen',
    displayName: 'Qwen',
    selectionId: 'ollama:home:qwen',
    agent: { type: 'ollama', serverId: 'home' },
    group: 'Ollama — Home'
  },
  {
    value: 'old',
    displayName: 'Old',
    selectionId: 'ollama:home:old',
    agent: { type: 'ollama', serverId: 'home' },
    disabledReason: 'No tools'
  }
]

test('selects by agent and model even when model IDs overlap', () => {
  expect(selectedCatalogModel(models, { type: 'codex' }, 'same')?.selectionId).toBe('codex:same')
})

test('new-chat draft can switch agents but cannot choose an unsupported model', () => {
  expect(
    selectedCatalogModel(models, { type: 'claude-code' }, 'same', 'ollama:home:qwen')?.value
  ).toBe('qwen')
  expect(
    selectedCatalogModel(models, { type: 'claude-code' }, 'same', 'ollama:home:old')?.agent.type
  ).toBe('claude-code')
})
