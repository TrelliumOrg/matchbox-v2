import { describe, expect, it } from "vitest"
import { canShift, shiftWindow, windowFor, windowLabel } from "./epoch-window"

// Epochs 0 to 47: indexes equal epoch numbers.
const epochs = Array.from({ length: 48 }, (_, index) => index)
const count = epochs.length

describe("epoch windows", () => {
  it("defaults to the page ending on the latest epoch", () => {
    const page = windowFor(47, count, 12)
    expect(page).toEqual({ start: 36, end: 47 })
    expect(windowLabel(epochs, page)).toBe("Epoch 36 to 47")
  })

  it("follows the selection to its page", () => {
    expect(windowFor(36, count, 12)).toEqual({ start: 36, end: 47 })
    expect(windowFor(35, count, 12)).toEqual({ start: 24, end: 35 })
    expect(windowFor(5, count, 12)).toEqual({ start: 0, end: 11 })
  })

  it("keeps the earliest page full when the pages don't divide evenly", () => {
    // 48 epochs in pages of 10 from the latest: 38-47 ... 8-17, then 0-9.
    expect(windowFor(3, count, 10)).toEqual({ start: 0, end: 9 })
    expect(windowFor(8, count, 10)).toEqual({ start: 8, end: 17 })
  })

  it("moves a page at a time and stops at both ends", () => {
    const latest = windowFor(47, count, 12)
    const earlier = shiftWindow(latest, -1, count, 12)
    expect(earlier).toEqual({ start: 24, end: 35 })
    expect(shiftWindow(earlier, 1, count, 12)).toEqual(latest)
    expect(shiftWindow(latest, 1, count, 12)).toEqual(latest)
    expect(shiftWindow(latest, -9, count, 12)).toEqual({ start: 0, end: 11 })
    expect(canShift(latest, 1, count)).toBe(false)
    expect(canShift(latest, -1, count)).toBe(true)
    expect(canShift({ start: 0, end: 11 }, -1, count)).toBe(false)
  })

  it("pages phones by 6", () => {
    const page = windowFor(47, count, 6)
    expect(windowLabel(epochs, page)).toBe("Epoch 42 to 47")
    expect(windowLabel(epochs, shiftWindow(page, -1, count, 6))).toBe(
      "Epoch 36 to 41",
    )
  })

  it("shows every epoch when there are fewer than a page", () => {
    const few = [45, 46, 47]
    const page = windowFor(2, few.length, 12)
    expect(page).toEqual({ start: 0, end: 2 })
    expect(windowLabel(few, page)).toBe("Epoch 45 to 47")
  })

  it("picks the latest page for a selection outside the series", () => {
    expect(windowFor(-1, count, 12)).toEqual({ start: 36, end: 47 })
  })
})
