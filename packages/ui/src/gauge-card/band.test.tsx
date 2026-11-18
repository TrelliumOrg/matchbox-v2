import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Band, bandBoost, Root } from "./index"

describe("gauge card band", () => {
  it("keeps only the boost on the right", () => {
    expect(bandBoost(230_099, 1_400_000)).toBe("1.7×")
    expect(bandBoost(1_400_000, 1_400_000)).toBe("5×")
    expect(bandBoost(42_106_237, 35_020_000)).toBe("5×")
  })

  function card(votes: number, optimal: number) {
    return render(
      <Root picked={false} onPickedChange={() => {}} name="SNF">
        <Band
          votes={votes}
          optimal={optimal}
          count="230,099"
          of="of 1.40M veMEZO"
          toGo="1.17M veMEZO to go"
          over="7.07M veMEZO over"
        />
      </Root>,
    )
  }

  it("rolls between one resting line and one hover line, never both on the right", () => {
    const { container } = card(230_099, 1_400_000)
    expect(screen.getByText("of 1.40M veMEZO")).toBeTruthy()
    const hover = screen.getByText("1.17M veMEZO to go")
    expect(hover.getAttribute("aria-hidden")).toBe("true")
    expect(hover.className).toContain("group-hover/gauge:translate-y-0")
    expect(container.textContent).not.toContain("to go1.7×1.17M")
    expect(screen.getAllByText(/1\.17M veMEZO to go/)).toHaveLength(1)
  })

  it("stays green at 5× past optimal and says over once, never in red", () => {
    const { container } = card(42_106_237, 35_020_000)
    expect(screen.getAllByText("7.07M veMEZO over")).toHaveLength(1)
    const over = screen.getByText("7.07M veMEZO over")
    expect(over.className).toContain("text-sec")
    expect(over.className).not.toContain("text-neg")
    expect(screen.getByText("5×").className).toContain("text-pos")
    expect(container.innerHTML).not.toContain("neg")
    expect(container.querySelector(".bg-band-pos")?.className).toContain(
      "opacity-100",
    )
  })

  it("shows the hover line for a moment after a tap", () => {
    const { container } = card(230_099, 1_400_000)
    const article = container.querySelector("article")
    if (article === null) throw new Error("no card")
    fireEvent.pointerDown(article, { pointerType: "touch" })
    expect(article.hasAttribute("data-peek")).toBe(true)
  })
})
