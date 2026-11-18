import { act, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { lockupFoldDelay, lockupFoldKey, Pro, Root } from "./index"

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: reduce && query.includes("reduce"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  )
}

afterEach(() => {
  window.sessionStorage.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("lockup fold", () => {
  it("shows the full lockup, then folds once per session", () => {
    vi.useFakeTimers()
    stubReducedMotion(false)
    const { container } = render(<Pro collapse="fold" />)
    const svg = container.querySelector("svg")
    expect(svg?.hasAttribute("data-lockup-fold")).toBe(true)
    expect(svg?.hasAttribute("data-folded")).toBe(false)
    expect(svg?.getAttribute("aria-label")).toBe("Matchbox Pro")
    act(() => vi.advanceTimersByTime(lockupFoldDelay))
    expect(svg?.hasAttribute("data-folded")).toBe(true)
    expect(window.sessionStorage.getItem(lockupFoldKey)).toBe("1")
  })

  it("starts folded later in the session", () => {
    vi.useFakeTimers()
    stubReducedMotion(false)
    window.sessionStorage.setItem(lockupFoldKey, "1")
    const { container } = render(<Root product="id" collapse="fold" />)
    expect(container.querySelector("svg")?.hasAttribute("data-folded")).toBe(
      true,
    )
  })

  it("starts folded under reduced motion, with no wait", () => {
    vi.useFakeTimers()
    stubReducedMotion(true)
    const { container } = render(<Root product="developer" collapse="fold" />)
    expect(container.querySelector("svg")?.hasAttribute("data-folded")).toBe(
      true,
    )
  })

  it("keeps the full width while folded, and no fold by default", () => {
    vi.useFakeTimers()
    stubReducedMotion(true)
    const folded = render(<Pro collapse="fold" height={22} />)
    const plain = render(<Pro height={22} />)
    expect(folded.container.querySelector("svg")?.getAttribute("width")).toBe(
      plain.container.querySelector("svg")?.getAttribute("width"),
    )
    expect(
      plain.container.querySelector("svg")?.hasAttribute("data-lockup-fold"),
    ).toBe(false)
  })
})
