// crypto.randomUUID() is unavailable on non-secure origins such as a direct
// Tailscale HTTP address. getRandomValues() remains available there, so keep
// browser-generated session and attachment IDs working without weakening auth.
type RandomSource = {
  randomUUID?: () => string
  getRandomValues: (array: Uint8Array) => Uint8Array
}

export function randomId(source: RandomSource = crypto): string {
  if (typeof source.randomUUID === 'function') return source.randomUUID()

  const bytes = source.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // UUID version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 4122 variant
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
