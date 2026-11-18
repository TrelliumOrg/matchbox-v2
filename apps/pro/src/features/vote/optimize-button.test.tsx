import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { OptimizeState } from "./ballot-panel"
import { appliedLine, OptimizeButton } from "./optimize-button"

const applied: OptimizeState = {
  kind: "optimized",
  applied: { wasMicro: 8_750_000n, gainMicro: 1_200_000n },
}

describe("what Optimize changed", () => {
  it("says what the ballot projected before and what was added", () => {
    expect(appliedLine({ wasMicro: 8_750_000n, gainMicro: 1_200_000n })).toBe(
      "Was $8.75, +$1.20",
    )
  })

  it("leaves the gain out when there was none to show", () => {
    expect(appliedLine({ wasMicro: 8_750_000n, gainMicro: 0n })).toBe(
      "Was $8.75",
    )
    expect(appliedLine({ wasMicro: 8_750_000n, gainMicro: -10n })).toBe(
      "Was $8.75",
    )
  })
})

describe("the Optimize button", () => {
  it("shows the gain before it is pressed and applies on a press", () => {
    const onOptimize = vi.fn()
    render(
      <OptimizeButton
        state={{ kind: "ready", gainMicro: 1_200_000n }}
        onOptimize={onOptimize}
        onUndo={vi.fn()}
        compact={false}
      />,
    )
    const button = screen.getByRole("button", { name: /Optimize/ })
    expect(button.textContent).toContain("+$1.20")
    fireEvent.click(button)
    expect(onOptimize).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull()
  })

  it("in the rail, says what changed and offers the way back", () => {
    const onUndo = vi.fn()
    render(
      <OptimizeButton
        state={applied}
        onUndo={onUndo}
        onOptimize={vi.fn()}
        compact={false}
      />,
    )
    expect(screen.getByRole("status").textContent).toBe("Was $8.75, +$1.20")
    expect(
      screen
        .getByRole("button", { name: "Optimized" })
        .getAttribute("aria-disabled"),
    ).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it("in the bar, the button itself becomes Undo", () => {
    const onUndo = vi.fn()
    const onOptimize = vi.fn()
    render(
      <OptimizeButton
        state={applied}
        onUndo={onUndo}
        onOptimize={onOptimize}
        compact
      />,
    )
    const button = screen.getByRole("button", { name: /^Undo/ })
    expect(button.textContent).toBe("Undo+$1.20")
    expect(button.getAttribute("aria-disabled")).toBeNull()
    fireEvent.click(button)
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onOptimize).not.toHaveBeenCalled()
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("offers nothing to undo when the ballot already was the best one", () => {
    render(
      <OptimizeButton
        state={{ kind: "optimized", applied: null }}
        onOptimize={vi.fn()}
        onUndo={vi.fn()}
        compact={false}
      />,
    )
    expect(screen.getByRole("button", { name: "Optimized" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull()
  })
})
