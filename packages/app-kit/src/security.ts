/**
 * Security headers for a Matchbox frontend Worker, on every response it
 * returns (pages, server functions, redirects, errors, HEAD). Scripts run
 * only with this response's nonce, plus whatever those scripts load
 * ('strict-dynamic'): no 'unsafe-inline', no 'unsafe-eval'. Static assets
 * are served before the Worker runs, so they get the non-CSP headers from
 * the app's public/_headers.
 */

/** The request header that carries the nonce from the Worker to the router. */
export const nonceHeader = "x-matchbox-nonce"

/** 16 random bytes, base64: a fresh script nonce for one response. */
export function createNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export type CspOptions = {
  /** Origins pages may connect to beyond 'self' (RPCs, sockets). */
  connect: readonly string[]
  /** Origins images may come from beyond 'self' and data: (token icons). */
  images: readonly string[]
  /** Origins pages may frame beyond 'self' (WalletConnect's verify frame). */
  frames?: readonly string[]
  /** Origins fonts may come from beyond 'self' (WalletConnect's screen). */
  fonts?: readonly string[]
  /** Who may frame the page: "'none'" or a list of origins. */
  frameAncestors: string
  /**
   * Sends the policy as Content-Security-Policy-Report-Only: the browser
   * reports what it would block and blocks nothing. Browsers ignore
   * frame-ancestors in a report-only policy, so that one directive is
   * still enforced on its own.
   */
  reportOnly?: boolean
  /**
   * A same-origin path the browser posts violations to, as report-uri.
   * Not report-to: where both are named Chromium uses only report-to, whose
   * batched delivery could not be seen arriving in testing; report-uri
   * posts each violation at once in every browser. None by default.
   */
  reportPath?: string
}

/**
 * What the WalletConnect connector reaches: its relay (https and wss), the
 * connection screen's wallet list and config (api.web3modal.org, Reown),
 * and the verify frame it embeds. Matchbox ID allows the same set. On a
 * phone with no wallet installed this is the only way to connect, so a
 * missing host here leaves a blank connection screen.
 */
export const walletConnectSources: readonly string[] = [
  "https://*.walletconnect.com",
  "https://*.walletconnect.org",
  "wss://relay.walletconnect.com",
  "wss://relay.walletconnect.org",
  "wss://*.walletconnect.com",
  "wss://*.walletconnect.org",
  "https://*.web3modal.org",
  "https://*.web3modal.com",
  "https://*.reown.com",
  "wss://*.reown.com",
]

/**
 * The web fonts WalletConnect's connection screen loads. Without them it
 * draws in the browser's own font and every open logs a blocked font.
 */
export const walletConnectFonts: readonly string[] = ["https://fonts.reown.com"]

/** The frames WalletConnect embeds to verify the connecting site. */
export const walletConnectFrames: readonly string[] = [
  "https://verify.walletconnect.com",
  "https://verify.walletconnect.org",
  "https://secure.walletconnect.org",
  "https://secure.reown.com",
]

export function contentSecurityPolicy(
  nonce: string,
  options: CspOptions,
): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    // Inline style attributes (React style props, motion): styles cannot run
    // code, so this is the usual allowance.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${options.images.join(" ")}`.trim(),
    `font-src 'self' ${(options.fonts ?? []).join(" ")}`.trim(),
    `connect-src 'self' ${options.connect.join(" ")}`.trim(),
    ...(options.frames === undefined
      ? []
      : [`frame-src 'self' ${options.frames.join(" ")}`.trim()]),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors ${options.frameAncestors}`,
    ...(options.reportPath === undefined
      ? []
      : [`report-uri ${options.reportPath}`]),
  ].join("; ")
}

/** The headers every response carries, CSP aside. */
export const baseSecurityHeaders: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "cross-origin-opener-policy": "same-origin",
}

/**
 * The response with the security headers and this response's CSP. The body
 * streams through untouched.
 */
export function withSecurityHeaders(
  response: Response,
  nonce: string,
  options: CspOptions,
): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(baseSecurityHeaders)) {
    headers.set(name, value)
  }
  const policy = contentSecurityPolicy(nonce, options)
  if (options.reportOnly === true) {
    headers.set(
      "content-security-policy",
      `frame-ancestors ${options.frameAncestors}`,
    )
    headers.set("content-security-policy-report-only", policy)
  } else {
    headers.set("content-security-policy", policy)
    headers.delete("content-security-policy-report-only")
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
