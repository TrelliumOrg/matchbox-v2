/**
 * Content-Security-Policy and security headers for Matchbox ID pages.
 *
 * The SPA this replaces was served from ASSETS with a generated `_headers`
 * file that allowed its two fixed inline boot scripts by hash. Server
 * rendered pages carry per-request inline scripts (the theme script and
 * TanStack Start's hydration data), so scripts are now allowed by a nonce
 * minted for each response. Every other directive and header is unchanged:
 * connections cover the Mezo RPCs and the WalletConnect endpoints the wallet
 * stack uses, framing is refused and /authorize sends no Referer.
 */

import {
  walletConnectFrames,
  walletConnectSources,
} from "@matchbox/app-kit/security"
import { feedbackCspSources } from "@matchbox/feedback-ui/csp"

const connectSources = [
  "'self'",
  "https://rpc-internal.mezo.org",
  "https://rpc.test.mezo.org",
  "https://*.mezo.org",
  "https://cloudflare-eth.com",
  // Shared with Matchscan, so both connection screens load the same hosts.
  ...walletConnectSources,
  "https://*.coinbase.com",
  "wss://www.walletlink.org",
]

const frameSources = walletConnectFrames

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
  return [
    "default-src 'self'",
    // Turnstile's script is named: this policy has no 'strict-dynamic'.
    [`script-src 'self' 'nonce-${nonce}'`, ...feedback.frames].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${[...connectSources, ...feedback.connect].join(" ")}`,
    `frame-src ${[...frameSources, ...feedback.frames].join(" ")}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ")
}

const baseHeaders = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
} as const

/**
 * Headers for a page. The CSP is left out in development only, where Vite
 * injects its own inline scripts; /authorize never leaks its query (the
 * request id) through Referer.
 */
export function documentSecurityHeaders(input: {
  pathname: string
  nonce: string
  development: boolean
}): Record<string, string> {
  const headers: Record<string, string> = { ...baseHeaders }
  if (!input.development) {
    headers["Content-Security-Policy"] = documentContentSecurityPolicy(
      input.nonce,
    )
  }
  if (input.pathname === "/authorize")
    headers["Referrer-Policy"] = "no-referrer"
  return headers
}
