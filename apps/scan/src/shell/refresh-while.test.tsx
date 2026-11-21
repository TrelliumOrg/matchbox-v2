import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The re-read hook of the transaction page and its not-found view
// (entity-not-found.tsx): what it re-reads, and how long it waits.

type Filter = (match: { routeId: string }) => boolean

const invalidate = vi.fn((_options?: { filter?: Filter }) => Promise.resolve())
/** One router, as the app has. */
const router = { invalidate }

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useRouter: () => router,
}))

const { useRefreshWhile } = await import("./entity-not-found")

/** Each test's own keys: the hook keeps its waits across mounts. */
let keyNumber = 0
const freshKey = (): string => {
  keyNumber += 1
  return `wait:test-${keyNumber}`
}

const minute = 60_000

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  invalidate.mockClear()
  setVisibility("visible")
})

afterEach(() => {
  vi.useRealTimers()
  setVisibility("visible")
})

async function run(ms: number): Promise<void> {
  await act(() => vi.advanceTimersByTimeAsync(ms))
}

describe("useRefreshWhile", () => {
  it("re-reads only the transaction route, not the shell", async () => {
    const key = freshKey()
    renderHook(() => useRefreshWhile(key, true, minute))
    await run(2_000)
    expect(invalidate).toHaveBeenCalledTimes(1)
    const filter = invalidate.mock.calls[0]?.[0]?.filter
    if (filter === undefined) throw new Error("no filter")
    expect(filter({ routeId: "/tx/$hash" })).toBe(true)
    expect(filter({ routeId: "__root__" })).toBe(false)
    expect(filter({ routeId: "/address/$address" })).toBe(false)
  })

  it("gives up after its wait, and a new hash starts a wait of its own", async () => {
    const first = freshKey()
    const second = freshKey()
    const { result, rerender } = renderHook(
      ({ key }) => useRefreshWhile(key, true, minute),
      { initialProps: { key: first } },
    )
    expect(result.current).toBe(false)
    await run(2 * minute)
    expect(result.current).toBe(true)
    rerender({ key: second })
    expect(result.current).toBe(false)
    const before = invalidate.mock.calls.length
    await run(2_000)
    expect(invalidate.mock.calls.length).toBe(before + 1)
    expect(result.current).toBe(false)
  })

  it("waits again for a hash it gave up on, when shown anew", async () => {
    const key = freshKey()
    const first = renderHook(() => useRefreshWhile(key, true, minute))
    await run(2 * minute)
    expect(first.result.current).toBe(true)
    first.unmount()
    invalidate.mockClear()
    const again = renderHook(() => useRefreshWhile(key, true, minute))
    await run(0)
    expect(again.result.current).toBe(false)
    await run(2_000)
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(again.result.current).toBe(false)
  })

  it("carries a running wait on across a fresh mount", async () => {
    const key = freshKey()
    const first = renderHook(() => useRefreshWhile(key, true, minute))
    // Re-reads at 2, 5, 9, 14, 22 and 32 s of waiting.
    await run(40_000)
    first.unmount()
    const again = renderHook(() => useRefreshWhile(key, true, minute))
    // Then 47 and 67 s: a fresh wait would be at 32 s by now.
    await run(40_000)
    expect(again.result.current).toBe(true)
  })

  it("neither re-reads nor runs down its wait while the tab is hidden", async () => {
    const key = freshKey()
    const { result } = renderHook(() => useRefreshWhile(key, true, minute))
    setVisibility("hidden")
    await run(10 * minute)
    expect(invalidate).not.toHaveBeenCalled()
    expect(result.current).toBe(false)
    setVisibility("visible")
    await run(30_000)
    expect(invalidate).toHaveBeenCalled()
    expect(result.current).toBe(false)
    await run(minute)
    expect(result.current).toBe(true)
  })

  it("does nothing while inactive", async () => {
    const key = freshKey()
    const { result } = renderHook(() => useRefreshWhile(key, false, minute))
    await run(2 * minute)
    expect(invalidate).not.toHaveBeenCalled()
    expect(result.current).toBe(false)
  })
})
