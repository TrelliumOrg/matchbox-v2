import {
  applyD1Migrations,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test"
import { env } from "cloudflare:workers"
import {
  feedbackErrorSchema,
  feedbackReportResponseSchema,
} from "@matchbox/contracts/feedback"
import { createLogger, type LogLevel } from "@matchbox/logger"
import { createMemoryRateLimitClient } from "@matchbox/server"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { createFeedbackApp, type FeedbackAppDeps } from "./app"
import type { FeedbackBindings } from "./env"
import { readReport } from "./store"
import { runSweep } from "./sweep"

const origin = "https://pro.matchbox.markets"
const discordChannel = "123456789012345678"

const configured: FeedbackBindings = {
  FEEDBACK_DB: env.FEEDBACK_DB,
  SCREENSHOTS: env.SCREENSHOTS,
  ENVIRONMENT: "production",
  TURNSTILE_SITE_KEY: "site-key-for-tests",
  TURNSTILE_SECRET_KEY: "secret-for-tests",
  DISCORD_BOT_TOKEN: "bot-token-for-tests",
  DISCORD_FEEDBACK_CHANNEL_ID: discordChannel,
}

type Outbound = { url: string; init: RequestInit | undefined }

/** Turnstile passes the token "pass"; Discord is up or down. */
function harness(options: { discord?: "up" | "down"; now?: () => Date } = {}) {
  const state = { discord: options.discord ?? "up" }
  const outbound: Outbound[] = []
  const lines: Array<{ level: LogLevel; line: string }> = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input)
    outbound.push({ url, init })
    if (url.startsWith("https://challenges.cloudflare.com/")) {
      const body = z
        .object({ response: z.string() })
        .parse(JSON.parse(String(init?.body)))
      return Response.json(
        body.response === "pass"
          ? { success: true, action: "feedback" }
          : { success: false, "error-codes": ["invalid-input-response"] },
      )
    }
    if (url.startsWith("https://discord.com/api/v10/channels/")) {
      return state.discord === "up"
        ? Response.json({ id: "1300000000000000001" })
        : new Response("unavailable", { status: 503 })
    }
    return new Response("unexpected", { status: 599 })
  }
  const deps: FeedbackAppDeps = {
    now: options.now ?? (() => new Date()),
    logger: createLogger({
      format: "json",
      sink: (level, line) => lines.push({ level, line }),
    }),
    limiter: () => limiter,
    fetch,
  }
  const limiter = createMemoryRateLimitClient()
  const app = createFeedbackApp(deps)
  async function send(
    request: Request,
    bindings: FeedbackBindings = configured,
  ): Promise<Response> {
    const ctx = createExecutionContext()
    const response = await app.fetch(request, bindings, ctx)
    await waitOnExecutionContext(ctx)
    return response
  }
  const discordCalls = () =>
    outbound.filter((call) => call.url.startsWith("https://discord.com/"))
  return { state, outbound, lines, deps, send, discordCalls }
}

function reportBody(overrides: Record<string, unknown> = {}) {
  return {
    kind: "bug",
    message: "Claim all fails in OKX Wallet with failed on chain.",
    context: {
      surface: "pro",
      route: "/vote/vebtc",
      build: "Bx3k9Qa1",
      viewport: { width: 390, height: 664 },
      theme: { mode: "light", preset: "paper" },
      userAgent:
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/142.0 Mobile Safari/537.36 OKApp/(OKEx/6.90.0)",
      walletBrowser: "okx",
      chainId: 31612,
    },
    wallet: null,
    contact: null,
    screenshot: false,
    turnstileToken: "pass",
    ...overrides,
  }
}

