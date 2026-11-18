/**
 * The build-time Worker URL, checked, and what a page's Content Security
 * Policy must allow for the widget. No React here: a server entry can
 * import it without pulling in the entry component.
 */

/** Turnstile's script, its Siteverify-facing iframe and its requests. */
export const turnstileOrigin = "https://challenges.cloudflare.com"

/** The Worker's origin from a build-time value; null hides the entry. */
export function feedbackEndpoint(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null
  try {
    const url = new URL(value.trim())
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1"
    return url.protocol === "https:" || (local && url.protocol === "http:")
      ? url.origin
      : null
  } catch {
    return null
  }
}

/**
 * Sources to add to `connect-src` and `frame-src`; both empty in a build
 * without the widget. Scripts need nothing extra under a nonce with
 * 'strict-dynamic'.
 */
export function feedbackCspSources(value: unknown): {
  connect: string[]
  frames: string[]
} {
  const endpoint = feedbackEndpoint(value)
  return endpoint === null
    ? { connect: [], frames: [] }
    : { connect: [endpoint, turnstileOrigin], frames: [turnstileOrigin] }
}
