import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type ReactNode, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as CoinStack from "./coin-stack"
import * as FilterTabs from "./filter-tabs"
import * as GaugeCard from "./gauge-card"
import { Glyph, shapes } from "./icons"
import * as PillButton from "./pill-button"
import * as Slot from "./slot"
import { mergeClasses, tv } from "./tv"

afterEach(() => {
  cleanup()
})

function Card({
  onChange,
}: {
  onChange: (picked: boolean) => void
}): ReactNode {
  const [picked, setPicked] = useState(false)
  return (
    <GaugeCard.Root
      picked={picked}
      name="Kiln Labs"
      onPickedChange={(next) => {
        setPicked(next)
        onChange(next)
      }}
    >
      <GaugeCard.Body>
        <GaugeCard.Head
          picture={null}
          name={
            <GaugeCard.Name>
              <a href="/gauges/kiln">Kiln Labs</a>
            </GaugeCard.Name>
          }
          id="CL200"
          subline="Validator ops"
        />
      </GaugeCard.Body>
      <GaugeCard.Band
        votes={5_880_000}
        optimal={6_970_000}
        count="5,880,000"
        of="of 6.97M"
        toGo="1.09M to go"
        over="0 over"
      />
    </GaugeCard.Root>
  )
}

function Tabs(): ReactNode {
  const [value, setValue] = useState("all")
  return (
    <FilterTabs.Root
      label="Gauge filter"
      value={value}
      onValueChange={setValue}
    >
      <FilterTabs.Item value="all" count={289}>
        All
      </FilterTabs.Item>
      <FilterTabs.Item value="funded" count={34}>
        Funded
      </FilterTabs.Item>
    </FilterTabs.Root>
  )
}

describe("tv and mergeClasses", () => {
  it("lets the later class in a group win, per variant prefix", () => {
    expect(mergeClasses("bg-acc text-on-acc bg-soft text-mut")).toBe(
      "bg-soft text-mut",
    )
    expect(mergeClasses("h-11 px-5 text-base text-ink h-[54px]")).toBe(
      "px-5 text-base text-ink h-[54px]",
    )
    expect(mergeClasses("outline-none focus-visible:outline-2")).toBe(
      "outline-none focus-visible:outline-2",
    )
    expect(mergeClasses("flex hidden md:block")).toBe("hidden md:block")
  })

  it("keeps the axis groups apart (gap-x and gap-y, inset-x and inset-y)", () => {
    expect(mergeClasses("gap-x-3.5 gap-y-1")).toBe("gap-x-3.5 gap-y-1")
    expect(mergeClasses("gap-2 gap-x-4 gap-x-3")).toBe("gap-2 gap-x-3")
    expect(mergeClasses("inset-x-0 inset-y-2")).toBe("inset-x-0 inset-y-2")
  })

  it("applies variants, compounds and defaults", () => {
    const button = tv({
      base: "bg-acc h-11",
      variants: {
        size: { sm: "h-8", md: "h-11" },
        quiet: { true: "bg-soft" },
      },
      compoundVariants: [{ size: "sm", quiet: true, class: "px-2" }],
      defaultVariants: { size: "md", quiet: false },
    })
    expect(button()).toBe("bg-acc h-11")
    expect(button({ size: "sm", quiet: true, className: "mt-2" })).toBe(
      "h-8 bg-soft px-2 mt-2",
    )
  })

  it("keeps the inactive pill grey over its intent colour", () => {
    render(<PillButton.Root disabled>Nothing to claim</PillButton.Root>)
    const button = screen.getByRole("button", { name: "Nothing to claim" })
    expect(button.className).toContain("bg-soft")
    expect(button.className).not.toContain("bg-acc")
  })
})

