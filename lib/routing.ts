import type { EligibilityTable } from './types'

export const DEFAULT_ELIGIBILITY_TABLE: EligibilityTable = {
  trivial: [
    [{ agent: 'ollama' }],
    [
      { agent: 'claude-code', match: 'haiku' },
      { agent: 'codex', match: 'luna' }
    ]
  ],
  medium: [
    [
      { agent: 'claude-code', match: 'sonnet' },
      { agent: 'codex', match: 'sol' }
    ]
  ],
  hard: [
    [
      { agent: 'claude-code', match: 'opus' },
      { agent: 'codex', match: 'astra' }
    ]
  ]
}
