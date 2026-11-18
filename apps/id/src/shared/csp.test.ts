import { describe, expect, it } from "vitest"
import {
  createNonce,
  documentContentSecurityPolicy,
  documentSecurityHeaders,
} from "./csp"

describe("document security headers", () => {
  it("allows inline scripts only by this response's nonce", () => {
    const policy = documentContentSecurityPolicy("abc123")
    expect(policy).toContain("script-src 'self' 'nonce-abc123'")
    expect(policy).not.toMatch(/script-src[^;]*unsafe/)
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).toContain("base-uri 'none'")
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("form-action 'self'")
  })

  it("allows the feedback Worker and Turnstile only when built with them", () => {
    expect(documentContentSecurityPolicy("n")).not.toContain("challenges")
    const policy = documentContentSecurityPolicy("n", {
      connect: [
        "https://feedback.matchbox.markets",
        "https://challenges.cloudflare.com",
      ],
      frames: ["https://challenges.cloudflare.com"],
    })
    expect(policy).toContain(
      "script-src 'self' 'nonce-n' https://challenges.cloudflare.com;",
    )
    expect(policy).toMatch(
      /connect-src [^;]*https:\/\/feedback\.matchbox\.markets https:\/\/challenges\.cloudflare\.com;/,
    )
    expect(policy).toMatch(
      /frame-src [^;]*https:\/\/challenges\.cloudflare\.com;/,
    )
  })

  it("mints a different 128-bit nonce for every document", () => {
    const first = createNonce()
    const second = createNonce()
    expect(first).not.toBe(second)
    expect(atob(first)).toHaveLength(16)
  })

  it("keeps the request id out of Referer on /authorize", () => {
    const authorize = documentSecurityHeaders({
      pathname: "/authorize",
      nonce: "n",
      development: false,
    })
    expect(authorize["Referrer-Policy"]).toBe("no-referrer")
    expect(authorize["X-Frame-Options"]).toBe("DENY")
    const account = documentSecurityHeaders({
      pathname: "/",
      nonce: "n",
      development: false,
    })
    expect(account["Referrer-Policy"]).toBe("strict-origin-when-cross-origin")
  })

  it("leaves the CSP out only in development", () => {
    expect(
      documentSecurityHeaders({ pathname: "/", nonce: "n", development: true }),
    ).not.toHaveProperty("Content-Security-Policy")
    expect(
      documentSecurityHeaders({
        pathname: "/",
        nonce: "n",
        development: false,
      }),
    ).toHaveProperty("Content-Security-Policy")
  })
})