function postReport(
  body: unknown,
  headers: Record<string, string> = { origin },
): Request {
  return new Request("https://feedback.test/v1/reports", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.7",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function png(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return bytes
}

function putScreenshot(
  path: string,
  token: string,
  body: Uint8Array | ReadableStream,
  type = "image/png",
): Request {
  return new Request(`https://feedback.test${path}`, {
    method: "PUT",
    headers: {
      origin,
      "content-type": type,
      authorization: `Bearer ${token}`,
      "cf-connecting-ip": "203.0.113.7",
    },
    body,
  })
}

async function rowCount(): Promise<number> {
  const row = await env.FEEDBACK_DB.prepare(
    "SELECT COUNT(*) AS count FROM feedback_reports",
  ).first()
  return z.object({ count: z.number() }).parse(row).count
}

async function errorCode(response: Response): Promise<string> {
  return feedbackErrorSchema.parse(await response.json()).error.code
}

beforeAll(async () => {
  await applyD1Migrations(env.FEEDBACK_DB, env.TEST_MIGRATIONS)
})

beforeEach(async () => {
  await env.FEEDBACK_DB.prepare("DELETE FROM feedback_reports").run()
  const listed = await env.SCREENSHOTS.list()
  for (const object of listed.objects) await env.SCREENSHOTS.delete(object.key)
})

describe("POST /v1/reports", () => {
  it("stores a report and posts it to the Discord channel", async () => {
    const h = harness()
    const response = await h.send(
      postReport(
        reportBody({
          wallet: "0x5DC2000000000000000000000000000000071AF0",
          contact: "pyke on Discord",
        }),
      ),
    )
    expect(response.status).toBe(201)
    expect(response.headers.get("access-control-allow-origin")).toBe(origin)
    const body = feedbackReportResponseSchema.parse(await response.json())
    expect(body.upload).toBeNull()

    const stored = await readReport(env.FEEDBACK_DB, body.id)
    expect(stored).toMatchObject({
      reference: body.reference,
      origin,
      route: "/vote/vebtc",
      wallet: "0x5dc2000000000000000000000000000000071af0",
      contact: "pyke on Discord",
      screenshot_status: "none",
      discord_status: "posted",
      discord_message_id: "1300000000000000001",
    })

    const [post] = h.discordCalls()
    expect(post?.url).toBe(
      `https://discord.com/api/v10/channels/${discordChannel}/messages`,
    )
    const headers = new Headers(post?.init?.headers)
    expect(headers.get("authorization")).toBe("Bot bot-token-for-tests")
    const message = z
      .object({
        allowed_mentions: z.object({ parse: z.array(z.string()) }),
        embeds: z.array(
          z.object({
            author: z.object({ name: z.string() }),
            footer: z.object({ text: z.string() }),
            fields: z.array(z.object({ name: z.string(), value: z.string() })),
          }),
        ),
      })
      .parse(JSON.parse(String(post?.init?.body)))
    expect(message.allowed_mentions.parse).toEqual([])
    expect(message.embeds[0]?.author.name).toBe("Bug, Matchbox Pro")
    expect(message.embeds[0]?.footer.text).toBe(`Report ${body.reference}`)
    expect(message.embeds[0]?.fields.map((field) => field.name)).toEqual([
      "Page",
      "App",
      "Browser",
      "Screen",
      "Wallet",
      "Chain",
      "Contact",
    ])
  })

  it("stores a report whose page the user removed", async () => {
    const h = harness()
    const response = await h.send(
      postReport(
        reportBody({ context: { ...reportBody().context, route: null } }),
      ),
    )
    expect(response.status).toBe(201)
    const { id } = feedbackReportResponseSchema.parse(await response.json())
    expect(await readReport(env.FEEDBACK_DB, id)).toMatchObject({ route: null })
  })

  it("never logs the message, contact, wallet, user agent or IP", async () => {
    const h = harness()
    await h.send(
      postReport(
        reportBody({
          wallet: "0x5dc2000000000000000000000000000000071af0",
          contact: "reporter@example.com",
        }),
      ),
    )
    const logs = h.lines.map((entry) => entry.line).join("\n")
    expect(logs).toContain("feedback.report.stored")
    for (const personal of [
      "Claim all fails",
      "reporter@example.com",
      "0x5dc2",
      "OKApp",
      "203.0.113",
    ]) {
      expect(logs).not.toContain(personal)
    }
  })

  it("refuses a report that breaks the contract, without using quota", async () => {
    const h = harness()
    for (const body of [
      reportBody({ message: "ok" }),
      reportBody({ email: "someone@example.com" }),
      reportBody({
        context: { ...reportBody().context, route: "/vote?address=0xabc" },
      }),
    ]) {
      const response = await h.send(postReport(body))
      expect(response.status).toBe(400)
      expect(await errorCode(response)).toBe("invalid_request")
    }
    const notJson = await h.send(
      new Request("https://feedback.test/v1/reports", {
        method: "POST",
        headers: { origin, "content-type": "text/plain" },
        body: "hello",
      }),
    )
    expect(notJson.status).toBe(415)
    expect(await rowCount()).toBe(0)
    expect(h.outbound).toHaveLength(0)
    const ok = await h.send(postReport(reportBody()))
    expect(ok.status).toBe(201)
  })

  it("refuses a report whose Turnstile check fails", async () => {
    const h = harness()
    const response = await h.send(
      postReport(reportBody({ turnstileToken: "forged" })),
    )
    expect(response.status).toBe(403)
    expect(await errorCode(response)).toBe("check_failed")
    expect(await rowCount()).toBe(0)
    expect(h.discordCalls()).toHaveLength(0)
  })

  it("refuses every report while Turnstile is not configured", async () => {
    const h = harness()
    const response = await h.send(postReport(reportBody()), {
      ...configured,
      TURNSTILE_SECRET_KEY: "",
    })
    expect(response.status).toBe(503)
    expect(await errorCode(response)).toBe("unavailable")
    expect(await rowCount()).toBe(0)
  })

  it("rate limits an IP prefix with Retry-After", async () => {
    const h = harness()
    for (let index = 0; index < 3; index += 1) {
      expect((await h.send(postReport(reportBody()))).status).toBe(201)
    }
    const limited = await h.send(
      postReport(reportBody(), {
        origin,
        // Same /24 as the others.
        "cf-connecting-ip": "203.0.113.99",
      }),
    )
    expect(limited.status).toBe(429)
    expect(await errorCode(limited)).toBe("rate_limited")
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0)
    expect(await rowCount()).toBe(3)
    const otherNetwork = await h.send(
      postReport(reportBody(), { origin, "cf-connecting-ip": "198.51.100.4" }),
    )
    expect(otherNetwork.status).toBe(201)
  })

  it("refuses a foreign origin, and a request with none", async () => {
    const h = harness()
    for (const headers of [
      { origin: "https://evil.example" },
      { origin: "https://pro.matchbox.markets.evil.example" },
      // Local dev servers are allowed only outside production.
      { origin: "http://localhost:3000" },
      {},
    ]) {
      const response = await h.send(postReport(reportBody(), headers))
      expect(response.status).toBe(403)
      expect(await errorCode(response)).toBe("forbidden_origin")
      expect(response.headers.get("access-control-allow-origin")).toBeNull()
    }
    expect(await rowCount()).toBe(0)
    expect(h.outbound).toHaveLength(0)
  })

  it("answers the CORS preflight for allowed origins only", async () => {
    const h = harness()
    const preflight = (from: string) =>
      new Request("https://feedback.test/v1/reports", {
        method: "OPTIONS",
        headers: {
          origin: from,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      })
    const allowed = await h.send(preflight(origin))
    expect(allowed.headers.get("access-control-allow-origin")).toBe(origin)
    const refused = await h.send(preflight("https://evil.example"))
    expect(refused.headers.get("access-control-allow-origin")).toBeNull()
  })

  it("keeps the report when Discord is down, and the sweep posts it later", async () => {
    let now = new Date("2026-11-12T08:14:00.000Z")
    const h = harness({ discord: "down", now: () => now })
    const response = await h.send(postReport(reportBody()))
    expect(response.status).toBe(201)
    const { id } = feedbackReportResponseSchema.parse(await response.json())
    expect(await readReport(env.FEEDBACK_DB, id)).toMatchObject({
      discord_status: "failed",
      discord_attempts: 1,
    })
    expect(h.lines.some((entry) => entry.level === "warn")).toBe(true)

    h.state.discord = "up"
    now = new Date("2026-11-12T08:30:00.000Z")
    const summary = await runSweep(configured, h.deps)
    expect(summary.posted).toBe(1)
    expect(await readReport(env.FEEDBACK_DB, id)).toMatchObject({
      discord_status: "posted",
      discord_attempts: 2,
    })
  })

  it("stores the report and skips the post without a bot configured", async () => {
    const h = harness()
    const response = await h.send(postReport(reportBody()), {
      ...configured,
      DISCORD_BOT_TOKEN: "",
    })
    expect(response.status).toBe(201)
    const { id } = feedbackReportResponseSchema.parse(await response.json())
    expect(await readReport(env.FEEDBACK_DB, id)).toMatchObject({
      discord_status: "skipped",
    })
    expect(h.discordCalls()).toHaveLength(0)
  })
})

describe("PUT /v1/reports/:id/screenshot", () => {
  async function announced(h: ReturnType<typeof harness>) {
    const response = await h.send(postReport(reportBody({ screenshot: true })))
    expect(response.status).toBe(201)
    const body = feedbackReportResponseSchema.parse(await response.json())
    if (body.upload === null) throw new Error("expected an upload")
    return { id: body.id, upload: body.upload }
  }

  it("holds the post for the screenshot, then posts both", async () => {
    const h = harness()
    const { id, upload } = await announced(h)
    expect(h.discordCalls()).toHaveLength(0)
    expect(await readReport(env.FEEDBACK_DB, id)).toMatchObject({
      screenshot_status: "pending",
      discord_status: "waiting",
    })

    const response = await h.send(
      putScreenshot(upload.path, upload.token, png(2_048)),
    )
    expect(response.status).toBe(200)
    const stored = await readReport(env.FEEDBACK_DB, id)
    expect(stored).toMatchObject({
      screenshot_status: "stored",
      screenshot_type: "image/png",
      screenshot_bytes: 2_048,
      upload_token_hash: null,
      discord_status: "posted",
    })
    expect(stored?.screenshot_key).toMatch(
      /^screenshots\/[A-Za-z0-9_-]{43}\.png$/,
    )
    const object = await env.SCREENSHOTS.get(stored?.screenshot_key ?? "")
    expect(object?.size).toBe(2_048)
    const [post] = h.discordCalls()
    expect(post?.init?.body).toBeInstanceOf(FormData)

    const again = await h.send(
      putScreenshot(upload.path, upload.token, png(2_048)),
    )
    expect(again.status).toBe(409)
    expect(await errorCode(again)).toBe("upload_closed")
  })

  it("refuses a screenshot over 5 MB, declared or streamed", async () => {
    const h = harness()
    const { id, upload } = await announced(h)
    const declared = await h.send(
      putScreenshot(upload.path, upload.token, png(5 * 1024 * 1024 + 1)),
    )
    expect(declared.status).toBe(413)
    expect(await errorCode(declared)).toBe("payload_too_large")

    const chunk = png(1024 * 1024)
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 6) {
          controller.close()
          return
        }
        sent += 1
        controller.enqueue(chunk)
      },
    })
    const streamed = await h.send(
      putScreenshot(upload.path, upload.token, stream),
    )
    expect(streamed.status).toBe(413)
    expect(await readReport(env.FEEDBACK_DB, id)).toMatchObject({
      screenshot_status: "pending",
    })
    expect((await env.SCREENSHOTS.list()).objects).toHaveLength(0)
  })

  it("refuses a wrong token, a wrong type and bytes that are not the type", async () => {
    const h = harness()
    const { upload } = await announced(h)
    const wrongToken = await h.send(
      putScreenshot(upload.path, "x".repeat(43), png(100)),
    )
    expect(wrongToken.status).toBe(404)
    const gif = await h.send(
      putScreenshot(upload.path, upload.token, png(100), "image/gif"),
    )
    expect(gif.status).toBe(415)
    const html = await h.send(
      putScreenshot(
        upload.path,
        upload.token,
        new TextEncoder().encode("<html>not an image</html>"),
      ),
    )
    expect(html.status).toBe(415)
    expect((await env.SCREENSHOTS.list()).objects).toHaveLength(0)
  })

  it("refuses an upload from a foreign origin", async () => {
    const h = harness()
    const { upload } = await announced(h)
    const request = putScreenshot(upload.path, upload.token, png(100))
    const foreign = new Request(request, {
      headers: {
        ...Object.fromEntries(request.headers),
        origin: "https://evil.example",
      },
    })
    const response = await h.send(foreign)
    expect(response.status).toBe(403)
  })
})

