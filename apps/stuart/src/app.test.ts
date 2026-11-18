import type Anthropic from "@anthropic-ai/sdk"
import { RateLimitError } from "@anthropic-ai/sdk"
import { endUserKey } from "@matchbox/contracts/blockscout"
import { demoWallet } from "@matchbox/contracts/read-models/fixtures"
import { beforeEach, describe, expect, it } from "vitest"
import { createStuartApp, defaultDeps } from "./app"
import { resetClaudeBreaker } from "./query/claude"
import { type FakeCalls, fakeProviders, WALLET } from "./query/fakes"
import { chatBody, post, readSse, TEST_BLOCK, testDeps } from "./testing"

/** A model reply with usage and no tool call (Stuart falls back). */
function plainTextMessage(): Anthropic.Beta.BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    container: null,
    context_management: null,
    diagnostics: null,
    stop_details: null,
    stop_reason: "end_turn",
    stop_sequence: null,
    content: [],
    usage: {
      input_tokens: 120,
      output_tokens: 40,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 2_400,
      cache_creation: null,
      fallback_credit: null,
      inference_geo: null,
      iterations: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: "standard",
      speed: null,
    },
  }
}

const CONNECTED = { wallet: { address: WALLET, mode: "connected" } }
const WATCHING = { wallet: { address: WALLET, mode: "watching" } }

beforeEach(() => resetClaudeBreaker())

