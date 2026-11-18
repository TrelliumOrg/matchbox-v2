import { describe, expect, it } from "vitest"
import {
  baseSecurityHeaders,
  contentSecurityPolicy,
  createNonce,
  withSecurityHeaders,
} from "./security"

const options = {
  connect: ["https://rpc.test", "wss:"],
  images: ["https:"],
  frameAncestors: "'none'",
}

describe("security headers", () => {
  it("makes a fresh 16-byte nonce each time", () => {
    const a = createNonce()
    expect(atob(a)).toHaveLength(16)
    expect(createNonce()).not.toBe(a)
  })

  it("lets only nonced scripts run, never inline or eval", () => {
    const csp = contentSecurityPolicy("abc", options)
    const scripts = csp
      .split("; ")
      .find((directive) => directive.startsWith("script-src"))
    expect(scripts).toBe("script-src 'nonce-abc' 'strict-dynamic'")
    expect(csp).not.toContain("unsafe-eval")
    expect(scripts).not.toContain("unsafe-inline")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("connect-src 'self' https://rpc.test wss:")
    expect(csp).not.toContain("frame-src")
    expect(csp).toContain("font-src 'self';")
  })

  it("lists font sources when a page loads web fonts from elsewhere", () => {
    const csp = contentSecurityPolicy("abc", {
      ...options,
      fonts: ["https://fonts.reown.com"],
    })
    expect(csp).toContain("font-src 'self' https://fonts.reown.com;")
  })

  it("lists frame sources when a page embeds frames", () => {
    const csp = contentSecurityPolicy("abc", {
      ...options,
      frames: ["https://verify.walletconnect.org"],
    })
    expect(csp).toContain("frame-src 'self' https://verify.walletconnect.org")
  })

  it("adds every header to any response and keeps its status and body", async () => {
    const response = withSecurityHeaders(
      new Response("{}", {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
      "n1",
      options,
    )
    expect(response.status).toBe(404)
    expect(await response.text()).toBe("{}")
    for (const [name, value] of Object.entries(baseSecurityHeaders)) {
      expect(response.headers.get(name)).toBe(value)
    }
    expect(response.headers.get("content-security-policy")).toContain(
      "'nonce-n1'",
    )
    expect(response.headers.has("content-security-policy-report-only")).toBe(
      false,
    )
  })

  it("names where violations go only when asked", () => {
    expect(contentSecurityPolicy("abc", options)).not.toContain("report-")
    const response = withSecurityHeaders(new Response("<p>"), "n3", {
      ...options,
      reportPath: "/csp-report",
    })
    expect(response.headers.get("content-security-policy")).toMatch(
      /; report-uri \/csp-report$/,
    )
  })

  it("reports the policy without enforcing it, framing aside", () => {
    const response = withSecurityHeaders(new Response("<p>"), "n2", {
      ...options,
      frameAncestors: "'self' https://safe.example",
      reportOnly: true,
    })
    expect(response.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'self' https://safe.example",
    )
    expect(
      response.headers.get("content-security-policy-report-only"),
    ).toContain("script-src 'nonce-n2' 'strict-dynamic'")
  })
})
