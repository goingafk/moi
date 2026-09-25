import { expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'

import { workspaceKeys } from '@/client/api/workspace-keys'
import type { SessionConfig } from '@/lib/types'

import { reduceChatFrame } from './chat-frames'

test('session rename invalidates copied config so the permanent binding and model refetch', () => {
  const queryClient = new QueryClient()
  const from = workspaceKeys.sessionConfig('workspace', 'temporary')
  const to = workspaceKeys.sessionConfig('workspace', 'permanent')
  queryClient.setQueryData<SessionConfig>(from, { agent: { type: 'ollama', serverId: 'home' } })

  reduceChatFrame(
    { type: 'session_renamed', workspaceId: 'workspace', from: 'temporary', to: 'permanent' },
    { queryClient, sendMessage: () => {}, onWorkspaceSwitch: null }
  )

  expect(queryClient.getQueryData<SessionConfig>(to)).toEqual({
    agent: { type: 'ollama', serverId: 'home' }
  })
  expect(queryClient.getQueryState(to)?.isInvalidated).toBe(true)
  expect(queryClient.getQueryData(from)).toBeUndefined()
})
