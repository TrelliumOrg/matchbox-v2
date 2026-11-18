import { describe, expect, it } from "vitest"
import { readFeedbackConfig } from "./env"

describe("readFeedbackConfig", () => {
  it("keeps local dev origins out of production", () => {
    const production = readFeedbackConfig({ ENVIRONMENT: "production" })
    expect(production.allowedOrigins).toContain("https://scan.matchbox.markets")
    expect(production.allowedOrigins).not.toContain("http://localhost:3000")
    const preview = readFeedbackConfig({
      ENVIRONMENT: "preview",
      FEEDBACK_ALLOWED_ORIGINS:
        "https://matchbox-pro-v2-preview.mallard.workers.dev, not a url,",
    })
    expect(preview.allowedOrigins).toContain("http://localhost:3000")
    expect(preview.allowedOrigins).toContain(
      "https://matchbox-pro-v2-preview.mallard.workers.dev",
    )
    expect(preview.allowedOrigins).not.toContain("not a url")
  })

  it("treats a wrangler placeholder as unset", () => {
    const config = readFeedbackConfig({
      TURNSTILE_SITE_KEY: "REPLACE_WITH_TURNSTILE_SITE_KEY",
      TURNSTILE_SECRET_KEY: "secret",
    })
    expect(config.turnstile).toBeNull()
  })

  it("needs both the bot token and a channel id to post", () => {
    expect(readFeedbackConfig({ DISCORD_BOT_TOKEN: "token" }).discord).toBe(
      null,
    )
    expect(
      readFeedbackConfig({
        DISCORD_BOT_TOKEN: "token",
        DISCORD_FEEDBACK_CHANNEL_ID: "#feedback",
      }).discord,
    ).toBeNull()
    expect(
      readFeedbackConfig({
        DISCORD_BOT_TOKEN: "token",
        DISCORD_FEEDBACK_CHANNEL_ID: "123456789012345678",
      }).discord,
    ).toEqual({ botToken: "token", channelId: "123456789012345678" })
  })
})
