import { createHeadStore } from "@matchbox/live/heads"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import * as shapes from "./detect"
import { useDetect } from "./use-detect"

describe("palette detection", () => {
  it("runs once per query, not once per head", () => {
    const spy = vi.spyOn(shapes, "detect")
    const store = createHeadStore({ number: 100, receivedAt: 0 })
    const { result, rerender } = renderHook(
      ({ query }) => useDetect(query, store, 47),
      { initialProps: { query: "47" } },
    )
    expect(result.current.map((target) => target.kind)).toEqual([
      "epoch",
      "lock",
      "lock",
      "block",
    ])
    for (let block = 101; block < 140; block += 1) {
      act(() => store.set(block))
      rerender({ query: "47" })
    }
    expect(spy).toHaveBeenCalledTimes(1)
    rerender({ query: "48" })
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })
})