describe("GaugeCard", () => {
  it("picks only from the check: the rest of the card is the gauge's link", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Card onChange={onChange} />)
    await user.click(screen.getByText("Validator ops"))
    expect(onChange).not.toHaveBeenCalled()
    const check = screen.getByRole("button", {
      name: "Add Kiln Labs to ballot",
    })
    await user.click(check)
    expect(onChange).toHaveBeenLastCalledWith(true)
    expect(check.getAttribute("aria-pressed")).toBe("true")
    const link = screen.getByRole("link", { name: "Kiln Labs" })
    link.addEventListener("click", (event) => event.preventDefault())
    await user.click(link)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("stretches the one name link over the card, under the check", () => {
    const { container } = render(<Card onChange={() => {}} />)
    const links = container.querySelectorAll("a")
    expect(links).toHaveLength(1)
    const link = links[0]
    expect(link?.hasAttribute("data-card-link")).toBe(true)
    expect(link?.getAttribute("draggable")).toBe("false")
    expect(link?.className).toContain("after:absolute")
    expect(link?.className).toContain("after:inset-0")
    expect(container.querySelector("article")?.className).toContain(
      "has-[[data-card-link]:focus-visible]:outline-2",
    )
    const check = screen.getByRole("button", { name: /to ballot/ })
    expect(check.className).toContain("z-20")
  })

  it("does not open the gauge on a click that ends a text selection", () => {
    render(<Card onChange={() => {}} />)
    const link = screen.getByRole("link", { name: "Kiln Labs" })
    const subline = screen.getByText("Validator ops")
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(subline)
    selection?.removeAllRanges()
    selection?.addRange(range)
    const selecting = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    })
    link.dispatchEvent(selecting)
    expect(selecting.defaultPrevented).toBe(true)
    selection?.removeAllRanges()
    const plain = new MouseEvent("click", { bubbles: true, cancelable: true })
    link.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(false)
  })

  it("keeps the grey id out of the accessible tree", () => {
    render(<Card onChange={() => {}} />)
    expect(screen.getByText("CL200").getAttribute("aria-hidden")).toBe("true")
  })

  it("lays out as a compact row inside data-gauge-view=compact", () => {
    const { container } = render(<Card onChange={() => {}} />)
    const article = container.querySelector("article")
    expect(article?.className).toContain(
      "in-data-[gauge-view=compact]:flex-row",
    )
    expect(screen.getByText("Validator ops").className).toContain(
      "in-data-[gauge-view=compact]:hidden",
    )
  })

  it("labels the band with the boost", () => {
    render(<Card onChange={() => {}} />)
    expect(screen.getByText("4.4×")).toBeTruthy()
    expect(GaugeCard.boostLabel(7_000_000, 6_970_000)).toBe("5.0×")
  })
})

describe("FilterTabs", () => {
  it("presses one tab at a time", async () => {
    const user = userEvent.setup()
    render(<Tabs />)
    const funded = screen.getByRole("button", { name: "Funded 34" })
    await user.click(funded)
    expect(funded.getAttribute("aria-pressed")).toBe("true")
    expect(
      screen
        .getByRole("button", { name: "All 289" })
        .getAttribute("aria-pressed"),
    ).toBe("false")
    expect(screen.getByRole("group", { name: "Gauge filter" })).toBeTruthy()
  })
})

describe("CoinStack breakdown", () => {
  it("opens on click and closes on Escape, returning focus", async () => {
    const user = userEvent.setup()
    render(
      <CoinStack.Root
        coins={[{ ticker: "BTC" }, { ticker: "MEZO" }]}
        label="Claimable breakdown"
        breakdown={[
          { ticker: "BTC", amount: "0.000412 BTC", usd: "$43.55" },
          { ticker: "MEZO", amount: "812.40 MEZO", usd: "$149.48" },
        ]}
      />,
    )
    const trigger = screen.getByRole("button", { name: "Claimable breakdown" })
    await user.click(trigger)
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByText("812.40 MEZO")).toBeTruthy()
    await user.keyboard("{Escape}")
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText("812.40 MEZO")).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})

describe("Slot and Glyph", () => {
  it("merges classes and composes handlers onto the child", () => {
    const slotClick = vi.fn()
    const childClick = vi.fn()
    render(
      <Slot.Root className="pill" onClick={slotClick}>
        <a href="/x" className="link" onClick={childClick}>
          Go
        </a>
      </Slot.Root>,
    )
    const link = screen.getByRole("link", { name: "Go" })
    expect(link.className).toBe("pill link")
    act(() => link.click())
    expect(childClick).toHaveBeenCalledTimes(1)
    expect(slotClick).toHaveBeenCalledTimes(1)
  })

  it("draws a shape as a decorative svg", () => {
    const { container } = render(<Glyph shape={shapes.house} size={18} />)
    const svg = container.querySelector("svg")
    expect(svg?.getAttribute("aria-hidden")).toBe("true")
    expect(svg?.getAttribute("width")).toBe("18")
    expect(svg?.querySelectorAll("path").length).toBeGreaterThan(0)
  })
})
