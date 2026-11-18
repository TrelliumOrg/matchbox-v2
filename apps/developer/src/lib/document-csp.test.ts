import { describe, expect, it } from "vitest"
import {
  createNonce,
  documentContentSecurityPolicy,
  documentSecurityHeaders,
} from "./document-csp"

describe("console document headers", () => {
  it("allows inline scripts only by nonce, plus the Google sign-in script", () => {
    const policy = documentContentSecurityPolicy("abc")
    expect(policy).toContain(
      "script-src 'self' 'nonce-abc' https://accounts.google.com/gsi/client",
    )
    expect(policy).not.toMatch(/script-src[^;]*unsafe/)
    expect(policy).toContain("frame-ancestors 'none'")
  })

  it("allows the feedback Worker and Turnstile only when built with them", () => {
    expect(documentContentSecurityPolicy("abc")).not.toContain("challenges")
    const policy = documentContentSecurityPolicy("abc", {
      connect: [
        "https://feedback.matchbox.markets",
        "https://challenges.cloudflare.com",
      ],
      frames: ["https://challenges.cloudflare.com"],
    })
    expect(policy).toContain(
      "connect-src 'self' https://accounts.google.com/gsi/ https://feedback.matchbox.markets https://challenges.cloudflare.com",
    )
    expect(policy).toContain(
      "frame-src https://accounts.google.com/gsi/ https://challenges.cloudflare.com",
    )
    expect(policy).toMatch(
      /script-src [^;]*https:\/\/challenges\.cloudflare\.com/,
    )
  })

  it("mints a fresh nonce and drops the CSP only in development", () => {
    expect(createNonce()).not.toBe(createNonce())
    expect(
      documentSecurityHeaders({ nonce: "n", development: false }),
    ).toHaveProperty("Content-Security-Policy")
    expect(
      documentSecurityHeaders({ nonce: "n", development: true }),
    ).not.toHaveProperty("Content-Security-Policy")
  })
})
