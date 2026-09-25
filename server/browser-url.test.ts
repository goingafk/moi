import { expect, test } from 'bun:test'

import { browserBaseUrl, workspaceBrowserUrl } from './browser-url'

test('local auth uses the loopback browser URL', () => {
  expect(browserBaseUrl({ publicUrl: null, tailnetIp: null }, { mode: 'off' }, 13337)).toBe(
    'http://localhost:13337'
  )
})

test('Tailscale auth uses the configured public URL', () => {
  const config = { publicUrl: 'https://moi.tail.test', tailnetIp: null }
  expect(browserBaseUrl(config, { mode: 'tailscale' }, 13337)).toBe('https://moi.tail.test')
  expect(workspaceBrowserUrl(config, { mode: 'tailscale' }, 13337, 'a/b')).toBe(
    'https://moi.tail.test/workspace/a%2Fb'
  )
})

test('Tailscale auth without a public URL does not emit an unusable localhost link', () => {
  expect(
    workspaceBrowserUrl({ publicUrl: null, tailnetIp: null }, { mode: 'tailscale' }, 13337, 'abc')
  ).toBeNull()
})

test('direct-tailnet auth prints the configured device IP', () => {
  const config = { publicUrl: null, tailnetIp: '100.73.80.77' }
  expect(browserBaseUrl(config, { mode: 'tailnet-ip' }, 13337)).toBe('http://100.73.80.77:13337')
})
