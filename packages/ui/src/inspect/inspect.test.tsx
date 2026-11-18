import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { BarChart, LineChart } from "../chart"
import * as SeriesChart from "../series-chart"
import { arm } from "./arm"
import { clear, clearDetached, install } from "./controller"
import { Note, noteReserve, point, root, scope, Value } from "./inspect"
import { change, nearest, step, widest } from "./logic"

describe("inspection logic", () => {
  it("finds the nearest point, ties to the left", () => {
    expect(nearest([10, 20, 30], 24)).toBe(1)
    expect(nearest([10, 20, 30], 26)).toBe(2)
    expect(nearest([10, 20, 30], 15)).toBe(0)
    expect(nearest([10, 20, 30], -100)).toBe(0)
    expect(nearest([10, 20, 30], 900)).toBe(2)
    expect(nearest([], 4)).toBe(-1)
  })

  it("moves with arrow keys, Home and End, and stops at the ends", () => {
    expect(step(3, "ArrowLeft", 5)).toBe(2)
    expect(step(3, "ArrowRight", 5)).toBe(4)
    expect(step(4, "ArrowRight", 5)).toBe(4)
    expect(step(0, "ArrowLeft", 5)).toBe(0)
    expect(step(2, "ArrowUp", 5)).toBe(1)
    expect(step(2, "ArrowDown", 5)).toBe(3)
    expect(step(2, "Home", 5)).toBe(0)
    expect(step(2, "End", 5)).toBe(4)
    expect(step(2, "Enter", 5)).toBeNull()
    expect(step(0, "ArrowLeft", 0)).toBeNull()
  })

  it("says the change from the point before in percent", () => {
    expect(change(4_703_651, 4_696_469)).toEqual({ text: "-0.2%", tone: "neg" })
    expect(change(100, 112.34)).toEqual({ text: "+12.3%", tone: "pos" })
    expect(change(100, 100)).toEqual({ text: "0.0%", tone: "flat" })
    expect(change(-50, -25)).toEqual({ text: "+50.0%", tone: "pos" })
    expect(change(0, 5)).toBeNull()
    expect(change(null, 5)).toBeNull()
  })

  it("reserves the widest note, with its change", () => {
    const points = [
      { label: "Epoch 9", n: 100 },
      { label: "Epoch 10", n: 50 },
      { label: "Epoch 11", n: 51 },
    ]
    expect(noteReserve(points, true)).toBe("Epoch 10 -50.0%0")
    expect(noteReserve(points, false)).toBe("Epoch 10")
  })

  it("reserves the widest text", () => {
    expect(widest(["1 MEZO", "4,807,692 MEZO", "12 MEZO"])).toBe(
      "4,807,692 MEZO",
    )
  })
})

/** Puts each bar or point `width` apart, from 0, for the pointer. */
function layOut(container: HTMLElement, width = 10): void {
  const anchors = container.querySelectorAll(
    "[data-inspect-point] [data-inspect-anchor], circle[data-inspect-point]",
  )
  anchors.forEach((anchor, index) => {
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
      left: index * width,
      right: index * width + width,
      width,
      top: 0,
      bottom: 100,
      height: 100,
      x: index * width,
      y: 0,
      toJSON: () => ({}),
    })
  })
}

const bars = [
  { label: "Epoch 46", value: 4_807_692, text: "4,807,692 MEZO" },
  { label: "Epoch 47", value: 4_703_651, text: "4,703,651 MEZO" },
  { label: "Epoch 48", value: 4_696_469, text: "4,696,469 MEZO" },
]

function Panel() {
  return (
    <section {...scope}>
      <p>
        <Value reserve="4,807,692 MEZO">4,696,469 MEZO</Value>{" "}
        <Note>Epoch 48</Note>
      </p>
      <BarChart label="MEZO emissions by epoch" bars={bars} readout="figure" />
    </section>
  )
}

