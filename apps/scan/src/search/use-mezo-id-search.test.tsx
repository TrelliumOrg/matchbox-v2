import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const findMezoId = vi.fn()

vi.mock("../data/mezo-id", () => ({
  findMezoId: (input: { data: { q: string } }) => findMezoId(input),
}))

const { mezoIdQuery, useMezoIdSearch } = await import("./use-mezo-id-search")
const { searchDebounceMs } = await import("./use-remote-search")

const wallet = `0x${"7f".repeat(20)}`

describe("mezoIdQuery", () => {
  it("reads an ID, or a bare name, the name search would read", () => {
    expect(mezoIdQuery("alice.mezo")).toBe("alice.mezo")
    expect(mezoIdQuery("Alice")).toBe("alice.mezo")
    expect(mezoIdQuery("kiln")).toBe("kiln.mezo")
  })

  it("reads a mainnet Bitcoin address as itself, never as an ID", () => {
    const btc = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
    expect(mezoIdQuery(` ${btc.toUpperCase()} `)).toBe(btc)
    expect(mezoIdQuery("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).toBe(
      "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
    )
  })

  it("leaves numbers, hex and other shapes to their own readings", () => {
    for (const other of ["47", "13078795", "beef", "0x7f3a", "a", "lock 604"]) {
      expect(mezoIdQuery(other), other).toBeNull()
    }
  })
})

describe("useMezoIdSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    findMezoId.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("asks once per settled query, on the palette's debounce", async () => {
    findMezoId.mockResolvedValue({ mezoId: "alice.mezo", wallets: [wallet] })
    const { result, rerender } = renderHook(
      ({ query }) => useMezoIdSearch(query),
      { initialProps: { query: "al" } },
    )
    rerender({ query: "ali" })
    rerender({ query: "alice" })
    expect(result.current.status).toBe("loading")
    expect(findMezoId).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(searchDebounceMs)
    })
    expect(findMezoId).toHaveBeenCalledTimes(1)
    expect(findMezoId).toHaveBeenCalledWith({ data: { q: "alice.mezo" } })
    expect(result.current).toEqual({
      status: "done",
      match: { mezoId: "alice.mezo", wallets: [wallet] },
    })
    // Typing the suffix is the same ID: no second request.
    rerender({ query: "alice.mezo" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(searchDebounceMs)
    })
    expect(findMezoId).toHaveBeenCalledTimes(1)
  })

  it("asks nothing for a query that cannot be an ID", async () => {
    const { result } = renderHook(() => useMezoIdSearch("13078795"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(searchDebounceMs)
    })
    expect(findMezoId).not.toHaveBeenCalled()
    expect(result.current.status).toBe("idle")
  })

  it("ends quietly as no match when the lookup fails", async () => {
    findMezoId.mockRejectedValue(new Error("network"))
    const { result } = renderHook(() => useMezoIdSearch("alice.mezo"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(searchDebounceMs)
    })
    expect(result.current).toEqual({ status: "done", match: null })
  })
})
