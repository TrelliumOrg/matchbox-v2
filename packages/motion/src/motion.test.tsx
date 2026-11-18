import { act, cleanup, renderHook } from "@testing-library/react"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import {
  duration,
  easing,
  hapticPatterns,
  hapticsStorageKey,
  preloadHaptics,
  readHapticsSetting,
  setHapticsSetting,
  useHaptics,
  useHapticsSetting,
  useReducedMotion,
  writeHapticsSetting,
} from "./index"

const trigger = vi.fn(async () => {})

vi.mock("web-haptics", () => ({
  WebHaptics: class {
    static readonly isSupported = true
    trigger = trigger
  },
}))

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

beforeAll(async () => {
  await preloadHaptics()
})

beforeEach(() => {
  window.localStorage.clear()
  trigger.mockClear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("constants", () => {
  it("uses the guideline curves and timings", () => {
    expect(easing.roll).toBe("cubic-bezier(.2,.8,.2,1)")
    expect(easing.text).toBe("cubic-bezier(.19,1,.22,1)")
    expect(duration.roll).toBe(380)
    expect(duration.flip).toBe(360)
    expect(duration.roll).toBeLessThan(duration.max)
  })

  it("has the four haptic patterns, sharp ticks only", () => {
    expect(hapticPatterns).toEqual({
      pick: [8],
      success: [10, 70, 14],
      error: [12, 45, 12, 45, 12],
      nudge: [14, 55, 8],
    })
  })
})

describe("Haptics setting", () => {
  it("defaults to on, including when storage is missing or throws", () => {
    expect(readHapticsSetting(null)).toBe(true)
    expect(readHapticsSetting(window.localStorage)).toBe(true)
    expect(
      readHapticsSetting({
        getItem: () => {
          throw new Error("blocked")
        },
      }),
    ).toBe(true)
  })

  it("stores on and off", () => {
    writeHapticsSetting(window.localStorage, false)
    expect(window.localStorage.getItem(hapticsStorageKey)).toBe("off")
    expect(readHapticsSetting(window.localStorage)).toBe(false)
    writeHapticsSetting(window.localStorage, true)
    expect(readHapticsSetting(window.localStorage)).toBe(true)
  })

  it("updates every subscriber when toggled", () => {
    const { result } = renderHook(() => useHapticsSetting())
    expect(result.current[0]).toBe(true)
    act(() => result.current[1](false))
    expect(result.current[0]).toBe(false)
    expect(window.localStorage.getItem(hapticsStorageKey)).toBe("off")
    act(() => setHapticsSetting(true))
    expect(result.current[0]).toBe(true)
  })
})

describe("useHaptics", () => {
  it("fires each pattern at intensity 1", () => {
    const { result } = renderHook(() => useHaptics())
    result.current.pick()
    result.current.success()
    result.current.error()
    result.current.nudge()
    expect(trigger.mock.calls).toEqual([
      [[8], { intensity: 1 }],
      [[10, 70, 14], { intensity: 1 }],
      [[12, 45, 12, 45, 12], { intensity: 1 }],
      [[14, 55, 8], { intensity: 1 }],
    ])
  })

  it("does nothing while the Haptics setting is off", () => {
    const { result } = renderHook(() => useHaptics())
    act(() => setHapticsSetting(false))
    expect(result.current.enabled).toBe(false)
    result.current.pick()
    result.current.success()
    expect(trigger).not.toHaveBeenCalled()
  })

  it("still fires under reduced motion, which only governs visuals", () => {
    mockReducedMotion(true)
    const { result } = renderHook(() => ({
      haptics: useHaptics(),
      reduced: useReducedMotion(),
    }))
    expect(result.current.reduced).toBe(true)
    result.current.haptics.pick()
    expect(trigger).toHaveBeenCalledWith([8], { intensity: 1 })
  })
})

describe("useReducedMotion", () => {
  it("reads prefers-reduced-motion", () => {
    mockReducedMotion(false)
    expect(renderHook(() => useReducedMotion()).result.current).toBe(false)
    cleanup()
    mockReducedMotion(true)
    expect(renderHook(() => useReducedMotion()).result.current).toBe(true)
  })
})
