import {
  stuartErrorSchema,
  stuartStatusSchema,
} from "@matchbox/stuart-ui/contract"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { createStuartApp } from "../app"
import { chatBody, post, readSse, testDeps } from "../testing"
import { WALLET } from "./fakes"

const PRO = "https://pro.matchbox.markets"
const BODY = chatBody("which gauges are best?")

async function errorCode(response: Response): Promise<string> {
  return stuartErrorSchema.parse(await response.json()).error.code
}

describe("Stuart routes", () => {
  it("answers Pro's origin with its own CORS origin, never a wildcard", async () => {
    const app = createStuartApp(testDeps())
    const response = await app.request(
      post("/chat", {
        body: BODY,
        headers: { origin: PRO, "cf-connecting-ip": "10.0.0.1" },
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toMatch(/^text\/event-stream/)
    expect(response.headers.get("access-control-allow-origin")).toBe(PRO)
    expect(response.headers.get("vary")).toContain("Origin")
    const frames = await readSse(response)
    expect(frames.at(-1)?.event).toBe("done")
  })

  it("answers preflight for allowed origins and refuses the rest", async () => {
    const app = createStuartApp(testDeps())
    for (const path of ["/chat", "/proposal/refresh", "/support-report"]) {
      const foreign = await app.request(
        new Request(`https://matchbox-stuart.test${path}`, {
          method: "OPTIONS",
          headers: { origin: "https://evil.example" },
        }),
      )
      expect(foreign.status).toBe(403)
      expect(foreign.headers.get("access-control-allow-origin")).toBeNull()
      const pro = await app.request(
        new Request(`https://matchbox-stuart.test${path}`, {
          method: "OPTIONS",
          headers: { origin: PRO },
        }),
      )
      expect(pro.status).toBe(204)
      expect(pro.headers.get("access-control-allow-origin")).toBe(PRO)
    }
  })

  it("rejects cross-site origins and fetch metadata", async () => {
    const app = createStuartApp(testDeps())
    const foreign = await app.request(
      post("/chat", {
        body: BODY,
        headers: { origin: "https://evil.example" },
      }),
    )
    expect(foreign.status).toBe(403)
    expect(await errorCode(foreign)).toBe("forbidden_origin")
    const crossSite = await app.request(
      post("/chat", {
        body: BODY,
        headers: { "sec-fetch-site": "cross-site" },
      }),
    )
    expect(crossSite.status).toBe(403)
    const extra = await app.request(
      post("/chat", {
        body: BODY,
        headers: { origin: "https://staging.example" },
      }),
      undefined,
      { STUART_ALLOWED_ORIGINS: "https://staging.example" },
    )
    expect(extra.status).toBe(200)
  })

  it("requires JSON and caps the body size", async () => {
    const app = createStuartApp(testDeps())
    const form = await app.request(
      post("/chat", { body: BODY, headers: { "content-type": "text/plain" } }),
    )
    expect(form.status).toBe(415)
    expect(await errorCode(form)).toBe("unsupported_media_type")
    const huge = await app.request(
      post("/chat", { body: JSON.stringify({ padding: "x".repeat(20_000) }) }),
    )
    expect(huge.status).toBe(413)
    const invalid = await app.request(
      post("/chat", { body: JSON.stringify({ version: 2 }) }),
    )
    expect(invalid.status).toBe(400)
    expect(await errorCode(invalid)).toBe("invalid_request")
  })

  it("rate limits the JSON routes with 429 and retry-after", async () => {
    const deps = testDeps({
      limiter: () => ({
        consume: async () => ({
          allowed: false,
          limit: 1,
          remaining: 0,
          resetAt: 0,
          retryAfterSeconds: 42,
        }),
      }),
    })
    const limited = await createStuartApp(deps).request(
      post("/support-report", { body: JSON.stringify({ version: 1 }) }),
      undefined,
      { SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "k" },
    )
    expect(limited.status).toBe(429)
    expect(limited.headers.get("retry-after")).toBe("42")
    expect(await errorCode(limited)).toBe("rate_limited")
  })

  it("limits each wallet as well as each IP prefix", async () => {
    const keys: string[] = []
    const deps = testDeps({
      limiter: () => ({
        consume: async (key) => {
          keys.push(key)
          return {
            allowed: true,
            limit: 10,
            remaining: 9,
            resetAt: 0,
            retryAfterSeconds: 0,
          }
        },
      }),
    })
    const response = await createStuartApp(deps).request(
      post("/chat", {
        body: chatBody("optimize my votes", {
          wallet: { address: WALLET, mode: "connected" },
        }),
        headers: { "cf-connecting-ip": "203.0.113.77" },
      }),
    )
    await readSse(response)
    expect(keys).toEqual([
      "stuart:chat:ip:203.0.113.0/24",
      `stuart:chat:wallet:${WALLET.toLowerCase()}`,
    ])
  })

  it("reports deterministic mode and never echoes the key", async () => {
    const app = createStuartApp(testDeps())
    const status = await app.request("/status", undefined, {
      ANTHROPIC_API_KEY: "sk-ant-secret-value",
      STUART_CLAUDE_ENABLED: "false",
    })
    const text = await status.text()
    expect(text).not.toContain("sk-ant")
    expect(
      stuartStatusSchema.parse(
        z.record(z.string(), z.unknown()).parse(JSON.parse(text)),
      ),
    ).toEqual({ stuart: "deterministic", model: null, supportReports: false })
    const live = await app.request("/status", undefined, {
      ANTHROPIC_API_KEY: "sk-ant-secret-value",
    })
    expect(stuartStatusSchema.parse(await live.json())).toEqual({
      stuart: "claude",
      model: "claude-sonnet-5-5",
      supportReports: false,
    })
  })

  it("refuses a forged proposal refresh", async () => {
    const app = createStuartApp(testDeps())
    const response = await app.request(
      post("/proposal/refresh", { body: JSON.stringify({ version: 1 }) }),
    )
    expect(response.status).toBe(400)
  })

  it("answers support_unavailable without its storage", async () => {
    const app = createStuartApp(testDeps())
    const response = await app.request(
      post("/support-report", { body: JSON.stringify({ version: 1 }) }),
    )
    expect(response.status).toBe(503)
    expect(await errorCode(response)).toBe("support_unavailable")
  })
})
