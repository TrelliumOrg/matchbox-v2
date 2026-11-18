import { act, cleanup, render, renderHook } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { parseFigure } from "./count-up"
import { exitMs, sheetExitMs } from "./easing"
import { indicatorSlide } from "./indicator"
import { useLeaving } from "./presence"
import { usePresenceList } from "./presence-list"
import { indicatorStep, motionStep, presets } from "./presets"

function mockReducedMotion(reduce: boolean): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes("reduce"),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) satisfies MediaQueryList,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("presets", () => {
  it("keeps exits quicker than entries and sheets within 400ms", () => {
    for (const preset of Object.values(presets)) {
      const enter = Number(preset.enter.options.duration)
      const exit = Number(preset.exit.options.duration)
      expect(enter).toBeLessThanOrEqual(400)
      expect(exit).toBeLessThanOrEqual(enter)
    }
  })

  it("animates only transform and opacity", () => {
    for (const preset of Object.values(presets)) {
      for (const frame of [
        ...preset.enter.keyframes,
        ...preset.exit.keyframes,
      ]) {
        for (const property of Object.keys(frame)) {
          expect(["transform", "opacity", "offset", "easing"]).toContain(
            property,
          )
        }
      }
    }
  })

  it("reduces surfaces to a short fade and movement to nothing", () => {
    const sheet = motionStep("sheet", "exit", true)
    expect(sheet?.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }])
    expect(Number(sheet?.options.duration)).toBeLessThanOrEqual(120)
    expect(motionStep("popover", "enter", true)?.keyframes).toEqual([
      { opacity: 0 },
      { opacity: 1 },
    ])
    expect(motionStep("list", "enter", true)).toBeNull()
    expect(motionStep("indicator", "enter", true)).toBeNull()
    expect(motionStep("sheet", "enter", false)).toBe(presets.sheet.enter)
  })

  it("reads reduced motion from the media query by default", () => {
    mockReducedMotion(true)
    expect(motionStep("list", "exit")).toBeNull()
    mockReducedMotion(false)
    expect(motionStep("list", "exit")).toBe(presets.list.exit)
  })

  it("slides an indicator with a transform, or not at all when reduced", () => {
    const from = { left: 10, width: 40 }
    const to = { left: 90, width: 80 }
    expect(indicatorStep(from, to, false)?.keyframes[0]).toEqual({
      transform: "translateX(-80px) scaleX(0.5)",
    })
    expect(indicatorStep(from, to, true)).toBeNull()
  })
})

describe("indicatorSlide", () => {
  it("slides a list marker in two dimensions with a transform only", () => {
    const from = { left: 0, top: 100, width: 200, height: 40 }
    const to = { left: 0, top: 160, width: 200, height: 50 }
    const step = indicatorSlide(from, to, false)
    expect(step?.keyframes).toEqual([
      { transform: "translate(0px, -60px) scale(1, 0.8)" },
      { transform: "none" },
    ])
    expect(Number(step?.options.duration)).toBeLessThanOrEqual(400)
  })

  it("jumps under reduced motion or when a list is hidden", () => {
    const rect = { left: 0, top: 0, width: 10, height: 10 }
    const hidden = { left: 0, top: 0, width: 0, height: 0 }
    expect(indicatorSlide(rect, rect, true)).toBeNull()
    expect(indicatorSlide(hidden, rect, false)).toBeNull()
    expect(indicatorSlide(rect, hidden, false)).toBeNull()
  })
})

describe("useLeaving", () => {
  it("keeps a closed value for its exit, then drops it", () => {
    vi.useFakeTimers()
    mockReducedMotion(false)
    const { result, rerender } = renderHook(
      ({ value }: { value: string | null }) => useLeaving(value),
      { initialProps: { value: "send" as string | null } },
    )
    expect(result.current).toEqual(["send", false])
    rerender({ value: null })
    expect(result.current).toEqual(["send", true])
    act(() => vi.advanceTimersByTime(sheetExitMs))
    expect(result.current).toEqual([null, false])
  })

  it("reopening during the exit cancels it", () => {
    vi.useFakeTimers()
    mockReducedMotion(false)
    const { result, rerender } = renderHook(
      ({ value }: { value: boolean }) => useLeaving(value),
      { initialProps: { value: true } },
    )
    rerender({ value: false })
    expect(result.current).toEqual([true, true])
    rerender({ value: true })
    act(() => vi.advanceTimersByTime(sheetExitMs))
    expect(result.current).toEqual([true, false])
  })

  it("drops at once under reduced motion", () => {
    mockReducedMotion(true)
    const { result, rerender } = renderHook(
      ({ value }: { value: string | null }) => useLeaving(value),
      { initialProps: { value: "send" as string | null } },
    )
    rerender({ value: null })
    expect(result.current).toEqual([null, false])
  })
})

function List({ items }: { items: string[] }): ReactNode {
  const shown = usePresenceList([...items], (item) => item)
  return createElement("p", null, shown.map((entry) => entry.key).join())
}

describe("usePresenceList", () => {
  const key = (item: string): string => item

  it("keeps a removed item, marked leaving, at its place", () => {
    vi.useFakeTimers()
    mockReducedMotion(false)
    const { result, rerender } = renderHook(
      ({ items }: { items: string[] }) => usePresenceList(items, key),
      { initialProps: { items: ["a", "b", "c"] } },
    )
    rerender({ items: ["a", "c"] })
    expect(result.current.map((entry) => [entry.key, entry.leaving])).toEqual([
      ["a", false],
      ["b", true],
      ["c", false],
    ])
    act(() => vi.advanceTimersByTime(exitMs))
    expect(result.current.map((entry) => entry.key)).toEqual(["a", "c"])
  })

  it("does not keep items under reduced motion or on a wholesale swap", () => {
    mockReducedMotion(true)
    const reduced = renderHook(
      ({ items }: { items: string[] }) => usePresenceList(items, key),
      { initialProps: { items: ["a", "b"] } },
    )
    reduced.rerender({ items: ["a"] })
    expect(reduced.result.current.map((entry) => entry.key)).toEqual(["a"])
    mockReducedMotion(false)
    const swapped = renderHook(
      ({ items }: { items: string[] }) => usePresenceList(items, key),
      { initialProps: { items: ["a", "b"] } },
    )
    swapped.rerender({ items: ["x", "y"] })
    expect(swapped.result.current.map((entry) => entry.key)).toEqual(["x", "y"])
  })

  it("renders without looping when the array is rebuilt every render", () => {
    mockReducedMotion(false)
    const view = render(createElement(List, { items: ["a", "b"] }))
    view.rerender(createElement(List, { items: ["a", "b"] }))
    expect(view.container.textContent).toBe("a,b")
  })
})

describe("parseFigure", () => {
  it("reads a headline into prefix, value and places", () => {
    expect(parseFigure("$1,284.40")).toEqual({
      prefix: "$",
      suffix: "",
      value: 1284.4,
      places: 2,
    })
    expect(parseFigure(" $89,854 ")).toEqual({
      prefix: "$",
      suffix: "",
      value: 89854,
      places: 0,
    })
    expect(parseFigure("12.5%")?.suffix).toBe("%")
    expect(parseFigure("None")).toBeNull()
  })
})
