import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { type Allocation, Root, stackOf } from "./allocation-mark"

afterEach(() => {
  cleanup()
})

function gauges(count: number): Allocation[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `gauge-${index}`,
    name: `Gauge ${index}`,
    // The fourth gauge has the largest share, the second the next.
    share: index === 3 ? 500 : index === 1 ? 400 : 100,
    color: "#5C7AEA",
    picture: <span data-picture={index} />,
  }))
}

describe("the allocation mark's stack", () => {
  it("draws every gauge up to the limit", () => {
    const { shown, more } = stackOf(gauges(4), 4)
    expect(shown).toHaveLength(4)
    expect(more).toBe(0)
  })

  it("shows the largest shares in their order and counts the rest", () => {
    const { shown, more } = stackOf(gauges(30), 4)
    expect(shown.map((gauge) => gauge.id)).toEqual([
      "gauge-0",
      "gauge-1",
      "gauge-3",
    ])
    expect(more).toBe(27)
  })

  it("draws a few pictures and +N, and still names every gauge", () => {
    const { container, getByRole } = render(<Root allocations={gauges(30)} />)
    expect(container.querySelectorAll("[data-picture]")).toHaveLength(3)
    expect(container.querySelector("[data-allocation-more]")?.textContent).toBe(
      "+27",
    )
    const label = getByRole("img").getAttribute("aria-label") ?? ""
    expect(label.split(", ")).toHaveLength(30)
  })

  it("keeps one picture and +N at a limit of two", () => {
    const { container } = render(<Root allocations={gauges(16)} max={2} />)
    expect(container.querySelectorAll("[data-picture]")).toHaveLength(1)
    expect(container.querySelector("[data-allocation-more]")?.textContent).toBe(
      "+15",
    )
  })
})
