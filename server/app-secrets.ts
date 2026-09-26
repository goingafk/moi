import { chmod, mkdir, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { DATA_DIR } from './data-dir'

export type AppSecretName = 'typesafe-api-key'
type SecretBackend = 'auto' | 'file' | 'keychain'
type SecretMap = Partial<Record<AppSecretName, string>>

const SERVICE = 'com.molefrog.moi'
const KEYCHAIN_NAME_PREFIX = 'app:'
export const DEFAULT_APP_SECRETS_PATH = join(DATA_DIR, 'app-secrets.json')

let backend: SecretBackend = process.env.MOI_SECRET_BACKEND === 'file' ? 'file' : 'auto'
let filePath = DEFAULT_APP_SECRETS_PATH
let resolvedBackend: Promise<'file' | 'keychain'> | null = null
let writeChain: Promise<unknown> = Promise.resolve()

export function setAppSecretStoreBackend(next: SecretBackend): void {
  backend = next
  resolvedBackend = null
}

export function setAppSecretStorePath(path: string): void {
  filePath = path
  resolvedBackend = null
}

export function resetAppSecretStoreForTest(): void {
  filePath = DEFAULT_APP_SECRETS_PATH
  backend = process.env.MOI_SECRET_BACKEND === 'file' ? 'file' : 'auto'
  resolvedBackend = null
  writeChain = Promise.resolve()
}

async function activeBackend(): Promise<'file' | 'keychain'> {
  if (backend !== 'auto') return backend
  resolvedBackend ??= Bun.secrets
    .get({ service: SERVICE, name: `${KEYCHAIN_NAME_PREFIX}__probe__` })
    .then(() => 'keychain' as const)
    .catch(() => 'file' as const)
  return resolvedBackend
}

async function readFileSecrets(): Promise<SecretMap> {
  try {
    const value: unknown = await Bun.file(filePath).json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const key = (value as Record<string, unknown>)['typesafe-api-key']
    return typeof key === 'string' ? { 'typesafe-api-key': key } : {}
  } catch {
    return {}
  }
}

async function writeFileSecrets(secrets: SecretMap): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  await Bun.write(temporaryPath, `${JSON.stringify(secrets, null, 2)}\n`)
  await chmod(temporaryPath, 0o600)
  await rename(temporaryPath, filePath)
}

export async function getAppSecret(name: AppSecretName): Promise<string | null> {
  if ((await activeBackend()) === 'keychain') {
    return Bun.secrets.get({ service: SERVICE, name: `${KEYCHAIN_NAME_PREFIX}${name}` })
  }
  return (await readFileSecrets())[name] ?? null
}

export async function hasAppSecret(name: AppSecretName): Promise<boolean> {
  return Boolean(await getAppSecret(name))
}

export async function setAppSecret(name: AppSecretName, value: string): Promise<void> {
  if ((await activeBackend()) === 'keychain') {
    await Bun.secrets.set({ service: SERVICE, name: `${KEYCHAIN_NAME_PREFIX}${name}`, value })
    return
  }
  const run = writeChain.then(async () => {
    const secrets = await readFileSecrets()
    secrets[name] = value
    await writeFileSecrets(secrets)
  })
  writeChain = run.catch(() => {})
  await run
}

export async function deleteAppSecret(name: AppSecretName): Promise<void> {
  if ((await activeBackend()) === 'keychain') {
    await Bun.secrets
      .delete({ service: SERVICE, name: `${KEYCHAIN_NAME_PREFIX}${name}` })
      .catch(() => {})
    return
  }
  const run = writeChain.then(async () => {
    const secrets = await readFileSecrets()
    delete secrets[name]
    await writeFileSecrets(secrets)
  })
  writeChain = run.catch(() => {})
  await run
}
