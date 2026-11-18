/**
 * Logos for end-to-end tests on the memory store, where the local Worker
 * cannot reach a real HTTPS host. Only `logos.example.com` (a domain
 * reserved for documentation) is answered here, and only when the Worker
 * runs with dev sign-in (memory store, outside production); every other
 * URL, and every URL in production, goes to the real fetch.
 */
export const devLogoHost = "logos.example.com"

/** `LogoFetch` in logo-pin.ts (kept apart so the e2e tests can import this). */
type Fetcher = (url: string, init: RequestInit) => Promise<Response>

/** A valid 1x1 PNG. */
const pixel = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (char) => char.charCodeAt(0),
)

/** The bytes served for a fixture URL: the pixel, then its path and query. */
export function devLogoBytes(url: URL): Uint8Array<ArrayBuffer> {
  const tail = new TextEncoder().encode(`${url.pathname}${url.search}`)
  const bytes = new Uint8Array(pixel.length + tail.length)
  bytes.set(pixel)
  bytes.set(tail, pixel.length)
  return bytes
}

export function devLogoFetch(fallback: Fetcher): Fetcher {
  return async (url, init) => {
    const parsed = new URL(url)
    if (parsed.hostname !== devLogoHost) return fallback(url, init)
    return new Response(devLogoBytes(parsed), {
      headers: { "content-type": "image/png" },
    })
  }
}
