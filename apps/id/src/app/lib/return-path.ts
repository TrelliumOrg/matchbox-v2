/**
 * zod 4's UUID pattern (what `authorizationRequestIdSchema` checks on the
 * server), so the browser does not load zod for it.
 */
const uuidPattern =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/

/**
 * `?return=` values must be same-origin relative paths ("/authorize?..."),
 * never protocol-relative ("//evil"), backslash tricks or absolute URLs.
 * The check runs again on the normalised path: dot segments and their
 * encodings ("/.//evil", "/%2e%2e//evil", "/a/..//evil") collapse into a
 * protocol-relative "//evil", which a browser would follow off-site.
 */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return null
  }
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    // Browsers drop tabs and newlines from URLs ("/<tab>/evil" is "//evil").
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null
  }
  const base = "https://id.invalid"
  let url: URL
  try {
    url = new URL(value, base)
  } catch {
    return null
  }
  if (url.origin !== base) return null
  const path = `${url.pathname}${url.search}`
  if (path.startsWith("//") || path.startsWith("/\\")) return null
  return path
}

/** The request id when a return path is the consent page, else null. */
export function authorizationRequestIdOf(path: string | null): string | null {
  if (path === null) return null
  const url = new URL(path, "https://id.invalid")
  if (url.pathname !== "/authorize") return null
  const id = url.searchParams.get("request")
  return id !== null && uuidPattern.test(id) ? id : null
}
