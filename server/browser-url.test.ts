import { expect, test } from 'bun:test'

import { browserBaseUrl, workspaceBrowserUrl } from './browser-url'

test('local auth uses the loopback browser URL', () => {
  expect(browserBaseUrl({ publicUrl: null }, { mode: 'off' }, 13337)).toBe('http://localhost:13337')
})

test('Tailscale auth uses the configured public URL', () => {
  const config = { publicUrl: 'https://moi.tail.test' }
  expect(browserBaseUrl(config, { mode: 'tailscale' }, 13337)).toBe('https://moi.tail.test')
  expect(workspaceBrowserUrl(config, { mode: 'tailscale' }, 13337, 'a/b')).toBe(
    'https://moi.tail.test/workspace/a%2Fb'
  )
})

test('Tailscale auth without a public URL does not emit an unusable localhost link', () => {
  expect(workspaceBrowserUrl({ publicUrl: null }, { mode: 'tailscale' }, 13337, 'abc')).toBeNull()
})
