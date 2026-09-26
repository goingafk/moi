// A workspace's memory project identity: its `origin` git remote URL, or the
// absolute workspace path when there is none. The memory service normalises
// it (so `git@github.com:a/b.git` and `https://github.com/a/b` agree across
// machines); moi only resolves the raw value. Cached per path — remotes rarely
// change, and this runs before every chat send.

import { resolve } from 'path'

const cache = new Map<string, Promise<string>>()

async function resolveProject(workspacePath: string): Promise<string> {
  const path = resolve(workspacePath)
  try {
    const proc = Bun.spawn(['git', '-C', path, 'remote', 'get-url', 'origin'], {
      stdout: 'pipe',
      stderr: 'ignore',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    const remote = out.trim()
    if (code === 0 && remote) return remote
  } catch {}
  return path
}

export function memoryProjectFor(workspacePath: string): Promise<string> {
  const key = resolve(workspacePath)
  let pending = cache.get(key)
  if (!pending) {
    pending = resolveProject(key)
    cache.set(key, pending)
  }
  return pending
}

// Test seam.
export function clearMemoryProjectCache(): void {
  cache.clear()
}
