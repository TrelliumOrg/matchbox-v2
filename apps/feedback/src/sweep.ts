import type { FeedbackAppDeps } from "./app"
import { deliverReport, loadScreenshot } from "./deliver"
import { type FeedbackBindings, readFeedbackConfig } from "./env"
import {
  closeStaleUploads,
  markScreenshotExpired,
  reportsToPost,
  screenshotsToExpire,
} from "./store"

/**
 * The cron (every 15 minutes, wrangler.jsonc):
 *
 * 1. Closes screenshot uploads not made within 10 minutes, so the report
 *    is posted without one.
 * 2. Posts reports still owed to Discord: the request's own post did not
 *    finish, or failed (up to 5 attempts).
 * 3. Expires screenshots older than 90 days: deletes the object (the R2
 *    lifecycle rule does too) and keeps only "expired" on the row.
 */

const minuteMs = 60_000
export const uploadWindowMs = 10 * minuteMs
/** Leaves the request's own post time to finish before retrying it. */
const postGraceMs = 2 * minuteMs
export const screenshotRetentionMs = 90 * 24 * 60 * minuteMs
const maxAttempts = 5
const batch = 25

export type SweepSummary = {
  uploadsClosed: number
  posted: number
  expired: number
}

export async function runSweep(
  env: FeedbackBindings,
  deps: FeedbackAppDeps,
): Promise<SweepSummary> {
  const config = readFeedbackConfig(env)
  const now = deps.now().getTime()
  const db = env.FEEDBACK_DB
  const uploadsClosed = await closeStaleUploads(
    db,
    new Date(now - uploadWindowMs).toISOString(),
  )
  const owed = await reportsToPost(db, {
    before: new Date(now - postGraceMs).toISOString(),
    maxAttempts,
    limit: batch,
  })
  for (const report of owed) {
    await deliverReport({
      db,
      config,
      fetch: deps.fetch,
      logger: deps.logger,
      report,
      screenshot: await loadScreenshot(env.SCREENSHOTS, report).catch(
        () => null,
      ),
    })
  }
  const old = await screenshotsToExpire(
    db,
    new Date(now - screenshotRetentionMs).toISOString(),
    100,
  )
  for (const screenshot of old) {
    await env.SCREENSHOTS.delete(screenshot.key)
    await markScreenshotExpired(db, screenshot.id)
  }
  const summary = {
    uploadsClosed,
    posted: owed.length,
    expired: old.length,
  }
  deps.logger.info({ message: "feedback.sweep", ...summary })
  return summary
}
