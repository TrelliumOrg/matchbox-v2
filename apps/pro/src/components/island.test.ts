import { describe, expect, it } from "vitest"
import { sameValue, steadyProps } from "./island"

describe("whether an island's prop changed", () => {
  it("compares plain data by value", () => {
    expect(sameValue({ a: [1, 2] }, { a: [1, 2] })).toBe(true)
    expect(sameValue({ a: [1, 2] }, { a: [1, 3] })).toBe(false)
    expect(sameValue("a", "a")).toBe(true)
    expect(sameValue(1, 2)).toBe(false)
  })

  it("sees a Map or a Set change: JSON alone writes both as {}", () => {
    expect(
      sameValue(new Map([["kiln", 7000]]), new Map([["kiln", 7000]])),
    ).toBe(true)
    expect(
      sameValue(new Map([["kiln", 7000]]), new Map([["kiln", 5000]])),
    ).toBe(false)
    expect(sameValue(new Set(["a"]), new Set(["b"]))).toBe(false)
    expect(
      sameValue({ picks: new Map([["a", 1]]) }, { picks: new Map() }),
    ).toBe(false)
  })

  it("compares bigints by value instead of giving up", () => {
    expect(sameValue({ gain: 12n }, { gain: 12n })).toBe(true)
    expect(sameValue({ gain: 12n }, { gain: 13n })).toBe(false)
  })

  it("compares functions by identity", () => {
    const run = (): void => {}
    expect(sameValue(run, run)).toBe(true)
    expect(sameValue(run, () => {})).toBe(false)
  })
})

describe("an island's function props", () => {
  it("keeps one wrapper per prop and calls the latest function through it", () => {
    const wrappers = new Map<string, (...args: unknown[]) => unknown>()
    const first = { locks: ["2207"], onPick: (id: string) => `first ${id}` }
    const latest = { current: first }
    const steady = steadyProps(first, latest, wrappers)
    // Data passes through untouched.
    expect(steady.locks).toBe(first.locks)
    expect(steady.onPick("2207")).toBe("first 2207")

    // The parent renders again with a new inline function.
    const second = {
      locks: first.locks,
      onPick: (id: string) => `second ${id}`,
    }
    latest.current = second
    const again = steadyProps(second, latest, wrappers)
    // Same wrapper, so the section sees no change and is not rendered again,
    expect(again.onPick).toBe(steady.onPick)
    expect(sameValue(again.locks, steady.locks)).toBe(true)
    // and the wrapper it already holds calls the new function.
    expect(steady.onPick("2207")).toBe("second 2207")
  })

  it("does nothing when the function is gone", () => {
    const wrappers = new Map<string, (...args: unknown[]) => unknown>()
    const props: { onPick?: () => string } = { onPick: () => "picked" }
    const latest = { current: props }
    const steady = steadyProps(props, latest, wrappers)
    latest.current = {}
    expect(steady.onPick?.()).toBeUndefined()
  })
})
