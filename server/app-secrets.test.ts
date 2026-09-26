import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  deleteAppSecret,
  getAppSecret,
  hasAppSecret,
  resetAppSecretStoreForTest,
  setAppSecret,
  setAppSecretStoreBackend,
  setAppSecretStorePath
} from './app-secrets'

let dir = ''
let path = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'moi-app-secrets-'))
  path = join(dir, 'app-secrets.json')
  setAppSecretStorePath(path)
  setAppSecretStoreBackend('file')
})

afterEach(async () => {
  resetAppSecretStoreForTest()
  await rm(dir, { recursive: true, force: true })
})

test('stores, reads, and removes app secrets in an owner-only file', async () => {
  expect(await getAppSecret('typesafe-api-key')).toBeNull()
  await setAppSecret('typesafe-api-key', 'secret')
  expect(await getAppSecret('typesafe-api-key')).toBe('secret')
  expect(await hasAppSecret('typesafe-api-key')).toBe(true)
  expect((await stat(path)).mode & 0o777).toBe(0o600)
  await deleteAppSecret('typesafe-api-key')
  expect(await getAppSecret('typesafe-api-key')).toBeNull()
})
