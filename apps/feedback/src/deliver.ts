import type { Logger } from "@matchbox/logger"
import { type DiscordScreenshot, postToDiscord } from "./discord"
import type { FeedbackConfig } from "./env"
import { recordDiscord, type StoredReport } from "./store"

/**
 * Posts one stored report to Discord and records the outcome. Never
 * throws: the report is already stored, and a failed post is retried by
 * the sweep. Without a bot token and channel the post is skipped.
 */
export async function deliverReport(input: {
  db: D1Database
  config: FeedbackConfig
  fetch: typeof globalThis.fetch
  logger: Logger
  report: StoredReport
  screenshot: DiscordScreenshot | null
}): Promise<void> {
  const { report, logger } = input
  try {
    if (input.config.discord === null) {
      await recordDiscord(input.db, report.id, { status: "skipped" })
      logger.info({
        message: "feedback.discord.skipped",
        reportId: report.id,
        reason: "not_configured",
      })
      return
    }
    const outcome = await postToDiscord({
      report,
      screenshot: input.screenshot,
      botToken: input.config.discord.botToken,
      channelId: input.config.discord.channelId,
      fetch: input.fetch,
    })
    if (outcome.status === "posted") {
      await recordDiscord(input.db, report.id, outcome)
      logger.info({
        message: "feedback.discord.posted",
        reportId: report.id,
        withScreenshot: input.screenshot !== null,
      })
      return
    }
    await recordDiscord(input.db, report.id, { status: "failed" })
    logger.warn({
      message: "feedback.discord.failed",
      reportId: report.id,
      httpStatus: outcome.httpStatus,
      attempt: report.discord_attempts + 1,
    })
  } catch (error) {
    logger.error({
      message: "feedback.discord.error",
      reportId: report.id,
      error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    })
  }
}

/** A stored screenshot, read back from R2 for a post made later. */
export async function loadScreenshot(
  bucket: R2Bucket,
  report: StoredReport,
): Promise<DiscordScreenshot | null> {
  if (
    report.screenshot_status !== "stored" ||
    report.screenshot_key === null ||
    report.screenshot_type === null
  ) {
    return null
  }
  const object = await bucket.get(report.screenshot_key)
  if (object === null) return null
  return {
    bytes: new Uint8Array(await object.arrayBuffer()),
    type: report.screenshot_type,
    fileName: screenshotFileName(report.screenshot_type),
  }
}

export function screenshotFileName(type: string): string {
  return type === "image/jpeg"
    ? "screenshot.jpg"
    : type === "image/webp"
      ? "screenshot.webp"
      : "screenshot.png"
}
