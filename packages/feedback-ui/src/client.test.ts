import { describe, expect, it } from "vitest"
import { fetchSiteKey, sendReport } from "./client"
import { feedbackEndpoint } from "./entry"

const endpoint = "https://feedback.matchbox.test"

const report = {
  kind: "bug" as const,
  message: "Claim all fails",
  context: {
    surface: "pro" as const,
    route: "/",
    build: null,
    viewport: { width: 390, height: 664 },
    theme: { mode: "light" as const, preset: "paper" },
    userAgent: "Mozilla/5.0",
    walletBrowser: null,
    chainId: null,
  },
  wallet: null,
  contact: null,
  screenshot: true,
  turnstileToken: "token",
}

type Call = { url: string; init: RequestInit | undefined }

function fake(responses: Response[]) {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    const next = responses.shift()
    if (next === undefined) throw new TypeError("offline")
    return next
  }
  return { calls, fetch }
}

const created = () =>
  Response.json(
    {
      id: "0123456789abcdef0123456789abcdef",
      reference: "FB-7K3Q2M",
      upload: {
        path: "/v1/reports/0123456789abcdef0123456789abcdef/screenshot",
        token: "t".repeat(43),
      },
    },
    { status: 201 },
  )

describe("feedbackEndpoint", () => {
  it("takes an https origin, or http on localhost", () => {
    expect(feedbackEndpoint("https://feedback.matchbox.markets/")).toBe(
      "https://feedback.matchbox.markets",
    )
    expect(feedbackEndpoint("http://localhost:8787")).toBe(
      "http://localhost:8787",
    )
  })

  it("hides the entry for anything else", () => {
    for (const value of [
      undefined,
      "",
      "  ",
      "http://feedback.example",
      "not a url",
      42,
    ]) {
      expect(feedbackEndpoint(value)).toBeNull()
    }
  })
})

describe("sendReport", () => {
  it("sends the report, then the screenshot with its one-time token", async () => {
    const { calls, fetch } = fake([created(), Response.json({ ok: true })])
    const screenshot = new Blob(["png"], { type: "image/png" })
    const outcome = await sendReport({ endpoint, report, screenshot, fetch })
    expect(outcome).toEqual({ result: "sent", reference: "FB-7K3Q2M" })
    expect(calls.map((call) => call.url)).toEqual([
      `${endpoint}/v1/reports`,
      `${endpoint}/v1/reports/0123456789abcdef0123456789abcdef/screenshot`,
    ])
    const [post, put] = calls
    expect(post?.init?.credentials).toBe("omit")
    expect(post?.init?.referrerPolicy).toBe("no-referrer")
    expect(put?.init?.method).toBe("PUT")
    expect(new Headers(put?.init?.headers).get("authorization")).toBe(
      `Bearer ${"t".repeat(43)}`,
    )
    expect(put?.init?.body).toBe(screenshot)
  })

  it("counts the report as sent when only the upload fails", async () => {
    const { calls, fetch } = fake([created()])
    const outcome = await sendReport({
      endpoint,
      report,
      screenshot: new Blob(["png"], { type: "image/png" }),
      fetch,
    })
    expect(outcome.result).toBe("sent")
    expect(calls).toHaveLength(3)
  })

  it("reads the Worker's refusals", async () => {
    const error = (status: number, code: string, retry: number | null) =>
      Response.json(
        { error: { code, message: "x", retryAfterSeconds: retry } },
        { status },
      )
    const cases = [
      [
        error(429, "rate_limited", 840),
        { result: "rate-limited", retryAfterSeconds: 840 },
      ],
      [error(403, "check_failed", null), { result: "check-failed" }],
      [error(503, "unavailable", null), { result: "failed" }],
      [
        new Response("<html>bad gateway</html>", { status: 502 }),
        { result: "failed" },
      ],
    ] as const
    for (const [response, expected] of cases) {
      const { fetch } = fake([response])
      expect(
        await sendReport({ endpoint, report, screenshot: null, fetch }),
      ).toEqual(expected)
    }
  })

  it("fails softly when offline", async () => {
    const { fetch } = fake([])
    expect(
      await sendReport({ endpoint, report, screenshot: null, fetch }),
    ).toEqual({ result: "failed" })
  })
})

describe("fetchSiteKey", () => {
  it("returns the key, or null when the Worker cannot take reports", async () => {
    expect(
      await fetchSiteKey(
        endpoint,
        fake([Response.json({ turnstileSiteKey: "0x4AAA" })]).fetch,
      ),
    ).toBe("0x4AAA")
    expect(
      await fetchSiteKey(
        endpoint,
        fake([Response.json({ turnstileSiteKey: null })]).fetch,
      ),
    ).toBeNull()
    expect(await fetchSiteKey(endpoint, fake([]).fetch)).toBeNull()
  })
})