describe("inspecting a chart", () => {
  beforeAll(() => {
    install()
  })

  afterEach(() => {
    clear()
    cleanup()
    vi.restoreAllMocks()
  })

  it("shows the hovered bar in the panel's figure and puts it back on leave", () => {
    const { container } = render(<Panel />)
    layOut(container)
    const plot = container.querySelector("[data-inspect]")
    if (plot === null) throw new Error("no chart")
    const live = container.querySelectorAll("[data-inspect-live]")
    fireEvent.pointerMove(plot, { clientX: 12, pointerType: "mouse" })
    expect(live[0]?.textContent).toBe("4,703,651 MEZO")
    expect(live[1]?.textContent).toBe("Epoch 47-2.2%")
    expect(
      container.querySelector("section")?.hasAttribute("data-inspecting"),
    ).toBe(true)
    const points = container.querySelectorAll("[data-inspect-point]")
    expect(points[1]?.hasAttribute("data-active")).toBe(true)
    expect(points[0]?.hasAttribute("data-active")).toBe(false)

    fireEvent.pointerMove(plot, { clientX: 1, pointerType: "mouse" })
    expect(live[0]?.textContent).toBe("4,807,692 MEZO")
    // The first bar has no bar before it: no change.
    expect(live[1]?.textContent).toBe("Epoch 46")

    fireEvent.pointerOut(plot, {
      relatedTarget: document.body,
      pointerType: "mouse",
    })
    expect(
      container.querySelector("section")?.hasAttribute("data-inspecting"),
    ).toBe(false)
    expect(live[0]?.textContent).toBe("")
    expect(container.querySelector("[data-active]")).toBeNull()
  })

  it("looks again when the page scrolls under a resting mouse", () => {
    const { container } = render(<Panel />)
    layOut(container)
    const plot = container.querySelector("[data-inspect]")
    if (plot === null) throw new Error("no chart")
    const live = container.querySelectorAll("[data-inspect-live]")
    fireEvent.pointerOver(plot, {
      clientX: 12,
      clientY: 40,
      pointerType: "mouse",
    })
    expect(live[0]?.textContent).toBe("4,703,651 MEZO")
    const under = vi.fn((): Element | null => plot)
    document.elementFromPoint = under
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => {
      frames.push(frame)
      return frames.length
    })
    const frame = () => {
      for (const each of frames.splice(0)) each(0)
    }
    try {
      // Scrolled into view: the bar is still under the mouse, and shows.
      // Scrolls in one frame look once.
      fireEvent.scroll(window)
      fireEvent.scroll(window)
      expect(frames).toHaveLength(1)
      frame()
      expect(under).toHaveBeenCalledTimes(1)
      expect(under).toHaveBeenCalledWith(12, 40)
      expect(live[0]?.textContent).toBe("4,703,651 MEZO")
      // Scrolled away: nothing of the chart is under it.
      under.mockReturnValue(document.body)
      fireEvent.scroll(window)
      frame()
      expect(live[0]?.textContent).toBe("")
      expect(container.querySelector("[data-active]")).toBeNull()
    } finally {
      Reflect.deleteProperty(document, "elementFromPoint")
      vi.unstubAllGlobals()
    }
  })

  it("moves with the arrow keys from the latest point and announces it", () => {
    const { container } = render(
      <LineChart
        label="Votes over 3 epochs"
        points={[3, 5, 4]}
        inspect={[
          { label: "Epoch 46", value: "3 veBTC" },
          { label: "Epoch 47", value: "5 veBTC" },
          { label: "Epoch 48", value: "4 veBTC" },
        ]}
      />,
    )
    const chart = container.querySelector("svg")
    if (chart === null) throw new Error("no chart")
    expect(chart.getAttribute("tabindex")).toBe("0")
    chart.focus()
    fireEvent.keyDown(chart, { key: "ArrowLeft" })
    const tip = document.querySelector("[data-inspect-tip]")
    expect(tip?.textContent).toBe("Epoch 475 veBTC+66.7%")
    expect(document.querySelector("[data-inspect-speaker]")?.textContent).toBe(
      "Epoch 47, 5 veBTC, +66.7%",
    )
    fireEvent.keyDown(chart, { key: "Home" })
    expect(tip?.textContent).toBe("Epoch 463 veBTC")
    // The guide and dot move to the point.
    const first = container.querySelector("circle[data-inspect-point]")
    expect(
      container.querySelector("[data-inspect-dot]")?.getAttribute("transform"),
    ).toBe(
      `translate(${first?.getAttribute("cx")} ${first?.getAttribute("cy")})`,
    )
    fireEvent.keyDown(chart, { key: "Escape" })
    expect(chart.hasAttribute("data-inspecting")).toBe(false)
  })

  it("says on the page when the charts listen", () => {
    // An inspectable chart has armed the page by now; again is harmless.
    arm()
    expect(document.documentElement.hasAttribute("data-inspect-armed")).toBe(
      true,
    )
  })

  it("lets go of a tooltip when its chart leaves the page", () => {
    const view = render(
      <BarChart
        label="Incentives by epoch"
        bars={bars.map((bar) => ({ ...bar, text: bar.text }))}
      />,
    )
    layOut(view.container)
    const chart = view.container.querySelector("[data-inspect]")
    if (chart === null) throw new Error("no chart")
    // A touch shows a bar; a touch has no pointerout to clear it.
    fireEvent.pointerDown(chart, { clientX: 12, pointerType: "touch" })
    const tip = document.querySelector("[data-inspect-tip]")
    expect(tip?.hasAttribute("data-open")).toBe(true)
    // A new page of bars replaces the chart.
    view.unmount()
    clearDetached()
    expect(tip?.hasAttribute("data-open")).toBe(false)
  })

  it("shows no change for a point still filling, and the first bar's from before the page", () => {
    const { container } = render(
      <ul {...root("x", "tip", true)}>
        <li
          {...point({ label: "Epoch 47", value: "10 veBTC" }, 10, {
            before: 8,
          })}
        >
          <span data-inspect-anchor="" />
        </li>
        <li
          {...point({ label: "Epoch 48", value: "4 veBTC" }, 4, {
            partial: true,
          })}
        >
          <span data-inspect-anchor="" />
        </li>
      </ul>,
    )
    layOut(container)
    const chart = container.querySelector("[data-inspect]")
    if (chart === null) throw new Error("no chart")
    const tip = (): string =>
      document.querySelector("[data-inspect-tip]")?.textContent ?? ""
    fireEvent.pointerMove(chart, { clientX: 2, pointerType: "mouse" })
    expect(tip()).toBe("Epoch 4710 veBTC+25.0%")
    fireEvent.pointerMove(chart, { clientX: 14, pointerType: "mouse" })
    expect(tip()).toBe("Epoch 484 veBTC")
  })

  it("leaves a chart without values as it was", () => {
    const { container } = render(
      <BarChart
        label="Requests"
        bars={[
          { label: "Mon", value: 1 },
          { label: "Tue", value: 2 },
        ]}
      />,
    )
    expect(container.querySelector("[data-inspect]")).toBeNull()
    expect(container.querySelector("[tabindex]")).toBeNull()
  })

  it("reads a daily series' days", () => {
    const { container } = render(
      <SeriesChart.Root
        label="MUSD debt"
        kind="level"
        points={[
          {
            day: "2026-11-08",
            value: 10,
            partial: false,
            label: "8 Nov",
            text: "10 MUSD",
          },
          {
            day: "2026-11-09",
            value: 12,
            partial: true,
            label: "Today so far",
            text: "12 MUSD",
          },
        ]}
      />,
    )
    layOut(container, 300)
    const chart = container.querySelector("[data-inspect]")
    if (chart === null) throw new Error("no chart")
    fireEvent.pointerMove(chart, { clientX: 400, pointerType: "mouse" })
    expect(document.querySelector("[data-inspect-tip]")?.textContent).toBe(
      "Today so far12 MUSD+20.0%",
    )
  })
})
