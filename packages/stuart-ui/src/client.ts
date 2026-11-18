import { z } from "zod"
import {
  intentSchema,
  STUART_PATHS,
  type StuartRequest,
  type StuartStreamEvent,
  stuartErrorSchema,
  stuartRequestSchema,
  stuartStreamEventSchema,
  uiBlockSchema,
} from "./contract"
import { createSseParser } from "./sse"

/**
 * Talks to the Stuart Worker. A transport sends one request and reports
 * every validated stream event; the session decides what they mean. With no
 * endpoint configured the fixture transport plays the Epoch 47 demo.
 */

export type StuartTransport = (
  request: StuartRequest,
  signal: AbortSignal,
  onEvent: (event: StuartStreamEvent) => void,
) => Promise<void>

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** JSON text to unknown, never throwing. Callers validate with zod. */
export function readJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text)
    return value
  } catch {
    return undefined
  }
}

const answerShapeSchema = z.looseObject({
  type: z.literal("answer"),
  response: z.looseObject({
    intent: z.string(),
    uiBlocks: z.array(z.unknown()),
  }),
})

/**
 * A newer Worker may send block types or intents this build does not know.
 * The answer still counts: unknown blocks are dropped, an unknown intent
 * reads as `unsupported` (the panel never branches on it), and the rest
 * must validate.
 */
function withKnownParts(value: unknown): StuartStreamEvent | null {
  const shape = answerShapeSchema.safeParse(value)
  if (!shape.success) return null
  const uiBlocks = shape.data.response.uiBlocks.filter(
    (block) => uiBlockSchema.safeParse(block).success,
  )
  const knownIntent = intentSchema.safeParse(shape.data.response.intent)
  if (
    uiBlocks.length === shape.data.response.uiBlocks.length &&
    knownIntent.success
  ) {
    return null
  }
  const parsed = stuartStreamEventSchema.safeParse({
    ...shape.data,
    response: {
      ...shape.data.response,
      intent: knownIntent.success ? knownIntent.data : "unsupported",
      uiBlocks,
    },
  })
  return parsed.success ? parsed.data : null
}

/** One SSE message to a stream event, or null when it does not validate. */
export function toStreamEvent(
  eventName: string,
  data: string,
): StuartStreamEvent | null {
  const value = readJson(data)
  const parsed = stuartStreamEventSchema.safeParse(value)
  if (!parsed.success) {
    const salvaged = withKnownParts(value)
    if (salvaged === null) return null
    if (eventName !== "message" && eventName !== salvaged.type) return null
    return salvaged
  }
  if (eventName !== "message" && eventName !== parsed.data.type) return null
  return parsed.data
}

export function trimEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "")
}

/** A non-2xx response as the stream event the panel shows. */
async function failure(response: Response): Promise<StuartStreamEvent> {
  const text = await response.text().catch(() => "")
  const parsed = stuartErrorSchema.safeParse(readJson(text))
  const retryAfterSeconds = parsed.success
    ? parsed.data.error.retryAfterSeconds
    : null
  if (
    response.status === 429 ||
    (parsed.success && parsed.data.error.code === "rate_limited")
  ) {
    return { type: "busy", reason: "rate_limited", retryAfterSeconds }
  }
  if (parsed.success && parsed.data.error.code === "busy") {
    return { type: "busy", reason: "model_busy", retryAfterSeconds }
  }
  if (parsed.success) {
    return {
      type: "error",
      code: parsed.data.error.code,
      message: parsed.data.error.message,
    }
  }
  return { type: "error", code: "internal", message: `HTTP ${response.status}` }
}

/** POST <endpoint>/chat, read the event stream as it arrives. */
export function httpTransport(
  endpoint: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): StuartTransport {
  const url = `${trimEndpoint(endpoint)}${STUART_PATHS.chat}`
  return async function send(request, signal, onEvent) {
    const body = stuartRequestSchema.parse(request)
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) {
      onEvent(await failure(response))
      return
    }
    if (response.body === null) {
      onEvent({ type: "error", code: "internal", message: "Empty response" })
      return
    }
    let finished = false
    const parser = createSseParser((message) => {
      if (finished) return
      const event = toStreamEvent(message.event, message.data)
      if (event === null) return
      onEvent(event)
      if (event.type === "done") finished = true
    })
    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader()
    try {
      while (!finished) {
        const { done, value } = await reader.read()
        if (done) break
        parser.push(value)
      }
    } finally {
      parser.end()
      await reader.cancel().catch(() => undefined)
    }
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    function onAbort(): void {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

/**
 * The Epoch 47 demo without a Worker: status lines, then a fixture answer
 * that passes the contract, then done. Fixtures load on first use.
 */
export function fixtureTransport(stepMs = 520): StuartTransport {
  return async function send(request, signal, onEvent) {
    const { fixtureTurn } = await import("./fixtures")
    const turn = fixtureTurn(request)
    for (const text of turn.status) {
      await wait(stepMs, signal)
      onEvent({ type: "status", text })
    }
    await wait(stepMs, signal)
    onEvent({ type: "answer", response: turn.response, cached: false })
    onEvent({ type: "done" })
  }
}

export function transportFor(endpoint: string | null): StuartTransport {
  return endpoint === null || endpoint === ""
    ? fixtureTransport()
    : httpTransport(endpoint)
}
