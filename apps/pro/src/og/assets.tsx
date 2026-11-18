import btc from "@matchbox/token-icons/icons/btc.svg?raw"
import mezo from "@matchbox/token-icons/icons/mezo.svg?raw"
import musd from "@matchbox/token-icons/icons/musd.svg?raw"
import solvbtc from "@matchbox/token-icons/icons/solvbtc.svg?raw"
import usdc from "@matchbox/token-icons/icons/usdc.svg?raw"
import usdt from "@matchbox/token-icons/icons/usdt.svg?raw"
import xsolvbtc from "@matchbox/token-icons/icons/xsolvbtc.svg?raw"
import { Glyph, type GlyphShape } from "@matchbox/ui/icons"
import { Root as Lockup } from "@matchbox/ui/lockup"
import { renderToStaticMarkup } from "react-dom/server"
import { ink, sec } from "./palette"

/**
 * Everything a card draws that is not text: the lockup from its outlined
 * paths (never Martian Mono), Lucide glyphs, Mezo's official coins and the
 * gauge's profile picture, all inlined as data URIs so the renderer never
 * fetches.
 */

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return btoa(binary)
}

export function svgUri(svg: string): string {
  return `data:image/svg+xml;base64,${toBase64(new TextEncoder().encode(svg))}`
}

/** A data URI's bytes (Vite's `?inline` fonts). */
export function dataUriBytes(uri: string): ArrayBuffer {
  const binary = atob(uri.slice(uri.indexOf(",") + 1))
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at += 1) {
    bytes[at] = binary.charCodeAt(at)
  }
  return bytes.buffer
}

const lockupHeight = 34

let lockup: { uri: string; width: number; height: number } | null = null

/** MATCHBOX PRO, ink with the product name in secondary, at 34px. */
export function lockupImage(): { uri: string; width: number; height: number } {
  if (lockup !== null) return lockup
  const markup = renderToStaticMarkup(
    <Lockup
      product="pro"
      height={lockupHeight}
      fill={ink}
      xmlns="http://www.w3.org/2000/svg"
    />,
  )
    .replaceAll("var(--sec)", sec)
    .replace(/ style="[^"]*"/, "")
  const width = Number(/ width="([\d.]+)"/.exec(markup)?.[1] ?? 0)
  lockup = { uri: svgUri(markup), width, height: lockupHeight }
  return lockup
}

/** A Lucide glyph from `@matchbox/ui/icons` in one colour. */
export function glyphUri(
  shape: GlyphShape,
  color: string,
  strokeWidth = 1.8,
): string {
  return svgUri(
    renderToStaticMarkup(
      <Glyph
        shape={shape}
        size={24}
        strokeWidth={strokeWidth}
        stroke={color}
        xmlns="http://www.w3.org/2000/svg"
      />,
    ),
  )
}

const coins: Record<string, string> = {
  btc,
  mezo,
  musd,
  musdc: usdc,
  musdt: usdt,
  solvbtc,
  xsolvbtc,
}

const coinUris = new Map<string, string>()

/** Mezo's coin for a ticker ("MEZO", "mUSDC"), or null for unknown tokens. */
export function coinUri(ticker: string): string | null {
  const key = ticker.toLowerCase()
  const cached = coinUris.get(key)
  if (cached !== undefined) return cached
  const svg = coins[key]
  if (svg === undefined) return null
  const uri = svgUri(svg)
  coinUris.set(key, uri)
  return uri
}

/** Formats resvg decodes. WebP and AVIF pictures fall back to initials. */
const pictureTypes = ["image/png", "image/jpeg", "image/gif"] as const

const maxPictureBytes = 1_500_000

export type PictureFetch = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<Response>

/**
 * A gauge's profile picture as a data URI, or null when it is slow (over
 * `timeoutMs`), large, missing or in a format the renderer cannot draw.
 * The card then shows initials: a picture never fails an image.
 */
export async function fetchPicture(
  url: string,
  fetcher: PictureFetch,
  timeoutMs = 1500,
): Promise<string | null> {
  try {
    if (!url.startsWith("https://")) return null
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return null
    const type = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase()
    const known = pictureTypes.find((entry) => entry === type)
    if (known === undefined) return null
    const declared = Number(response.headers.get("content-length") ?? 0)
    if (declared > maxPictureBytes) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > maxPictureBytes) return null
    return `data:${known};base64,${toBase64(bytes)}`
  } catch {
    return null
  }
}
