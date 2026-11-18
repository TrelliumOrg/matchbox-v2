import { describe, expect, it } from "vitest"
import {
  describeFeedbackBrowser,
  feedbackReferenceSchema,
  feedbackReportRequestSchema,
  feedbackRouteSchema,
  feedbackScreenshotPath,
} from "./feedback"

const report = {
  kind: "bug",
  message: "Claim all failed twice with failed on chain.",
  context: {
    surface: "pro",
    route: "/vote/vebtc",
    build: "3f9a2c1",
    viewport: { width: 1440, height: 900 },
    theme: { mode: "light", preset: "paper" },
    userAgent: "Mozilla/5.0",
    walletBrowser: null,
    chainId: 31612,
  },
  wallet: null,
  contact: null,
  screenshot: false,
  turnstileToken: "token",
}

describe("feedback contract", () => {
  it("accepts a report and trims its message", () => {
    const parsed = feedbackReportRequestSchema.parse({
      ...report,
      message: "  It broke  ",
    })
    expect(parsed.message).toBe("It broke")
  })

  it("lower-cases a wallet address the user chose to include", () => {
    const parsed = feedbackReportRequestSchema.parse({
      ...report,
      wallet: "0x5DC2000000000000000000000000000000071AF0",
    })
    expect(parsed.wallet).toBe("0x5dc2000000000000000000000000000000071af0")
  })

  it("refuses fields the panel never sends", () => {
    expect(
      feedbackReportRequestSchema.safeParse({ ...report, email: "a@b.co" })
        .success,
    ).toBe(false)
    expect(
      feedbackReportRequestSchema.safeParse({
        ...report,
        context: { ...report.context, cookies: "a=b" },
      }).success,
    ).toBe(false)
  })

  it("refuses a message under three characters or over 2,000", () => {
    expect(
      feedbackReportRequestSchema.safeParse({ ...report, message: " ab " })
        .success,
    ).toBe(false)
    expect(
      feedbackReportRequestSchema.safeParse({
        ...report,
        message: "a".repeat(2_001),
      }).success,
    ).toBe(false)
  })

  it("takes a path only, never a query or fragment", () => {
    expect(feedbackRouteSchema.safeParse("/gauges/0xabc").success).toBe(true)
    expect(feedbackRouteSchema.safeParse("/?address=0xabc").success).toBe(false)
    expect(feedbackRouteSchema.safeParse("/vote#top").success).toBe(false)
    expect(feedbackRouteSchema.safeParse("vote").success).toBe(false)
  })

  it("reads references without the letters I, L, O and U", () => {
    expect(feedbackReferenceSchema.safeParse("FB-7K3Q2M").success).toBe(true)
    expect(feedbackReferenceSchema.safeParse("FB-7K3Q2O").success).toBe(false)
  })

  it("builds the screenshot path under the report", () => {
    expect(feedbackScreenshotPath("ab12")).toBe("/v1/reports/ab12/screenshot")
  })
})

describe("describeFeedbackBrowser", () => {
  it("names the browser, its version and the platform", () => {
    expect(
      describeFeedbackBrowser(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
        null,
      ),
    ).toBe("Chrome 142 on macOS")
    expect(
      describeFeedbackBrowser(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
        null,
      ),
    ).toBe("Safari 18 on iOS")
    expect(
      describeFeedbackBrowser(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
        null,
      ),
    ).toBe("Edge 142 on Windows")
  })

  it("names a wallet's in-app browser", () => {
    expect(
      describeFeedbackBrowser("Mozilla/5.0 (Linux; Android 14)", "okx"),
    ).toBe("OKX Wallet in-app browser, Android")
  })

  it("says so when it cannot tell", () => {
    expect(describeFeedbackBrowser("curl/8.0", null)).toBe("Unknown browser")
  })
})
