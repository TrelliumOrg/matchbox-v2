import { describe, expect, it } from "vitest"
import {
  buildDiscordMessage,
  escapeMarkdown,
  reportActions,
  reportTitle,
} from "./discord"
import type { StoredReport } from "./store"

const report: StoredReport = {
  id: "0123456789abcdef0123456789abcdef",
  reference: "FB-7K3Q2M",
  created_at: "2026-11-12T08:16:00.000Z",
  kind: "bug",
  message:
    "Claim all fails in OKX Wallet\nTried twice, at 08:12 and 08:14. Works on desktop.",
  origin: "https://pro.matchbox.markets",
  surface: "pro",
  route: "/",
  build: "Bx3k9Qa1",
  viewport_width: 390,
  viewport_height: 664,
  theme_mode: "light",
  theme_preset: "paper",
  user_agent:
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/142.0 Mobile Safari/537.36 OKApp/(OKEx/6.90.0)",
  wallet_browser: "okx",
  chain_id: null,
  wallet: "0x5dc2000000000000000000000000000000071af0",
  contact: "pyke on Discord",
  screenshot_status: "stored",
  screenshot_key: "screenshots/abc.png",
  screenshot_type: "image/png",
  screenshot_bytes: 1000,
  screenshot_stored_at: "2026-11-12T08:16:01.000Z",
  upload_token_hash: null,
  discord_status: "waiting",
  discord_message_id: null,
  discord_attempts: 0,
}

describe("the Discord message", () => {
  it("lays the report out as the frame shows", () => {
    const message = buildDiscordMessage(report, { fileName: "screenshot.png" })
    const embed = message.embeds[0]
    expect(embed?.author.name).toBe("Bug, Matchbox Pro")
    expect(embed?.title).toBe("Claim all fails in OKX Wallet")
    expect(embed?.footer.text).toBe("Report FB-7K3Q2M")
    expect(embed?.image?.url).toBe("attachment://screenshot.png")
    expect(embed?.timestamp).toBe(report.created_at)
    expect(
      Object.fromEntries(embed?.fields.map((f) => [f.name, f.value]) ?? []),
    ).toEqual({
      Page: "[pro.matchbox.markets/](https://pro.matchbox.markets/)",
      App: "Matchbox Pro, build Bx3k9Qa1",
      Browser: "OKX Wallet in-app browser, Android",
      Screen: "390 x 664, light",
      Wallet:
        "[0x5dc2…1af0](https://scan.matchbox.markets/address/0x5dc2000000000000000000000000000000071af0)",
      Contact: "pyke on Discord",
    })
  })

  it("never pings anyone and has no buttons in v1", () => {
    const message = buildDiscordMessage(
      { ...report, message: "@everyone look <@123>" },
      null,
    )
    expect(message.allowed_mentions).toEqual({ parse: [] })
    expect(message.components).toEqual([])
    expect(reportActions(report)).toEqual([])
    expect(message.embeds[0]?.image).toBeUndefined()
  })

  it("leaves out what the user did not send", () => {
    const message = buildDiscordMessage(
      { ...report, wallet: null, contact: null, build: null },
      null,
    )
    const names = message.embeds[0]?.fields.map((field) => field.name)
    expect(names).toEqual(["Page", "App", "Browser", "Screen"])
    expect(message.embeds[0]?.fields[1]?.value).toBe("Matchbox Pro")
  })

  it("leaves the page out when the user removed it", () => {
    const message = buildDiscordMessage({ ...report, route: null }, null)
    const names = message.embeds[0]?.fields.map((field) => field.name)
    expect(names?.includes("Page")).toBe(false)
  })

  it("shows typed markdown instead of applying it", () => {
    expect(escapeMarkdown("[click](https://evil.example) **now**")).toBe(
      "\\[click\\]\\(https://evil.example\\) \\*\\*now\\*\\*",
    )
  })

  it("titles the report with its first line, at most 80 characters", () => {
    expect(reportTitle("\n\n  First line  \nsecond")).toBe("First line")
    const long = reportTitle("a".repeat(120))
    expect(long).toHaveLength(80)
    expect(long.endsWith("…")).toBe(true)
  })
})
