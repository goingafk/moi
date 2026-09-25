// Tailscale's device IPv4 range. This checks the address shape, not ownership:
// operators must verify the configured address with `tailscale ip -4` on the
// machine running moi before using direct-tailnet mode.
export function isTailnetIpv4(value: string): boolean {
  const octets = value.split('.')
  return (
    octets.length === 4 &&
    octets.every(octet => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255) &&
    octets[0] === '100' &&
    Number(octets[1]) >= 64 &&
    Number(octets[1]) <= 127
  )
}
