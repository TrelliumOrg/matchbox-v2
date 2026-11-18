import { createLogger } from "@matchbox/logger"
import { createMemoryRateLimitClient } from "@matchbox/server"
import {
  type StuartStreamEvent,
  stuartStreamEventSchema,
} from "@matchbox/stuart-ui/contract"
import { z } from "zod"
import type { StuartAppDeps } from "./app"
import { memoryAnswerCache } from "./query/answerCache"
import { fakeProviders, NOW } from "./query/fakes"
import { memorySpendBucket } from "./query/spend"

// Test wiring for the Hono app: fake providers, in-memory limiter, spend
// bucket and answer cache, and no network.

export const TEST_BLOCK = 12_482_113n

export type TestDeps = StuartAppDeps & {
  cache: ReturnType<typeof memoryAnswerCache>
  logs: Array<Record<string, unknown>>
}

export function testDeps(overrides: Partial<StuartAppDeps> = {}): TestDeps {
  const cache = memoryAnswerCache()
  const limiter = createMemoryRateLimitClient(() => NOW.getTime())
  const bucket = memorySpendBucket(() => NOW.getTime())
  const logs: Array<Record<string, unknown>> = []
  return {
    now: () => NOW,
    logger: createLogger({
      sink: (_level, line) => {
        const parsed = z
          .record(z.string(), z.unknown())
          .safeParse(JSON.parse(line))
        if (parsed.success) logs.push(parsed.data)
      },
      format: "json",
    }),
    providers: () => fakeProviders(),
    snapshotBlock: async () => TEST_BLOCK,
    limiter: () => limiter,
    spendBucket: () => bucket,
    answerCache: () => cache,
    messageCreator: () => async () => {
      throw new Error("unexpected Claude call")
    },
    supportFetch: async () => new Response("null", { status: 500 }),
    ...overrides,
    cache,
    logs,
  }
}

export const SESSION = "6f1c1b8e-3c55-4a3f-9b8a-1d2e3f4a5b6c"

export function chatBody(
  query: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    version: 1,
    query,
    sessionId: SESSION,
    turn: 0,
    surface: "palette",
    chainId: 31_612,
    ...extra,
  })
}

export function post(
  path: string,
  init: { body: string; headers?: Record<string, string> },
): Request {
  return new Request(`https://matchbox-stuart.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...init.headers },
    body: init.body,
  })
}

export type SseFrame = { event: string; data: StuartStreamEvent }

/** Parses an SSE body into frames, validating each against the contract. */
export async function readSse(response: Response): Promise<SseFrame[]> {
  const text = await response.text()
  return text
    .split(/\n\n+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const lines = chunk.split("\n")
      const event =
        lines
          .find((line) => line.startsWith("event:"))
          ?.slice(6)
          .trim() ?? ""
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
      return { event, data: stuartStreamEventSchema.parse(JSON.parse(data)) }
    })
}
