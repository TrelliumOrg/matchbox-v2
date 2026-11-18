import {
  type FeedbackReportRequest,
  feedbackConfigResponseSchema,
  feedbackErrorSchema,
  feedbackPaths,
  feedbackReportResponseSchema,
  feedbackScreenshotTypeSchema,
} from "@matchbox/contracts/feedback"
import type { SendOutcome } from "./machine"

/**
 * Talks to the matchbox-feedback Worker. No cookies and no Referer: the
 * Worker sees the page's origin (CORS) and what the report says, nothing
 * else, so a query string in the page's URL never reaches it.
 */

const requestDefaults: RequestInit = {
  credentials: "omit",
  mode: "cors",
  referrerPolicy: "no-referrer",
}

/** Turnstile's site key, or null when the Worker cannot take reports. */
export async function fetchSiteKey(
  endpoint: string,
  fetch: typeof globalThis.fetch,
): Promise<string | null> {
  try {
    const response = await fetch(`${endpoint}${feedbackPaths.config}`, {
      ...requestDefaults,
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return null
    const parsed = feedbackConfigResponseSchema.safeParse(await response.json())
    return parsed.success ? parsed.data.turnstileSiteKey : null
  } catch {
    return null
  }
}

async function failure(response: Response): Promise<SendOutcome> {
  const parsed = feedbackErrorSchema.safeParse(
    await response.json().catch(() => null),
  )
  if (!parsed.success) return { result: "failed" }
  const { code, retryAfterSeconds } = parsed.data.error
  if (code === "rate_limited") {
    return {
      result: "rate-limited",
      retryAfterSeconds: retryAfterSeconds ?? 60,
    }
  }
  if (code === "check_failed") return { result: "check-failed" }
  return { result: "failed" }
}

/**
 * Sends the report, then its screenshot. The report is what matters: once
 * it is stored the user sees "Report sent" even if the screenshot upload
 * fails (the Worker then posts the report without it).
 */
export async function sendReport(input: {
  endpoint: string
  report: FeedbackReportRequest
  screenshot: Blob | null
  fetch: typeof globalThis.fetch
}): Promise<SendOutcome> {
  let response: Response
  try {
    response = await input.fetch(`${input.endpoint}${feedbackPaths.reports}`, {
      ...requestDefaults,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input.report),
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    return { result: "failed" }
  }
  if (!response.ok) return failure(response)
  const created = feedbackReportResponseSchema.safeParse(
    await response.json().catch(() => null),
  )
  if (!created.success) return { result: "failed" }
  const { reference, upload } = created.data
  if (upload !== null && input.screenshot !== null) {
    const type = feedbackScreenshotTypeSchema.safeParse(input.screenshot.type)
    if (type.success) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const uploaded = await input
          .fetch(`${input.endpoint}${upload.path}`, {
            ...requestDefaults,
            method: "PUT",
            headers: {
              "content-type": type.data,
              authorization: `Bearer ${upload.token}`,
            },
            body: input.screenshot,
            signal: AbortSignal.timeout(60_000),
          })
          .then((result) => result.ok || result.status < 500)
          .catch(() => false)
        if (uploaded) break
      }
    }
  }
  return { result: "sent", reference }
}