describe("POST /chat (SSE)", () => {
  it("streams status lines, then exactly one answer, then done", async () => {
    const response = await createStuartApp(testDeps()).request(
      post("/chat", { body: chatBody("optimize my votes", WATCHING) }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toMatch(/^text\/event-stream/)
    const frames = await readSse(response)
    for (const frame of frames) expect(frame.event).toBe(frame.data.type)
    const types = frames.map((frame) => frame.data.type)
    expect(types.at(-1)).toBe("done")
    expect(types.filter((type) => type === "answer")).toHaveLength(1)
    const answerAt = types.indexOf("answer")
    expect(types.slice(0, answerAt).every((type) => type === "status")).toBe(
      true,
    )
    expect(answerAt).toBeGreaterThan(0)
    const first = frames[0]?.data
    expect(first).toEqual({ type: "status", text: "Reading gauges and votes" })
    const answer = frames[answerAt]?.data
    if (answer?.type !== "answer") throw new Error("expected an answer")
    expect(answer.cached).toBe(false)
    expect(answer.response.intent).toBe("optimize_votes")
  })

  it("answers busy rate_limited with a retry time when the wallet is over its limit", async () => {
    const deps = testDeps({
      limiter: () => ({
        consume: async (key) => ({
          allowed: !key.includes(":wallet:"),
          limit: 12,
          remaining: 0,
          resetAt: 0,
          retryAfterSeconds: 17,
        }),
      }),
    })
    const response = await createStuartApp(deps).request(
      post("/chat", { body: chatBody("optimize my votes", CONNECTED) }),
    )
    expect(response.status).toBe(200)
    const frames = await readSse(response)
    expect(frames.map((frame) => frame.data)).toEqual([
      { type: "busy", reason: "rate_limited", retryAfterSeconds: 17 },
      { type: "done" },
    ])
  })

  it("answers busy spend_cap for model questions and keeps deterministic ones", async () => {
    const env = { ANTHROPIC_API_KEY: "sk-test", STUART_SPEND_CAP: "on" }
    const app = createStuartApp(testDeps())
    const capped = await readSse(
      await app.request(
        post("/chat", { body: chatBody("tell me something useful", WATCHING) }),
        undefined,
        env,
      ),
    )
    expect(capped[0]?.data).toMatchObject({
      type: "busy",
      reason: "spend_cap",
    })
    expect(capped.at(-1)?.data).toEqual({ type: "done" })
    const deterministic = await readSse(
      await app.request(
        post("/chat", { body: chatBody("optimize my votes", WATCHING) }),
        undefined,
        env,
      ),
    )
    expect(deterministic.some((frame) => frame.data.type === "answer")).toBe(
      true,
    )
  })

  it("caps spend once the day's budget is used, metering each turn", async () => {
    let calls = 0
    const deps = testDeps({
      messageCreator: () => async () => {
        calls += 1
        return plainTextMessage()
      },
    })
    const app = createStuartApp(deps)
    // One turn (well over $0.00001 at any model's rates) spends this budget.
    const env = {
      ANTHROPIC_API_KEY: "sk-test",
      STUART_DAILY_BUDGET_USD: "0.00001",
    }
    const first = await readSse(
      await app.request(
        post("/chat", { body: chatBody("tell me something", WATCHING) }),
        undefined,
        env,
      ),
    )
    expect(first.some((frame) => frame.data.type === "answer")).toBe(true)
    const second = await readSse(
      await app.request(
        post("/chat", { body: chatBody("tell me more", WATCHING) }),
        undefined,
        env,
      ),
    )
    expect(calls).toBe(1)
    expect(second[0]?.data).toMatchObject({ type: "busy", reason: "spend_cap" })
  })

  it("caps one IP prefix at its own daily budget, not the others", async () => {
    let calls = 0
    const deps = testDeps({
      messageCreator: () => async () => {
        calls += 1
        return plainTextMessage()
      },
    })
    const app = createStuartApp(deps)
    // The day's budget is ample; one turn spends a prefix's.
    const env = {
      ANTHROPIC_API_KEY: "sk-test",
      STUART_DAILY_BUDGET_USD: "25",
      STUART_IP_DAILY_BUDGET_USD: "0.00001",
    }
    const from = (ip: string, query: string) =>
      app.request(
        post("/chat", {
          body: chatBody(query, WATCHING),
          headers: { "CF-Connecting-IP": ip },
        }),
        undefined,
        env,
      )
    await readSse(await from("203.0.113.7", "tell me something"))
    const again = await readSse(await from("203.0.113.9", "tell me more"))
    expect(again[0]?.data).toMatchObject({ type: "busy", reason: "spend_cap" })
    const other = await readSse(await from("198.51.100.4", "tell me more"))
    expect(other.some((frame) => frame.data.type === "answer")).toBe(true)
    expect(calls).toBe(2)
  })

  it("answers busy model_busy when Anthropic rate limits", async () => {
    const deps = testDeps({
      messageCreator: () => async () => {
        throw new RateLimitError(
          429,
          { type: "error" },
          "rate limited",
          new Headers({ "retry-after": "5" }),
        )
      },
    })
    const frames = await readSse(
      await createStuartApp(deps).request(
        post("/chat", { body: chatBody("tell me something", WATCHING) }),
        undefined,
        { ANTHROPIC_API_KEY: "sk-test" },
      ),
    )
    expect(frames.map((frame) => frame.data)).toEqual([
      { type: "status", text: "Reading the question" },
      { type: "busy", reason: "model_busy", retryAfterSeconds: 5 },
      { type: "done" },
    ])
  })

  it("serves a repeated deterministic question from the per-block cache", async () => {
    const calls: FakeCalls = { counts: {} }
    const deps = testDeps({ providers: () => fakeProviders({}, calls) })
    const app = createStuartApp(deps)
    const body = chatBody("which gauges have the most incentives", WATCHING)
    const first = await readSse(await app.request(post("/chat", { body })))
    const second = await readSse(await app.request(post("/chat", { body })))
    const answerOf = (frames: typeof first) =>
      frames.find((frame) => frame.data.type === "answer")?.data
    const one = answerOf(first)
    const two = answerOf(second)
    if (one?.type !== "answer" || two?.type !== "answer") {
      throw new Error("expected answers")
    }
    expect(one.cached).toBe(false)
    expect(two.cached).toBe(true)
    expect(two.response).toEqual(one.response)
    expect(calls.counts["domain:boost"]).toBe(1)
    expect(second.map((frame) => frame.data.type)).toEqual(["answer", "done"])
    expect(deps.cache.size()).toBe(1)
  })

  it("misses the cache on a new block and never caches proposals", async () => {
    let block = TEST_BLOCK
    const deps = testDeps({ snapshotBlock: async () => block })
    const app = createStuartApp(deps)
    const body = chatBody("optimize my votes", CONNECTED)
    const first = await readSse(await app.request(post("/chat", { body })))
    const proposal = first.find((frame) => frame.data.type === "answer")?.data
    if (proposal?.type !== "answer") throw new Error("expected an answer")
    expect(proposal.response.proposedActions.length).toBeGreaterThan(0)
    expect(deps.cache.size()).toBe(0)
    const ranking = chatBody("which gauges have the most incentives", WATCHING)
    await readSse(await app.request(post("/chat", { body: ranking })))
    block += 1n
    const later = await readSse(
      await app.request(post("/chat", { body: ranking })),
    )
    const answer = later.find((frame) => frame.data.type === "answer")?.data
    if (answer?.type !== "answer") throw new Error("expected an answer")
    expect(answer.cached).toBe(false)
    expect(deps.cache.size()).toBe(2)
  })

  it("streams a high-level error, then done, when the runtime fails", async () => {
    const deps = testDeps({
      providers: () => {
        throw new Error("secret detail")
      },
    })
    const response = await createStuartApp(deps).request(
      post("/chat", { body: chatBody("optimize my votes", WATCHING) }),
    )
    const text = await response.clone().text()
    expect(text).not.toContain("secret detail")
    expect((await readSse(response)).map((frame) => frame.data)).toEqual([
      {
        type: "error",
        code: "internal",
        message: "Stuart is unavailable right now.",
      },
      { type: "done" },
    ])
    expect(
      deps.logs.some(
        (event) =>
          event.message === "stuart.chat_error" &&
          event.error === "secret detail",
      ),
    ).toBe(true)
  })

  it("keys each visitor at the Blockscout proxy with a salted hash of their IP prefix", async () => {
    const keys: Array<string | null> = []
    const deps = testDeps({
      providers: (input) => {
        keys.push(input.endUser)
        return fakeProviders()
      },
    })
    const app = createStuartApp(deps)
    const salt = "s".repeat(32)
    const ask = async (ip: string, env: Record<string, string>) =>
      readSse(
        await app.request(
          post("/chat", {
            body: chatBody("optimize my votes", WATCHING),
            headers: { "cf-connecting-ip": ip },
          }),
          undefined,
          env,
        ),
      )
    await ask("203.0.113.7", { BLOCKSCOUT_CALLER_SALT: salt })
    await ask("203.0.113.99", { BLOCKSCOUT_CALLER_SALT: salt })
    await ask("198.51.100.4", { BLOCKSCOUT_CALLER_SALT: salt })
    await ask("203.0.113.7", {})
    const expected = await endUserKey("203.0.113.7", salt)
    // One /24 is one visitor; another prefix is another; no salt, no key.
    expect(keys[0]).toBe(expected)
    expect(keys[1]).toBe(expected)
    expect(keys[2]).not.toBe(expected)
    expect(keys[2]).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(keys[3]).toBeNull()
  })

  it("answers end to end from the shared read-model fixtures without an API binding", async () => {
    const deps = testDeps({ providers: defaultDeps.providers })
    const frames = await readSse(
      await createStuartApp(deps).request(
        post("/chat", {
          body: chatBody("what are my earnings", {
            wallet: { address: demoWallet, mode: "watching" },
          }),
        }),
      ),
    )
    const answer = frames.find((frame) => frame.data.type === "answer")?.data
    if (answer?.type !== "answer") throw new Error("expected an answer")
    expect(answer.response.intent).toBe("wallet_earnings")
    expect(answer.response.answer.text).toMatch(/\$8\.75 this epoch/)
  })
})
