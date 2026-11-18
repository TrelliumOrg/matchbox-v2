/**
 * Content-Security-Policy and security headers for console pages.
 *
 * The SPA this replaces got them from `withDocumentHeaders`
 * (worker/security.ts), which allowed its one fixed inline script, the theme
 * script, by hash. Server rendered pages carry per-request inline scripts
 * (the theme script and TanStack Start's hydration data), so scripts are now
 * allowed by a nonce minted for every response. Every other directive and
 * header is the same, including Google Identity Services for the sign-in
 * and step-up buttons.
 */

import { feedbackCspSources } from "@matchbox/feedback-ui/csp"

const googleIdentityOrigin = "https://accounts.google.com"

/** The feedback Worker and Turnstile; empty in a build without them. */
const feedbackSources = feedbackCspSources(import.meta.env.VITE_FEEDBACK_URL)

/** 128 random bits, base64: a fresh value for every document. */
export function createNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function documentContentSecurityPolicy(
  nonce: string,
  feedback: { connect: string[]; frames: string[] } = feedbackSources,
): string {
  // Turnstile's script is named: this policy has no 'strict-dynamic'.
  const turnstile = feedback.frames.map((origin) => ` ${origin}`).join("")
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${googleIdentityOrigin}/gsi/client${turnstile}`,
    `style-src 'self' 'unsafe-inline' ${googleIdentityOrigin}/gsi/style`,
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${googleIdentityOrigin}/gsi/ ${feedback.connect.join(" ")}`.trim(),
    `frame-src ${googleIdentityOrigin}/gsi/${turnstile}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ")
}

const headers = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Permissions-Policy": `camera=(), microphone=(), geolocation=(), publickey-credentials-get=(), publickey-credentials-create=(), identity-credentials-get=(self "${googleIdentityOrigin}")`,
} as const

/** Headers for a page; the CSP is left out in development (Vite's inline scripts). */
export function documentSecurityHeaders(input: {
  nonce: string
  development: boolean
}): Record<string, string> {
  return input.development
    ? { ...headers }
    : {
        ...headers,
        "Content-Security-Policy": documentContentSecurityPolicy(input.nonce),
      }
}
