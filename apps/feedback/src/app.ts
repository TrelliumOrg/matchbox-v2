import {
  type FeedbackConfigResponse,
  type FeedbackHealthResponse,
  type FeedbackReportResponse,
  type FeedbackScreenshotType,
  feedbackLimits,
  feedbackPaths,
  feedbackReportIdSchema,
  feedbackReportRequestSchema,
  feedbackScreenshotPath,
  feedbackScreenshotTypeSchema,
} from "@matchbox/contracts/feedback"
import type { RateLimitPolicy } from "@matchbox/contracts/rate-limits"
import { type Logger, logger as rootLogger } from "@matchbox/logger"
import {
  createDurableRateLimitClient,
  createMemoryRateLimitClient,
  ipPrefix,
  type RateLimitClient,
  sha256Hex,
  timingSafeEqualHex,
} from "@matchbox/server"
import { type Context, Hono } from "hono"
import { cors } from "hono/cors"
import { deliverReport, screenshotFileName } from "./deliver"
import {
  type FeedbackBindings,
  type FeedbackConfig,
  readFeedbackConfig,
} from "./env"
import {
  allowedOrigin,
  FeedbackHttpError,
  feedbackError,
  feedbackJson,
  readJsonBody,
  readLimitedBody,
  requireOrigin,
} from "./http"
import {
  newReference,
  newReportId,
  newScreenshotKey,
  newUploadToken,
} from "./ids"
import { insertReport, readReport, recordScreenshot } from "./store"
import { verifyTurnstile } from "./turnstile"

// matchbox-feedback: reports from the in-product feedback widget on the v2
// surfaces. POST /v1/reports stores a report (D1) and posts it to the team's
// Discord channel; PUT /v1/reports/:id/screenshot adds the screenshot the
// user chose to send (R2). Logs carry ids, kinds and outcomes only: never
// the message, contact, wallet, user agent or IP.

type FeedbackEnv = { Bindings: FeedbackBindings }

/** What the app needs from the outside world; tests swap each one. */
export type FeedbackAppDeps = {
  now: () => Date
  logger: Logger
  limiter: (env: FeedbackBindings) => RateLimitClient
  /** Turnstile Siteverify and the Discord API. */
  fetch: typeof globalThis.fetch
}

/**
 * Per IP prefix (IPv4 /24, IPv6 /48). The notes frame asks for 20 reports
 * per IP a day; the minute window stops a burst.
 */
export const FEEDBACK_LIMITS: Record<"report" | "upload", RateLimitPolicy> = {
  report: { perMinute: 3, perDay: 20 },
  upload: { perMinute: 5, perDay: 25 },
}

const referenceAttempts = 5

// Per-isolate fallback when the Durable Object is missing (local dev
// without bindings). Production always binds RATE_LIMITER.
const isolateLimiter = createMemoryRateLimitClient()

export const defaultDeps: FeedbackAppDeps = {
  now: () => new Date(),
  logger: rootLogger.child({ service: "matchbox-feedback" }),
  limiter: (env) =>
    env.RATE_LIMITER
      ? createDurableRateLimitClient(env.RATE_LIMITER)
      : isolateLimiter,
  fetch: (input, init) => globalThis.fetch(input, init),
}

async function checkLimit(input: {
  client: RateLimitClient
  route: "report" | "upload"
  request: Request
}): Promise<void> {
  const prefix = ipPrefix(input.request) ?? "unknown"
  const result = await input.client.consume(
    `feedback:${input.route}:ip:${prefix}`,
    FEEDBACK_LIMITS[input.route],
  )
  if (!result.allowed) {
    throw new FeedbackHttpError(
      429,
      "rate_limited",
      "Too many reports.",
      Math.max(1, result.retryAfterSeconds),
    )
  }
}

/** The leading bytes each accepted image type starts with. */
function matchesType(bytes: Uint8Array, type: FeedbackScreenshotType): boolean {
  const starts = (...prefix: number[]): boolean =>
    prefix.every((byte, index) => bytes[index] === byte)
  switch (type) {
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff)
    case "image/webp":
      return (
        starts(0x52, 0x49, 0x46, 0x46) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      )
  }
}

