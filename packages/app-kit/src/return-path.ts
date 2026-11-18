import { isUuid } from "./ids"

/**
 * `?return=` values must be same-origin relative paths ("/authorize?..."),
 * never protocol-relative ("//evil"), backslash tricks or absolute URLs.
 * The check runs again on the normalised path: dot segments and their
 * encodings ("/.//evil", "/%2e%2e//evil", "/a/..//evil") collapse into a
 * protocol-relative "//evil", which a browser would follow off-site.
 * Lifted unchanged from Matchbox ID and Developer (apps/*\/src/app/lib).
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
  const base = "https://return.invalid"
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

export { isUuid }
