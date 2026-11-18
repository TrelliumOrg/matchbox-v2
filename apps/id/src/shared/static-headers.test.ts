import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/** The `/*` block of public/_headers, header name (lower case) to value. */
function staticHeaders(): Map<string, string> {
  const text = readFileSync(
    fileURLToPath(new URL("../../public/_headers", import.meta.url).href),
    "utf8",
  )
  const headers = new Map<string, string>()
  let inBlock = false
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || line.trim() === "") continue
    if (!line.startsWith(" ")) {
      inBlock = line.trim() === "/*"
      continue
    }
    if (!inBlock) continue
    const at = line.indexOf(":")
    headers.set(
      line.slice(0, at).trim().toLowerCase(),
      line.slice(at + 1).trim(),
    )
  }
  return headers
}

describe("static asset headers", () => {
  it("match what Classic ID's _headers sent on every file", () => {
    const headers = staticHeaders()
    expect(headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    )
    expect(headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    )
    expect(headers.get("strict-transport-security")).toBe(
      "max-age=63072000; includeSubDomains",
    )
    expect(headers.get("x-content-type-options")).toBe("nosniff")
    expect(headers.get("x-frame-options")).toBe("DENY")
    expect(headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    )
    expect(headers.get("cross-origin-opener-policy")).toBe(
      "same-origin-allow-popups",
    )
    expect(headers.get("permissions-policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    )
  })
})