function bearerToken(request: Request): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(
    request.headers.get("authorization") ?? "",
  )
  return match?.[1] ?? null
}

function notFound(): FeedbackHttpError {
  return new FeedbackHttpError(404, "not_found", "Not found.")
}

export function createFeedbackApp(
  deps: FeedbackAppDeps = defaultDeps,
): Hono<FeedbackEnv> {
  const app = new Hono<FeedbackEnv>()
  const configs = new WeakMap<object, FeedbackConfig>()

  function configOf(c: Context<FeedbackEnv>): FeedbackConfig {
    const cached = configs.get(c.env)
    if (cached !== undefined) return cached
    const config = readFeedbackConfig(c.env)
    configs.set(c.env, config)
    return config
  }

  app.use("*", async (c, next) => {
    const config = configOf(c)
    const handler = cors({
      origin: (origin) =>
        config.allowedOrigins.includes(origin) ? origin : null,
      allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
      allowHeaders: ["content-type", "authorization"],
      maxAge: 600,
    })
    return handler(c, next)
  })

  app.get(feedbackPaths.health, (c) => {
    const config = configOf(c)
    const body: FeedbackHealthResponse = {
      status: "ok",
      service: "matchbox-feedback",
      environment: config.environment,
      discord: config.discord === null ? "off" : "configured",
      turnstile: config.turnstile === null ? "off" : "configured",
    }
    return feedbackJson(body)
  })

  app.get(feedbackPaths.config, (c) => {
    const config = configOf(c)
    if (allowedOrigin(c.req.raw, config.allowedOrigins) === null) {
      throw new FeedbackHttpError(
        403,
        "forbidden_origin",
        "Origin not allowed.",
      )
    }
    const body: FeedbackConfigResponse = {
      turnstileSiteKey: config.turnstile?.siteKey ?? null,
    }
    return feedbackJson(body)
  })

  app.post(feedbackPaths.reports, async (c) => {
    const config = configOf(c)
    const origin = requireOrigin(c.req.raw, config.allowedOrigins)
    const parsed = feedbackReportRequestSchema.safeParse(
      await readJsonBody(c.req.raw, feedbackLimits.reportBodyBytes),
    )
    if (!parsed.success) {
      deps.logger.info({
        message: "feedback.report.invalid",
        fields: parsed.error.issues
          .slice(0, 5)
          .map((issue) => issue.path.join(".")),
      })
      throw new FeedbackHttpError(
        400,
        "invalid_request",
        "The report does not match the contract.",
      )
    }
    if (config.turnstile === null) {
      throw new FeedbackHttpError(
        503,
        "unavailable",
        "Feedback is not available.",
      )
    }
    await checkLimit({
      client: deps.limiter(c.env),
      route: "report",
      request: c.req.raw,
    })
    const report = parsed.data
    const id = newReportId()
    const check = await verifyTurnstile({
      token: report.turnstileToken,
      secretKey: config.turnstile.secretKey,
      fetch: deps.fetch,
      idempotencyKey: crypto.randomUUID(),
    })
    if (check.result === "unavailable") {
      throw new FeedbackHttpError(
        503,
        "unavailable",
        "The check could not run.",
      )
    }
    if (check.result === "failed") {
      deps.logger.info({
        message: "feedback.report.check_failed",
        codes: check.codes.slice(0, 5),
      })
      throw new FeedbackHttpError(403, "check_failed", "Check did not pass.")
    }
    const uploadToken = report.screenshot ? newUploadToken() : null
    const createdAt = deps.now().toISOString()
    let reference: string | null = null
    for (let attempt = 0; attempt < referenceAttempts; attempt += 1) {
      const candidate = newReference()
      const inserted = await insertReport(c.env.FEEDBACK_DB, {
        id,
        reference: candidate,
        createdAt,
        origin,
        report,
        uploadTokenHash:
          uploadToken === null ? null : await sha256Hex(uploadToken),
      })
      if (inserted) {
        reference = candidate
        break
      }
    }
    if (reference === null) {
      throw new Error("No free report reference after retries")
    }
    deps.logger.info({
      message: "feedback.report.stored",
      reportId: id,
      reference,
      kind: report.kind,
      surface: report.context.surface,
      withScreenshot: report.screenshot,
      withWallet: report.wallet !== null,
      withContact: report.contact !== null,
    })
    if (!report.screenshot) {
      const stored = await readReport(c.env.FEEDBACK_DB, id)
      if (stored !== null) {
        c.executionCtx.waitUntil(
          deliverReport({
            db: c.env.FEEDBACK_DB,
            config,
            fetch: deps.fetch,
            logger: deps.logger,
            report: stored,
            screenshot: null,
          }),
        )
      }
    }
    const body: FeedbackReportResponse = {
      id,
      reference,
      upload:
        uploadToken === null
          ? null
          : { path: feedbackScreenshotPath(id), token: uploadToken },
    }
    return feedbackJson(body, 201)
  })

  app.put(`${feedbackPaths.reports}/:id/screenshot`, async (c) => {
    const config = configOf(c)
    requireOrigin(c.req.raw, config.allowedOrigins)
    const id = feedbackReportIdSchema.safeParse(c.req.param("id"))
    if (!id.success) throw notFound()
    const type = feedbackScreenshotTypeSchema.safeParse(
      (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase(),
    )
    if (!type.success) {
      throw new FeedbackHttpError(
        415,
        "unsupported_media_type",
        "Send a PNG, JPEG or WebP image.",
      )
    }
    const token = bearerToken(c.req.raw)
    if (token === null) throw notFound()
    await checkLimit({
      client: deps.limiter(c.env),
      route: "upload",
      request: c.req.raw,
    })
    const report = await readReport(c.env.FEEDBACK_DB, id.data)
    if (report === null) throw notFound()
    if (
      report.screenshot_status !== "pending" ||
      report.upload_token_hash === null
    ) {
      throw new FeedbackHttpError(409, "upload_closed", "Upload is closed.")
    }
    if (!timingSafeEqualHex(await sha256Hex(token), report.upload_token_hash)) {
      throw notFound()
    }
    const bytes = await readLimitedBody(
      c.req.raw,
      feedbackLimits.screenshotBytes,
    )
    if (bytes.byteLength === 0 || !matchesType(bytes, type.data)) {
      throw new FeedbackHttpError(
        415,
        "unsupported_media_type",
        "The image does not match its type.",
      )
    }
    const key = newScreenshotKey(type.data)
    await c.env.SCREENSHOTS.put(key, bytes, {
      httpMetadata: { contentType: type.data },
    })
    const recorded = await recordScreenshot(c.env.FEEDBACK_DB, {
      id: id.data,
      key,
      type: type.data,
      bytes: bytes.byteLength,
      storedAt: deps.now().toISOString(),
    })
    if (!recorded) {
      await c.env.SCREENSHOTS.delete(key)
      throw new FeedbackHttpError(409, "upload_closed", "Upload is closed.")
    }
    deps.logger.info({
      message: "feedback.screenshot.stored",
      reportId: id.data,
      type: type.data,
      bytes: bytes.byteLength,
    })
    const stored = await readReport(c.env.FEEDBACK_DB, id.data)
    if (stored !== null && stored.discord_status === "waiting") {
      c.executionCtx.waitUntil(
        deliverReport({
          db: c.env.FEEDBACK_DB,
          config,
          fetch: deps.fetch,
          logger: deps.logger,
          report: stored,
          screenshot: {
            bytes,
            type: type.data,
            fileName: screenshotFileName(type.data),
          },
        }),
      )
    }
    return feedbackJson({ ok: true })
  })

  app.notFound(() => feedbackError(notFound()))

  app.onError((error) => {
    if (error instanceof FeedbackHttpError) {
      if (error.status >= 500) {
        deps.logger.warn({ message: "feedback.unavailable", code: error.code })
      }
      return feedbackError(error)
    }
    deps.logger.error({
      message: "feedback.error",
      error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    })
    return feedbackError(
      new FeedbackHttpError(500, "internal_error", "Something went wrong."),
    )
  })

  return app
}
