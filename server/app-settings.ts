import Conf from 'conf'

import type { AppSettings } from '@/lib/types'

import { DATA_DIR } from './data-dir'

// App-wide user settings, stored as `settings.json` in moi's data dir next to
// the workspace registry. Backed by `conf`: atomic writes, per-key JSON-schema
// validation, and migrations when the settings shape evolves. Adding a key
// means extending `AppSettings` (lib/types.ts) and the schema here — with a
// default, so GET /api/settings always returns a complete object — plus
// `API_UPDATABLE` if clients may change it.

export type AppSettingsPatch = Partial<AppSettings>

// Whitelist of fields the API may update. Type validation is NOT duplicated
// here — `saveAppSettings` validates the merged store against the conf schema
// before anything is written, so a bad value throws with nothing persisted.
const API_UPDATABLE = [
  'autoUpdateSkills',
  'modelMode',
  'ollamaServers',
  'localMcpServers'
] as const satisfies readonly (keyof AppSettings)[]

// Pick the API-updatable fields out of an untrusted body; unknown keys are
// dropped. Values are intentionally unchecked — the conf schema rejects wrong
// types when the patch is saved.
export function pickAppSettingsPatch(body: Record<string, unknown>): AppSettingsPatch {
  const picked: Record<string, unknown> = {}
  for (const key of API_UPDATABLE) {
    if (body[key] !== undefined) picked[key] = body[key]
  }
  // Not yet schema-validated; saveAppSettings is the enforcement point.
  return picked as AppSettingsPatch
}

let _dir = DATA_DIR
let _store: Conf<AppSettings> | null = null

// Test seam: point the store at a scratch dir (mirrors setSessionConfigPath).
export function setAppSettingsDir(dir: string): void {
  _dir = dir
  _store = null
}

function store(): Conf<AppSettings> {
  _store ??= new Conf<AppSettings>({
    cwd: _dir,
    configName: 'settings',
    schema: {
      autoUpdateSkills: { type: 'boolean', default: false },
      modelMode: { type: 'string', enum: ['manual', 'auto'], default: 'manual' },
      localMcpServers: { type: 'array', default: [], items: { type: 'string', minLength: 1 } },
      ollamaServers: {
        type: 'array',
        default: [],
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', minLength: 1 },
            name: { type: 'string', minLength: 1 },
            baseUrl: { type: 'string', minLength: 1 }
          },
          required: ['id', 'name', 'baseUrl'],
          additionalProperties: false
        }
      }
    }
  })
  return _store
}

export function getAppSettings(): AppSettings {
  return store().store
}

// Merge a partial settings object over the stored one and return the result.
// The object-form `set` validates the whole merged store against the schema
// before writing, so an invalid patch throws (`Config schema violation: …`)
// and persists nothing.
export function saveAppSettings(patch: AppSettingsPatch): AppSettings {
  const settings = store()
  if (patch.ollamaServers) {
    if (!Array.isArray(patch.ollamaServers)) throw new Error('Ollama servers must be a list')
    const ids = new Set<string>()
    for (const server of patch.ollamaServers) {
      if (
        typeof server.id !== 'string' ||
        typeof server.name !== 'string' ||
        typeof server.baseUrl !== 'string'
      ) {
        throw new Error('Invalid Ollama server')
      }
      if (ids.has(server.id)) throw new Error('Ollama server IDs must be unique')
      ids.add(server.id)
      let url: URL
      try {
        url = new URL(server.baseUrl)
      } catch {
        throw new Error('Invalid Ollama server URL')
      }
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      ) {
        throw new Error('Ollama server URL must be an HTTP(S) origin without credentials or a path')
      }
    }
  }
  if (Object.keys(patch).length > 0) settings.set(patch)
  return settings.store
}