describe("the sweep", () => {
  it("posts a report whose screenshot never came, without one", async () => {
    let now = new Date("2026-11-12T08:00:00.000Z")
    const h = harness({ now: () => now })
    const response = await h.send(postReport(reportBody({ screenshot: true })))
    const { id } = feedbackReportResponseSchema.parse(await response.json())
    now = new Date("2026-11-12T08:20:00.000Z")
    const summary = await runSweep(configured, h.deps)
    expect(summary).toMatchObject({ uploadsClosed: 1, posted: 1 })
    expect(await readReport(env.FEEDBACK_DB, id)).toMatchObject({
      screenshot_status: "none",
      upload_token_hash: null,
      discord_status: "posted",
    })
  })

  it("deletes screenshots after 90 days and keeps only expired", async () => {
    let now = new Date("2026-11-12T08:00:00.000Z")
    const h = harness({ now: () => now })
    const response = await h.send(postReport(reportBody({ screenshot: true })))
    const body = feedbackReportResponseSchema.parse(await response.json())
    if (body.upload === null) throw new Error("expected an upload")
    await h.send(putScreenshot(body.upload.path, body.upload.token, png(512)))
    const key = (await readReport(env.FEEDBACK_DB, body.id))?.screenshot_key
    expect(key).toBeTruthy()

    now = new Date("2027-02-09T08:00:00.000Z")
    expect((await runSweep(configured, h.deps)).expired).toBe(0)
    now = new Date("2027-02-10T09:00:00.000Z")
    expect((await runSweep(configured, h.deps)).expired).toBe(1)
    expect(await env.SCREENSHOTS.get(key ?? "")).toBeNull()
    expect(await readReport(env.FEEDBACK_DB, body.id)).toMatchObject({
      screenshot_status: "expired",
      screenshot_key: null,
      screenshot_bytes: null,
    })
  })
})

describe("GET routes", () => {
  it("reports health without secrets", async () => {
    const h = harness()
    const response = await h.send(
      new Request("https://feedback.test/v1/health"),
    )
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({
      status: "ok",
      service: "matchbox-feedback",
      environment: "production",
      discord: "configured",
      turnstile: "configured",
    })
    expect(text).not.toContain("secret-for-tests")
    expect(text).not.toContain("bot-token-for-tests")
  })

  it("gives allowed pages the Turnstile site key", async () => {
    const h = harness()
    const response = await h.send(
      new Request("https://feedback.test/v1/config", { headers: { origin } }),
    )
    expect(await response.json()).toEqual({
      turnstileSiteKey: "site-key-for-tests",
    })
    const placeholder = await h.send(
      new Request("https://feedback.test/v1/config", { headers: { origin } }),
      { ...configured, TURNSTILE_SITE_KEY: "REPLACE_WITH_TURNSTILE_SITE_KEY" },
    )
    expect(await placeholder.json()).toEqual({ turnstileSiteKey: null })
  })
})
