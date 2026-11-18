// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

/** The read-model client's optional deadline (Scan sets one; Pro none). */

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }))

vi.mock("cloudflare:workers", () => ({ env: state.env }))
vi.mock("@matchbox/logger", () => ({
  createLogger: () => ({ error: () => {}, warn: () => {}, info: () => {} }),
}))

const { createReadModelClient } = await import("./read-model.server")

/** An API binding that never answers until its request is aborted. */
function hangingApi(): AbortSignal[] {
  const signals: AbortSignal[] = []
  state.env.API = {
    fetch: (request: Request) => {
      signals.push(request.signal)
      return new Promise((_, reject) => {
        request.signal.addEventListener("abort", () =>
          reject(request.signal.reason),
        )
      })
    },
  }
  return signals
}

function client(timeoutMs?: number) {
  return createReadModelClient({
    prefix: "/internal/scan",
    fixtures: () => ({ status: 404, body: null }),
    service: "test",
    mode: () => "api",
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  })
}

beforeEach(() => {
  for (const key of Object.keys(state.env)) delete state.env[key]
})

describe("createReadModelClient", () => {
  it("rejects a read that never answers at its deadline", async () => {
    hangingApi()
    await expect(
      client(30).readModel("/head", z.object({})),
    ).rejects.toMatchObject({ name: "TimeoutError" })
  })

  it("sets no deadline unless asked", async () => {
    // A deadline is a timer or an AbortSignal.timeout. Fake the timers and
    // watch AbortSignal.timeout, then let an hour pass on the fake clock:
    // the read must still be waiting, however slow the machine.
    const signals = hangingApi()
    const timeout = vi.spyOn(AbortSignal, "timeout")
    vi.useFakeTimers()
    try {
      const pending = client().readModel("/head", z.object({}))
      void pending.catch(() => {})
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      expect(signals).toHaveLength(1)
      expect(signals[0]?.aborted).toBe(false)
      expect(timeout).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      timeout.mockRestore()
    }
  })
})
