import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
  keyboardInset,
  keyboardInsetProperty,
  useKeyboardInset,
} from "./keyboard-inset"

afterEach(cleanup)

describe("keyboardInset", () => {
  it("is what the keyboard covers of the layout viewport", () => {
    // iPhone, keyboard up: 844 tall page, 508 visible.
    expect(keyboardInset(844, { height: 508, offsetTop: 0 })).toBe(336)
    // The page scrolled within the visual viewport.
    expect(keyboardInset(844, { height: 508, offsetTop: 100 })).toBe(236)
  })

  it("is 0 without a keyboard, whatever the rounding", () => {
    expect(keyboardInset(844, { height: 844, offsetTop: 0 })).toBe(0)
    expect(keyboardInset(844, { height: 830.5, offsetTop: 0 })).toBe(0)
    expect(keyboardInset(844, { height: 900, offsetTop: 0 })).toBe(0)
  })
})

function Sheet(): null {
  useKeyboardInset()
  return null
}

describe("useKeyboardInset", () => {
  it("publishes the inset while a sheet is open and clears it after", () => {
    const listeners = new Map<string, () => void>()
    const viewport = {
      height: 844,
      offsetTop: 0,
      addEventListener: (type: string, listener: () => void) =>
        void listeners.set(type, listener),
      removeEventListener: (type: string) => void listeners.delete(type),
    }
    Object.defineProperty(window, "visualViewport", {
      value: viewport,
      configurable: true,
    })
    Object.defineProperty(window, "innerHeight", {
      value: 844,
      configurable: true,
    })
    const root = document.documentElement
    const first = render(<Sheet />)
    const second = render(<Sheet />)
    expect(root.style.getPropertyValue(keyboardInsetProperty)).toBe("0px")
    viewport.height = 508
    listeners.get("resize")?.()
    expect(root.style.getPropertyValue(keyboardInsetProperty)).toBe("336px")
    // Still published while one sheet remains.
    first.unmount()
    expect(root.style.getPropertyValue(keyboardInsetProperty)).toBe("336px")
    second.unmount()
    expect(root.style.getPropertyValue(keyboardInsetProperty)).toBe("")
    expect(listeners.size).toBe(0)
  })
})
