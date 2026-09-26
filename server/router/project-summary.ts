import { basename, join } from 'node:path'

const cache = new Map<string, Promise<string>>()

async function readSummary(workspacePath: string): Promise<string> {
  const name = basename(workspacePath)
  for (const filename of ['README.md', 'README']) {
    try {
      const text = await Bun.file(join(workspacePath, filename)).text()
      const paragraph = text
        .replace(/^#.*$/gm, '')
        .split(/\n\s*\n/)
        .map(value => value.replace(/\s+/g, ' ').trim())
        .find(Boolean)
      if (paragraph) return `${name}: ${paragraph}`.slice(0, 300)
    } catch {}
  }
  try {
    const pkg: unknown = await Bun.file(join(workspacePath, 'package.json')).json()
    if (
      pkg &&
      typeof pkg === 'object' &&
      'description' in pkg &&
      typeof pkg.description === 'string'
    )
      return `${name}: ${pkg.description}`.slice(0, 300)
  } catch {}
  return name.slice(0, 300)
}

export function projectSummary(workspacePath: string): Promise<string> {
  let value = cache.get(workspacePath)
  if (!value) {
    value = readSummary(workspacePath)
    cache.set(workspacePath, value)
  }
  return value
}

export function clearProjectSummaryCache(): void {
  cache.clear()
}
