/** "0x7c21…9e0B" */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function isAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
}

/** Avatar initials and hue from the address byte (matchbox-v3 Avatar). */
export function addressAvatar(address: string): {
  initials: string
  hue: number
} {
  const byte = Number.parseInt(address.slice(2, 4), 16)
  return {
    initials: address.slice(2, 4).toUpperCase(),
    hue: Math.round(((Number.isNaN(byte) ? 0 : byte) * 360) / 256),
  }
}
