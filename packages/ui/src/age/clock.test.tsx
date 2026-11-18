import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { resetClock } from "./clock"
import { Root } from "./index"

afterEach(() => {
  cleanup()
  resetClock()
  vi.useRealTimers()
})

const timestamp = Date.UTC(2026, 10, 8, 11, 53, 40) / 1000

describe("the shared age clock", () => {
  it("runs one timer for a page of ages", () => {
    vi.useFakeTimers()
    vi.setSystemTime((timestamp + 10) * 1000)
    render(
      <ul>
        {Array.from({ length: 50 }, (_, index) => timestamp - index * 60).map(
          (at) => (
            <li key={at}>
              <Root timestamp={at} now={timestamp} />
            </li>
          ),
        )}
      </ul>,
    )
    expect(vi.getTimerCount()).toBe(1)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText("11s")).toBeTruthy()
    expect(vi.getTimerCount()).toBe(1)
  })

  it("slows down once every age is over a minute old", () => {
    vi.useFakeTimers()
    vi.setSystemTime((timestamp + 3600) * 1000)
    render(<Root timestamp={timestamp} now={timestamp} />)
    expect(screen.getByText("1h")).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(59_000)
    })
    // No tick before a minute: the 1h age cannot have changed.
    expect(screen.getByText("1h")).toBeTruthy()
  })

  it("stops the timer when the last age leaves", () => {
    vi.useFakeTimers()
    const { unmount } = render(<Root timestamp={timestamp} now={timestamp} />)
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("reserves its width so a corrected age moves nothing", () => {
    render(<Root timestamp={timestamp} now={timestamp + 4} suffix />)
    expect(screen.getByRole("time").className).toContain("min-w-[7ch]")
  })
})
