import { describe, expect, it } from "vitest"
import {
  type FetchLike,
  fixtureTransport,
  httpTransport,
  toStreamEvent,
} from "./client"
import type { StuartRequest, StuartStreamEvent } from "./contract"
import { fixtureTurn } from "./fixtures"

const request: StuartRequest = {
  version: 1,
  query: "Which gauges pay best this epoch?",
  sessionId: "6f1c1b8e-3c55-4a3f-9b8a-1d2e3f4a5b6c",
  turn: 0,
  surface: "composer",
  chainId: 31_612,
}

function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

function sse(event: StuartStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

async function collect(fetchImpl: FetchLike): Promise<{
  events: StuartStreamEvent[]
  calls: { url: string; init: RequestInit }[]
}> {
  const events: StuartStreamEvent[] = []
  const calls: { url: string; init: RequestInit }[] = []
  const send = httpTransport("https://stuart.example/", (url, init) => {
    calls.push({ url, init })
    return fetchImpl(url, init)
  })
  await send(request, new AbortController().signal, (event) =>
    events.push(event),
  )
  return { events, calls }
}

describe("httpTransport", () => {
  it("posts the request and validates each streamed event, ignoring bad ones", async () => {
    const answer = fixtureTurn(request).response
    const body = [
      sse({ type: "status", text: "Reading 34 gauges" }),
      "event: status\ndata: {not json}\n\n",
      'event: status\ndata: {"type":"status","text":42}\n\n',
      'event: answer\ndata: {"type":"status","text":"mismatched name"}\n\n',
      sse({ type: "answer", response: answer, cached: true }),
      sse({ type: "done" }),
      sse({ type: "status", text: "after done" }),
    ].join("")
    const chunks: string[] = []
    for (let at = 0; at < body.length; at += 97)
      chunks.push(body.slice(at, at + 97))
    const { events, calls } = await collect(
      async () =>
        new Response(streamOf(chunks), {
          headers: { "content-type": "text/event-stream" },
        }),
    )
    expect(calls[0]?.url).toBe("https://stuart.example/chat")
    expect(calls[0]?.init.method).toBe("POST")
    expect(new Headers(calls[0]?.init.headers).get("accept")).toBe(
      "text/event-stream",
    )
    expect(events.map((event) => event.type)).toEqual([
      "status",
      "answer",
      "done",
    ])
  })

  it("turns a busy error envelope into a busy event", async () => {
    const { events } = await collect(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "busy", message: "Busy", retryAfterSeconds: 30 },
          }),
          { status: 503 },
        ),
    )
    expect(events).toEqual([
      { type: "busy", reason: "model_busy", retryAfterSeconds: 30 },
    ])
  })

  it("treats 429 as rate limited and other failures as errors", async () => {
    const limited = await collect(async () => new Response("", { status: 429 }))
    expect(limited.events[0]).toEqual({
      type: "busy",
      reason: "rate_limited",
      retryAfterSeconds: null,
    })
    const broken = await collect(
      async () => new Response("nope", { status: 500 }),
    )
    expect(broken.events[0]).toMatchObject({ type: "error", code: "internal" })
  })

  it("rejects a request that fails the contract before sending", async () => {
    const send = httpTransport("https://stuart.example", async () => {
      throw new Error("should not be called")
    })
    await expect(
      send({ ...request, query: "" }, new AbortController().signal, () => {}),
    ).rejects.toThrow()
  })
})

describe("toStreamEvent", () => {
  it("accepts unnamed messages and rejects mismatched names", () => {
    expect(toStreamEvent("message", '{"type":"done"}')).toEqual({
      type: "done",
    })
    expect(toStreamEvent("status", '{"type":"done"}')).toBeNull()
    expect(toStreamEvent("done", "")).toBeNull()
  })

  it("skips unknown block types but keeps the answer", () => {
    const response = fixtureTurn(request).response
    const future = {
      type: "answer",
      cached: false,
      response: {
        ...response,
        uiBlocks: [
          ...response.uiBlocks,
          { type: "hologram", version: 9, id: "b.future", evidenceRefs: [] },
        ],
      },
    }
    const event = toStreamEvent("answer", JSON.stringify(future))
    expect(event?.type).toBe("answer")
    if (event?.type !== "answer") return
    expect(event.response.uiBlocks.map((block) => block.type)).toEqual([
      "activity_trace",
      "gauge_ranking",
    ])
  })

  it("reads an intent this build does not know as unsupported", () => {
    const response = fixtureTurn(request).response
    const future = {
      type: "answer",
      cached: false,
      response: { ...response, intent: "time_travel" },
    }
    const event = toStreamEvent("answer", JSON.stringify(future))
    expect(event?.type).toBe("answer")
    if (event?.type !== "answer") return
    expect(event.response.intent).toBe("unsupported")
    expect(event.response.answer.text).toBe(response.answer.text)
  })
})

describe("fixtureTransport", () => {
  it("plays status lines, an answer and done", async () => {
    const events: StuartStreamEvent[] = []
    await fixtureTransport(0)(request, new AbortController().signal, (event) =>
      events.push(event),
    )
    expect(events.at(0)?.type).toBe("status")
    expect(events.at(-2)?.type).toBe("answer")
    expect(events.at(-1)?.type).toBe("done")
  })

  it("stops when aborted", async () => {
    const controller = new AbortController()
    const events: StuartStreamEvent[] = []
    const run = fixtureTransport(50)(request, controller.signal, (event) =>
      events.push(event),
    )
    controller.abort()
    await expect(run).rejects.toBeDefined()
    expect(events.some((event) => event.type === "answer")).toBe(false)
  })
})
