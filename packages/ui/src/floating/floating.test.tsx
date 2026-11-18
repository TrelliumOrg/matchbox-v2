import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it } from "vitest"
import { Pop, place, Tip } from "./floating"

const viewport = { width: 1000, height: 800 }

function PopHarness() {
  const [open, setOpen] = useState(false)
  return (
    <Pop
      open={open}
      onOpenChange={setOpen}
      content={<p>Breakdown</p>}
      trigger={(props) => (
        <button type="button" {...props}>
          $212.48
        </button>
      )}
    />
  )
}
const anchor = { top: 100, bottom: 140, left: 400, right: 500, width: 100 }

describe("place", () => {
  it("puts a top bubble above the anchor, centred", () => {
    expect(
      place(anchor, { width: 200, height: 40 }, viewport, "top", "center", 8),
    ).toEqual({ top: 52, left: 350 })
  })

  it("flips below when there is no room above", () => {
    const high = { ...anchor, top: 20, bottom: 60 }
    expect(
      place(high, { width: 200, height: 40 }, viewport, "top", "center", 8).top,
    ).toBe(68)
  })

  it("flips above when a bottom popover would leave the viewport", () => {
    const low = { ...anchor, top: 700, bottom: 740 }
    expect(
      place(low, { width: 300, height: 200 }, viewport, "bottom", "start", 8)
        .top,
    ).toBe(492)
  })

  it("keeps the bubble inside the viewport horizontally", () => {
    const edge = { ...anchor, left: 940, right: 990 }
    expect(
      place(edge, { width: 300, height: 40 }, viewport, "bottom", "start", 8)
        .left,
    ).toBe(688)
    const start = { ...anchor, left: 2, right: 40, width: 38 }
    expect(
      place(start, { width: 300, height: 40 }, viewport, "bottom", "end", 8)
        .left,
    ).toBe(12)
  })
})

describe("top layer", () => {
  it("renders the tooltip as a manual popover", () => {
    render(
      <Tip
        open
        content="Kiln Labs 70%"
        trigger={(props) => (
          <button type="button" {...props}>
            Mark
          </button>
        )}
      />,
    )
    expect(screen.getByRole("tooltip").getAttribute("popover")).toBe("manual")
  })

  it("renders the popover as a manual popover inside its trigger's root", () => {
    render(<PopHarness />)
    fireEvent.click(screen.getByRole("button", { name: "$212.48" }))
    const panel = screen.getByText("Breakdown").parentElement
    expect(panel?.getAttribute("popover")).toBe("manual")
    expect(
      screen
        .getByRole("button", { name: "$212.48" })
        .parentElement?.contains(panel ?? null),
    ).toBe(true)
  })
})
