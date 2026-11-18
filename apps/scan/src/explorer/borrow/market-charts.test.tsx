import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Borrow's market charts, read after first paint: one request for every
 * market, one automatic retry for a chart whose series failed, then its
 * own "Try again", and no answer kept that a retry would need to replace.
 */

const reads = vi.hoisted(() => ({
  answers: [] as (Record<string, { status: string }> | "throw")[],
  count: 0,
}))

vi.mock("../../data/borrow", () => ({
  getBorrowCharts: async () => {
    reads.count += 1
    // Answered on a later task, as a request is.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const answer = reads.answers.shift() ?? {
      a: { status: "ok", data: { points: [] } },
      b: { status: "ok", data: { points: [] } },
    }
    if (answer === "throw") throw new Error("offline")
    return answer
  },
}))

vi.mock("./series-drawing", () => ({ default: () => null }))

const { useMarketChart, retryAfterMs } = await import("./market-charts")
const { forgetCharts, readCharts } = await import("./charts-read")

const markets = [
  { id: "a", decimals: 18 },
  { id: "b", decimals: 6 },
]

function both() {
  return renderHook(() => ({
    a: useMarketChart("a", { range: "30d" }, markets),
    b: useMarketChart("b", { range: "30d" }, markets),
  }))
}

afterEach(() => {
  reads.answers = []
  reads.count = 0
  forgetCharts()
  vi.useRealTimers()
})

describe("Borrow's market charts", () => {
  it("ask once for every market, joining the page's request", async () => {
    void readCharts({ range: "30d" }, markets)
    const { result } = both()
    expect(result.current.a.series).toBe("waiting")
    await waitFor(() => expect(result.current.b.series).not.toBe("waiting"))
    expect(reads.count).toBe(1)
    expect(result.current.a.retry).toBeNull()
    // A whole answer is reused by a chart mounted again.
    const again = renderHook(() =>
      useMarketChart("a", { range: "30d" }, markets),
    )
    await waitFor(() => expect(again.result.current.series).not.toBe("waiting"))
    expect(reads.count).toBe(1)
  })

  it("try once more after a failed read, then offer Try again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const down = {
      a: { status: "unavailable" },
      b: { status: "ok", data: { points: [] } },
    }
    reads.answers = ["throw", down]
    const { result } = both()
    await waitFor(() => expect(result.current.a.series).not.toBe("waiting"))
    expect(reads.count).toBe(1)
    expect(result.current.a.retry).not.toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(retryAfterMs)
    })
    // Both charts' retries share one request.
    await waitFor(() => expect(reads.count).toBe(2))
    await waitFor(() =>
      expect(result.current.b.series).toMatchObject({ status: "ok" }),
    )
    const failed = result.current.a
    expect(failed.series).toEqual({ status: "unavailable" })
    // No third automatic read: "Try again" is the reader's.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(retryAfterMs * 2)
    })
    expect(reads.count).toBe(2)
    // The answer with a market missing was not kept: this asks again.
    act(() => failed.retry?.())
    expect(result.current.a.series).toBe("waiting")
    await waitFor(() =>
      expect(result.current.a.series).toMatchObject({ status: "ok" }),
    )
    expect(reads.count).toBe(3)
    expect(result.current.a.retry).toBeNull()
  })
})
