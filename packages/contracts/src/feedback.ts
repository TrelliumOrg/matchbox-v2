import { z } from "zod"
import { addressInputSchema } from "./common"

/**
 * The wire contract between the feedback widget (@matchbox/feedback-ui) and
 * the matchbox-feedback Worker. A report is text plus the context the user
 * saw listed in the panel before sending; a screenshot, when the user asked
 * for one, follows in a second request. Nothing else personal is accepted:
 * every object is strict, so an unknown field is refused, not stored.
 */

export const feedbackPaths = {
  health: "/v1/health",
  config: "/v1/config",
  reports: "/v1/reports",
} as const

/** Where a report's screenshot is uploaded (PUT, the raw image). */
export function feedbackScreenshotPath(reportId: string): string {
  return `${feedbackPaths.reports}/${encodeURIComponent(reportId)}/screenshot`
}

export const feedbackLimits = {
  messageMin: 3,
  messageMax: 2_000,
  contactMax: 200,
  routeMax: 512,
  userAgentMax: 512,
  buildMax: 64,
  /** JSON report bodies; the message is the largest part. */
  reportBodyBytes: 16 * 1024,
  screenshotBytes: 5 * 1024 * 1024,
} as const

export const feedbackScreenshotTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const

export const feedbackScreenshotTypeSchema = z.enum(feedbackScreenshotTypes)

export type FeedbackScreenshotType = z.infer<
  typeof feedbackScreenshotTypeSchema
>

export const feedbackKindSchema = z.enum(["bug", "idea", "other"])

export type FeedbackKind = z.infer<typeof feedbackKindSchema>

/** The Matchbox v2 product a report came from. */
export const feedbackSurfaceSchema = z.enum([
  "pro",
  "scan",
  "docs",
  "id",
  "developer",
  "home",
])

export type FeedbackSurface = z.infer<typeof feedbackSurfaceSchema>

export const feedbackSurfaceNames: Record<FeedbackSurface, string> = {
  pro: "Matchbox Pro",
  scan: "Matchscan",
  docs: "Matchbox Docs",
  id: "Matchbox ID",
  developer: "Matchbox Developer",
  home: "Matchbox",
}

/** Wallets whose own in-app browser the page can recognise. */
export const walletBrowserSchema = z.enum([
  "okx",
  "metamask",
  "coinbase",
  "trust",
  "binance",
  "bitget",
  "phantom",
  "rabby",
  "imtoken",
  "tokenpocket",
])

export type WalletBrowser = z.infer<typeof walletBrowserSchema>

export const walletBrowserNames: Record<WalletBrowser, string> = {
  okx: "OKX Wallet",
  metamask: "MetaMask",
  coinbase: "Coinbase Wallet",
  trust: "Trust Wallet",
  binance: "Binance Wallet",
  bitget: "Bitget Wallet",
  phantom: "Phantom",
  rabby: "Rabby",
  imtoken: "imToken",
  tokenpocket: "TokenPocket",
}

/**
 * A page path only: it starts with a slash and carries no query string or
 * fragment (the widget drops both before the user sees the context).
 */
