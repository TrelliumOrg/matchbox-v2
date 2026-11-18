import {
  type FeedbackReport,
  type FeedbackScreenshotType,
  feedbackKindSchema,
  feedbackScreenshotTypeSchema,
  feedbackSurfaceSchema,
  walletBrowserSchema,
} from "@matchbox/contracts/feedback"
import { z } from "zod"

// The feedback_reports table (migrations/0001_feedback_reports.sql). Rows
// are read back through zod, never cast.

export const screenshotStatusSchema = z.enum([
  "none",
  "pending",
  "stored",
  "expired",
])

export const discordStatusSchema = z.enum([
  "waiting",
  "posted",
  "skipped",
  "failed",
])

export type DiscordStatus = z.infer<typeof discordStatusSchema>

const storedReportSchema = z.object({
  id: z.string(),
  reference: z.string(),
  created_at: z.string(),
  kind: feedbackKindSchema,
  message: z.string(),
  origin: z.string(),
  surface: feedbackSurfaceSchema,
  route: z.string().nullable(),
  build: z.string().nullable(),
  viewport_width: z.number(),
  viewport_height: z.number(),
  theme_mode: z.enum(["light", "dark"]),
  theme_preset: z.string().nullable(),
  user_agent: z.string(),
  wallet_browser: walletBrowserSchema.nullable(),
  chain_id: z.number().nullable(),
  wallet: z.string().nullable(),
  contact: z.string().nullable(),
  screenshot_status: screenshotStatusSchema,
  screenshot_key: z.string().nullable(),
  screenshot_type: feedbackScreenshotTypeSchema.nullable(),
  screenshot_bytes: z.number().nullable(),
  screenshot_stored_at: z.string().nullable(),
  upload_token_hash: z.string().nullable(),
  discord_status: discordStatusSchema,
  discord_message_id: z.string().nullable(),
  discord_attempts: z.number(),
})

export type StoredReport = z.infer<typeof storedReportSchema>

export type NewReport = {
  id: string
  reference: string
  createdAt: string
  origin: string
  report: FeedbackReport
  uploadTokenHash: string | null
}

/**
 * Inserts the report. Returns false when the reference was taken (the
 * caller draws a new one); any other failure throws.
 */
export async function insertReport(
  db: D1Database,
  input: NewReport,
): Promise<boolean> {
  const { report } = input
  const { context } = report
  try {
    await db
      .prepare(
        `INSERT INTO feedback_reports (
          id, reference, created_at, kind, message, origin, surface, route,
          build, viewport_width, viewport_height, theme_mode, theme_preset,
          user_agent, wallet_browser, chain_id, wallet, contact,
          screenshot_status, upload_token_hash, discord_status
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
          ?15, ?16, ?17, ?18, ?19, ?20, ?21)`,
      )
      .bind(
        input.id,
        input.reference,
        input.createdAt,
        report.kind,
        report.message,
        input.origin,
        context.surface,
        context.route,
        context.build,
        context.viewport.width,
        context.viewport.height,
        context.theme.mode,
        context.theme.preset,
        context.userAgent,
        context.walletBrowser,
        context.chainId,
        report.wallet,
        report.contact,
        report.screenshot ? "pending" : "none",
        input.uploadTokenHash,
        "waiting",
      )
      .run()
    return true
  } catch (error) {
    if (
      error instanceof Error &&
      /UNIQUE constraint failed: feedback_reports\.reference/.test(
        error.message,
      )
    ) {
      return false
    }
    throw error
  }
}

export async function readReport(
  db: D1Database,
  id: string,
): Promise<StoredReport | null> {
  const row = await db
    .prepare("SELECT * FROM feedback_reports WHERE id = ?1")
    .bind(id)
    .first()
  return row === null ? null : storedReportSchema.parse(row)
}

/**
 * Records the stored screenshot and closes the upload, only while it is
 * still pending: two uploads racing with the same token store one.
 */
export async function recordScreenshot(
  db: D1Database,
  input: {
    id: string
    key: string
    type: FeedbackScreenshotType
    bytes: number
    storedAt: string
  },
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE feedback_reports
        SET screenshot_status = 'stored', screenshot_key = ?2,
          screenshot_type = ?3, screenshot_bytes = ?4,
          screenshot_stored_at = ?5, upload_token_hash = NULL
        WHERE id = ?1 AND screenshot_status = 'pending'`,
    )
    .bind(input.id, input.key, input.type, input.bytes, input.storedAt)
    .run()
  return result.meta.changes === 1
}

/** Records how the Discord post went, counting the attempt. */
export async function recordDiscord(
  db: D1Database,
  id: string,
  outcome:
    | { status: "posted"; messageId: string }
    | { status: "skipped" }
    | { status: "failed" },
): Promise<void> {
  await db
    .prepare(
      `UPDATE feedback_reports
        SET discord_status = ?2, discord_message_id = ?3,
          discord_attempts = discord_attempts + ?4
        WHERE id = ?1`,
    )
    .bind(
      id,
      outcome.status,
      outcome.status === "posted" ? outcome.messageId : null,
      outcome.status === "skipped" ? 0 : 1,
    )
    .run()
}

/**
 * Screenshots announced but not uploaded by `before`: the upload closes,
 * and the sweep then posts the report without one.
 */
export async function closeStaleUploads(
  db: D1Database,
  before: string,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE feedback_reports
        SET screenshot_status = 'none', upload_token_hash = NULL
        WHERE screenshot_status = 'pending' AND created_at < ?1`,
    )
    .bind(before)
    .run()
  return result.meta.changes
}

/**
 * Reports created before `before` whose Discord post is still owed: never
 * made (the request's own post did not finish) or failed, and no longer
 * waiting for a screenshot.
 */
export async function reportsToPost(
  db: D1Database,
  input: { before: string; maxAttempts: number; limit: number },
): Promise<StoredReport[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM feedback_reports
        WHERE discord_status IN ('waiting', 'failed')
          AND screenshot_status != 'pending'
          AND discord_attempts < ?1 AND created_at < ?2
        ORDER BY created_at LIMIT ?3`,
    )
    .bind(input.maxAttempts, input.before, input.limit)
    .all()
  return results.map((row) => storedReportSchema.parse(row))
}

/** Stored screenshots taken before `before` (90 days ago). */
export async function screenshotsToExpire(
  db: D1Database,
  before: string,
  limit: number,
): Promise<Array<{ id: string; key: string }>> {
  const { results } = await db
    .prepare(
      `SELECT id, screenshot_key AS key FROM feedback_reports
        WHERE screenshot_status = 'stored' AND screenshot_stored_at < ?1
        ORDER BY screenshot_stored_at LIMIT ?2`,
    )
    .bind(before, limit)
    .all()
  return results.map((row) =>
    z.object({ id: z.string(), key: z.string() }).parse(row),
  )
}

/** Forgets an expired screenshot's key: the row keeps only "expired". */
export async function markScreenshotExpired(
  db: D1Database,
  id: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE feedback_reports
        SET screenshot_status = 'expired', screenshot_key = NULL,
          screenshot_type = NULL, screenshot_bytes = NULL
        WHERE id = ?1`,
    )
    .bind(id)
    .run()
}
