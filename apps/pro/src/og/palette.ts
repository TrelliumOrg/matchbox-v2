/**
 * The Graphite theme (`@matchbox/tokens` themes.css), which every card is
 * drawn on. Satori takes no CSS variables, so the values are copied here.
 */
export const bg = "#121212"
export const soft2 = "#2a2a27"
export const line = "#2e2e2b"
export const ink = "#f4f4f2"
export const ink2 = "#d9dad5"
export const sec = "#a3a49f"
export const mut = "#8e908a"
export const acc = "#f7931a"
export const mezo = "#c7365c"
export const pos = "#5bc48a"
export const bandAcc = "#5a3f18"
export const bandPos = "#1f4a33"

/** `hsl(h s% l%)` as hex, which every renderer reads. */
export function hsl(
  hue: number,
  saturation: number,
  lightness: number,
): string {
  const s = saturation / 100
  const l = lightness / 100
  const a = s * Math.min(l, 1 - l)
  function channel(n: number): string {
    const k = (n + hue / 30) % 12
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0")
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

/** Initials circles: hsl(h 26% 23%) behind hsl(h 52% 82%), as in dark mode. */
export function avatarColors(hue: number): { fill: string; text: string } {
  return { fill: hsl(hue, 26, 23), text: hsl(hue, 52, 82) }
}
