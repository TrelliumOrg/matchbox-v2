import { render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { barGap, Root } from "./series-chart"

const days = (values: number[], partialLast = true) =>
  values.map((value, index) => ({
    day: `2026-11-0${index + 1}`,
    value,
    partial: partialLast && index === values.length - 1,
  }))

describe("SeriesChart", () => {
  it("draws a flow as bars and today's as in progress", () => {
    const { container, getByRole } = render(
      <Root
        points={days([3, 5, 2])}
        kind="flow"
        label="Swaps, today so far 2"
      />,
    )
    expect(getByRole("img", { name: "Swaps, today so far 2" })).toBeTruthy()
    const partial = container.querySelectorAll("[data-partial]")
    expect(partial).toHaveLength(1)
    expect(partial[0]?.innerHTML).toContain("border-dashed")
  })

  it("keeps 550 bars wider than zero in a 544 px box", () => {
    const many = Array.from({ length: 550 }, (_, index) => ({
      day: `d${index}`,
      value: index + 1,
      partial: false,
    }))
    const { container } = render(
      <Root points={many} kind="flow" label="Active addresses" />,
    )
    const box = container.querySelector<HTMLElement>('[role="img"] > div')
    expect(box?.querySelectorAll(":scope > span")).toHaveLength(550)
    expect(box?.style.columnGap).toBe(barGap(550))
    // min(3px, p%) of a 544 px box: the gaps take a third at most.
    const percent = Number(/min\(3px,([0-9.]+)%\)/.exec(barGap(550))?.[1])
    const gap = Math.min(3, (544 * percent) / 100)
    const bar = (544 - 549 * gap) / 550
    expect(549 * gap).toBeLessThanOrEqual(544 / 3)
    expect(bar).toBeGreaterThan(0.6)
    // Few bars keep the design's 3 px.
    expect(barGap(30)).toBe("min(3px,1.1379310344827587%)")
    expect(barGap(1)).toBe("3px")
  })

  it("draws a level as a line ending in a hollow dot while filling", () => {
    const { container } = render(
      <Root points={days([1, 2, 4])} kind="level" label="Supply" />,
    )
    const dashed = container.querySelector('polyline[stroke-dasharray="4 5"]')
    expect(dashed).not.toBeNull()
    expect(
      container.querySelector('circle[fill="var(--bg)"][stroke]'),
    ).not.toBeNull()
  })

  it("keeps an empty level's box the line's size, as it scales", () => {
    // A level drawn later (after first paint) must not change its height.
    const { container } = render(
      <Root points={[]} kind="level" label="Liquidity" height={140} />,
    )
    const box = container.querySelector<HTMLElement>('[role="img"] > div')
    expect(box?.style.aspectRatio).toBe("680 / 140")
    const flow = render(<Root points={[]} kind="flow" label="Swaps" />)
    const bars = flow.container.querySelector<HTMLElement>('[role="img"] > div')
    expect(bars?.style.height).toBe("160px")
  })

  it("closes the line when the last day is complete", () => {
    const { container } = render(
      <Root points={days([1, 2, 4], false)} kind="level" label="Supply" />,
    )
    expect(
      container.querySelector('polyline[stroke-dasharray="4 5"]'),
    ).toBeNull()
  })

  it("grows signed flows both ways from a zero line", () => {
    const { container } = render(
      <Root points={days([3, -2, 1])} kind="flow" label="Net locked" />,
    )
    expect(container.querySelector(".origin-top")).not.toBeNull()
  })

  it("plays its entry once 40% in view", () => {
    const observed: {
      callback: IntersectionObserverCallback
      threshold: unknown
    }[] = []
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          callback: IntersectionObserverCallback,
          options: { threshold: unknown },
        ) {
          observed.push({ callback, threshold: options.threshold })
        }
        observe() {}
        disconnect() {}
      },
    )
    const { container } = render(
      <Root points={days([1, 2])} kind="flow" label="Swaps" />,
    )
    const figure = container.querySelector("[data-chart]")
    expect(figure?.hasAttribute("data-play")).toBe(false)
    expect(observed[0]?.threshold).toBe(0.4)
    observed[0]?.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )
    expect(figure?.hasAttribute("data-play")).toBe(true)
  })

  it("shows at once without IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined)
    const { container } = render(
      <Root points={days([1, 2])} kind="level" label="Supply" />,
    )
    expect(
      container.querySelector("[data-chart]")?.hasAttribute("data-shown"),
    ).toBe(true)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})