export const feedbackRouteSchema = z
  .string()
  .max(feedbackLimits.routeMax)
  .regex(/^\/[^?#\s]*$/, "Expected a path without query or fragment")

/** The context attached to every report, shown to the user before sending. */
export const feedbackContextSchema = z.strictObject({
  surface: feedbackSurfaceSchema,
  /** Null when the user removed the page from the report. */
  route: feedbackRouteSchema.nullable(),
  /** The build the page runs (a commit or the entry chunk's hash). */
  build: z.string().trim().min(1).max(feedbackLimits.buildMax).nullable(),
  viewport: z.strictObject({
    width: z.number().int().min(0).max(20_000),
    height: z.number().int().min(0).max(20_000),
  }),
  theme: z.strictObject({
    mode: z.enum(["light", "dark"]),
    /** The theme preset (`data-theme`), such as paper or onyx. */
    preset: z
      .string()
      .regex(/^[a-z0-9-]{1,32}$/)
      .nullable(),
  }),
  userAgent: z.string().max(feedbackLimits.userAgentMax),
  /** Set when the page runs inside a wallet's own browser. */
  walletBrowser: walletBrowserSchema.nullable(),
  /** The connected wallet's chain, when one is connected. */
  chainId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
})

export type FeedbackContext = z.infer<typeof feedbackContextSchema>

export const feedbackReportRequestSchema = z.strictObject({
  kind: feedbackKindSchema,
  message: z
    .string()
    .trim()
    .min(feedbackLimits.messageMin)
    .max(feedbackLimits.messageMax),
  context: feedbackContextSchema,
  /** Only when the user ticked "Include my wallet address". */
  wallet: addressInputSchema.nullable(),
  /** Optional free text: an email, Discord or Telegram handle. */
  contact: z.string().trim().min(1).max(feedbackLimits.contactMax).nullable(),
  /** True when a screenshot upload follows this report. */
  screenshot: z.boolean(),
  turnstileToken: z.string().min(1).max(2_048),
})

export type FeedbackReportRequest = z.input<typeof feedbackReportRequestSchema>

export type FeedbackReport = z.output<typeof feedbackReportRequestSchema>

/** What people quote back to the team, such as FB-7K3Q2M. */
export const feedbackReferenceSchema = z
  .string()
  .regex(/^FB-[0-9A-HJKMNP-TV-Z]{6}$/)

export const feedbackReportIdSchema = z.string().regex(/^[0-9a-f]{32}$/)

export const feedbackReportResponseSchema = z.strictObject({
  id: feedbackReportIdSchema,
  reference: feedbackReferenceSchema,
  /** Where and how to upload the screenshot; null when none was announced. */
  upload: z
    .strictObject({
      path: z.string().startsWith("/"),
      token: z.string().min(32).max(128),
    })
    .nullable(),
})

export type FeedbackReportResponse = z.infer<
  typeof feedbackReportResponseSchema
>

export const feedbackUploadResponseSchema = z.strictObject({
  ok: z.literal(true),
})

export const feedbackConfigResponseSchema = z.strictObject({
  /** Turnstile's public site key; null when the Worker has none. */
  turnstileSiteKey: z.string().min(1).nullable(),
})

export type FeedbackConfigResponse = z.infer<
  typeof feedbackConfigResponseSchema
>

export const feedbackHealthResponseSchema = z.strictObject({
  status: z.literal("ok"),
  service: z.literal("matchbox-feedback"),
  environment: z.string(),
  discord: z.enum(["configured", "off"]),
  turnstile: z.enum(["configured", "off"]),
})

export type FeedbackHealthResponse = z.infer<
  typeof feedbackHealthResponseSchema
>

export const feedbackErrorCodeSchema = z.enum([
  "invalid_request",
  "forbidden_origin",
  "unsupported_media_type",
  "payload_too_large",
  "rate_limited",
  "check_failed",
  "not_found",
  "upload_closed",
  "unavailable",
  "internal_error",
])

export type FeedbackErrorCode = z.infer<typeof feedbackErrorCodeSchema>

export const feedbackErrorSchema = z.strictObject({
  error: z.strictObject({
    code: feedbackErrorCodeSchema,
    message: z.string(),
    retryAfterSeconds: z.number().int().positive().nullable(),
  }),
})

export type FeedbackError = z.infer<typeof feedbackErrorSchema>

/**
 * A short browser line for the team, such as "Chrome 142 on macOS" or
 * "OKX Wallet in-app browser, Android". Good enough to triage, not a full
 * parser: an unknown agent reads "Unknown browser".
 */

function platformOf(userAgent: string): string | null {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "iOS"
  if (/Android/.test(userAgent)) return "Android"
  if (/Mac OS X|Macintosh/.test(userAgent)) return "macOS"
  if (/Windows/.test(userAgent)) return "Windows"
  if (/CrOS/.test(userAgent)) return "ChromeOS"
  if (/Linux/.test(userAgent)) return "Linux"
  return null
}

const browsers: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "Edge", pattern: /Edg(?:A|iOS)?\/(\d+)/ },
  { name: "Opera", pattern: /OPR\/(\d+)/ },
  { name: "Samsung Internet", pattern: /SamsungBrowser\/(\d+)/ },
  { name: "Firefox", pattern: /(?:Firefox|FxiOS)\/(\d+)/ },
  { name: "Chrome", pattern: /(?:Chrome|CriOS)\/(\d+)/ },
  { name: "Safari", pattern: /Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari/ },
]

export function describeFeedbackBrowser(
  userAgent: string,
  walletBrowser: WalletBrowser | null,
): string {
  const platform = platformOf(userAgent)
  if (walletBrowser !== null) {
    const name = `${walletBrowserNames[walletBrowser]} in-app browser`
    return platform === null ? name : `${name}, ${platform}`
  }
  for (const browser of browsers) {
    const version = browser.pattern.exec(userAgent)?.[1]
    if (version !== undefined) {
      const name = `${browser.name} ${version}`
      return platform === null ? name : `${name} on ${platform}`
    }
  }
  return platform === null
    ? "Unknown browser"
    : `Unknown browser on ${platform}`
}
