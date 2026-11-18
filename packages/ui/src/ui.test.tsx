import { appearanceStorageKeys } from "@matchbox/tokens"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type ReactNode, useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as BlockTicker from "./block-ticker"
import { BarChart, LineChart } from "./chart"
import * as Field from "./field"
import * as LockCard from "./lock-card"
import * as Lockup from "./lockup"
import * as PriceSlot from "./price-slot"
import * as SegmentedControl from "./segmented-control"
import * as Sheet from "./sheet"
import * as SplitBar from "./split-bar"
import * as Stepper from "./stepper"
import * as Switch from "./switch"
import * as Theme from "./theme"
import * as Tooltip from "./tooltip"

// happy-dom does not upgrade NumberFlow's custom element; render plain text.
vi.mock("@matchbox/motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@matchbox/motion")>()),
  AnimatedNumber: ({ value, suffix }: { value: number; suffix?: string }) => (
    <span>
      {value}
      {suffix}
    </span>
  ),
}))

function mockMedia({ dark = false, reduced = false } = {}): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches:
          (dark && query.includes("dark")) ||
          (reduced && query.includes("reduce")),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) satisfies MediaQueryList,
  )
}

function Providers({ children }: { children: ReactNode }): ReactNode {
  return (
    <Tooltip.Provider>
      <Theme.Provider>{children}</Theme.Provider>
    </Tooltip.Provider>
  )
}

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.setAttribute("data-theme", "paper")
  mockMedia()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("Lockup", () => {
  it("names the product and matches the guideline widths at 22px", () => {
    render(<Lockup.Root product="pro" />)
    expect(screen.getByRole("img", { name: "Matchbox Pro" })).toBeTruthy()
    expect(Math.round(Lockup.lockupWidth("matchbox", "full", 22))).toBe(181)
    expect(Math.round(Lockup.lockupWidth("pro", "full", 22))).toBe(240)
    expect(Math.round(Lockup.lockupWidth("developer", "full", 22))).toBe(328)
    expect(Math.round(Lockup.lockupWidth("id", "full", 22))).toBe(225)
    expect(Math.round(Lockup.lockupWidth("classic", "full", 22))).toBe(299)
  })

  it("draws the product name in grey only in the full form", () => {
    const { container, rerender } = render(<Lockup.Root product="scan" />)
    expect(container.querySelectorAll('path[fill="var(--sec)"]').length).toBe(1)
    rerender(<Lockup.Root product="scan" form="short" />)
    expect(container.querySelectorAll('path[fill="var(--sec)"]').length).toBe(0)
  })
})

function TokenSegments(): ReactNode {
  const [value, setValue] = useState("mezo")
  return (
    <SegmentedControl.Root
      aria-label="Token"
      value={value}
      onValueChange={setValue}
    >
      <SegmentedControl.Item value="mezo">MEZO</SegmentedControl.Item>
      <SegmentedControl.Item value="btc">BTC</SegmentedControl.Item>
    </SegmentedControl.Root>
  )
}

describe("SegmentedControl", () => {
  it("keeps unselected items readable (4.5:1) on a card's darker track", () => {
    render(
      <SegmentedControl.Root
        aria-label="View"
        value="hex"
        size="sm"
        surface="card"
      >
        <SegmentedControl.Item value="hex">Hex</SegmentedControl.Item>
        <SegmentedControl.Item value="decoded">Decoded</SegmentedControl.Item>
      </SegmentedControl.Root>,
    )
    const unselected = screen.getByRole("radio", { name: "Decoded" })
    expect(unselected.className).toContain("text-ink2")
    expect(unselected.className).not.toMatch(/(^| )text-sec( |$)/)
  })

  it("moves the selection with arrow keys", async () => {
    const user = userEvent.setup()
    render(<TokenSegments />)
    const mezo = screen.getByRole("radio", { name: "MEZO" })
    expect(mezo.getAttribute("aria-checked")).toBe("true")
    await user.click(mezo)
    await user.keyboard("{ArrowRight}")
    const btc = screen.getByRole("radio", { name: "BTC" })
    expect(document.activeElement).toBe(btc)
    await user.keyboard(" ")
    expect(
      screen.getByRole("radio", { name: "BTC" }).getAttribute("aria-checked"),
    ).toBe("true")
  })
})

describe("Switch", () => {
  it("toggles with the keyboard", async () => {
    const user = userEvent.setup()
    render(<Switch.Root aria-label="Haptics" defaultChecked />)
    const control = screen.getByRole("switch", { name: "Haptics" })
    expect(control.getAttribute("aria-checked")).toBe("true")
    control.focus()
    await user.keyboard(" ")
    expect(control.getAttribute("aria-checked")).toBe("false")
  })
})

describe("Stepper", () => {
  it("steps by 1 with arrows, 10 with Shift, and clamps to the range", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <Stepper.Root
        label="Share for Kiln Labs"
        defaultValue={95}
        onValueChange={onValueChange}
      />,
    )
    const spin = screen.getByRole("spinbutton", { name: "Share for Kiln Labs" })
    spin.focus()
    await user.keyboard("{ArrowUp}")
    expect(spin.getAttribute("aria-valuenow")).toBe("96")
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}")
    expect(spin.getAttribute("aria-valuenow")).toBe("100")
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}")
    expect(spin.getAttribute("aria-valuetext")).toBe("90%")
    expect(onValueChange).toHaveBeenLastCalledWith(90)
  })

  it("takes a typed share live, commits on Enter and reverts on Escape", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <Stepper.Root
        label="Share for Kiln Labs"
        defaultValue={30}
        onValueChange={onValueChange}
      />,
    )
    const spin = screen.getByRole("spinbutton", { name: "Share for Kiln Labs" })
    await user.click(spin)
    await user.clear(spin)
    await user.type(spin, "12.5")
    expect(onValueChange).toHaveBeenLastCalledWith(12.5)
    await user.keyboard("{Enter}")
    expect(spin.getAttribute("aria-valuetext")).toBe("12.5%")
    await user.clear(spin)
    await user.type(spin, "70")
    expect(onValueChange).toHaveBeenLastCalledWith(70)
    await user.keyboard("{Escape}")
    expect(onValueChange).toHaveBeenLastCalledWith(12.5)
    expect(
      (
        screen.getByRole("button", {
          name: "Decrease Share for Kiln Labs",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false)
  })
})

describe("parsePercent", () => {
  it("accepts digits with one decimal place and clamps to 0 to 100", () => {
    expect(Stepper.parsePercent("12")).toBe(12)
    expect(Stepper.parsePercent("12.5")).toBe(12.5)
    expect(Stepper.parsePercent(".5")).toBe(0.5)
    expect(Stepper.parsePercent("12.")).toBe(12)
    expect(Stepper.parsePercent("12,5")).toBe(12.5)
    expect(Stepper.parsePercent("40%")).toBe(40)
    expect(Stepper.parsePercent("140")).toBe(100)
    expect(Stepper.parsePercent("0")).toBe(0)
    expect(Stepper.parsePercent("")).toBeNull()
    expect(Stepper.parsePercent("12.55")).toBeNull()
    expect(Stepper.parsePercent("-4")).toBeNull()
    expect(Stepper.parsePercent("1e2")).toBeNull()
  })
})

describe("LockCard", () => {
  it("flips to the action face and back, moving focus", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <LockCard.Root kind="vemezo">
        <LockCard.Front>
          <LockCard.Tab href="/locks/2207">veMEZO #2207</LockCard.Tab>
          <LockCard.Body>
            <LockCard.Amount>48,000.00 MEZO</LockCard.Amount>
            <LockCard.Manage />
          </LockCard.Body>
        </LockCard.Front>
        <LockCard.Back>
          <LockCard.Tab>veMEZO #2207</LockCard.Tab>
          <LockCard.Menu>
            <LockCard.MenuItem icon={null}>Vote</LockCard.MenuItem>
            <LockCard.Done />
          </LockCard.Menu>
        </LockCard.Back>
      </LockCard.Root>,
    )
    const card = container.querySelector("article")
    expect(card?.getAttribute("data-flipped")).toBe("false")
    await user.click(screen.getByRole("button", { name: "Manage" }))
    expect(card?.getAttribute("data-flipped")).toBe("true")
    expect(document.activeElement?.textContent).toContain("Vote")
    await user.click(screen.getByRole("button", { name: "Done" }))
    expect(card?.getAttribute("data-flipped")).toBe("false")
    expect(document.activeElement?.textContent).toContain("Manage")
  })
})

describe("Sheet", () => {
  it("opens with a titled dialog and a labelled close button", async () => {
    const user = userEvent.setup()
    render(
      <Sheet.Root>
        <Sheet.Trigger>Open</Sheet.Trigger>
        <Sheet.Content>
          <Sheet.Header>Review vote</Sheet.Header>
          <Sheet.Body>Body</Sheet.Body>
        </Sheet.Content>
      </Sheet.Root>,
    )
    await user.click(screen.getByRole("button", { name: "Open" }))
    const dialog = screen.getByRole("dialog", { name: "Review vote" })
    await user.click(within(dialog).getByRole("button", { name: "Close" }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("Theme picker", () => {
  it("applies a mode and a preset on tap and stores them", async () => {
    const user = userEvent.setup()
    render(
      <Providers>
        <Theme.Picker />
      </Providers>,
    )
    expect(screen.getByRole("radio", { name: /System/ })).toBeTruthy()
    // System lists both preset groups.
    expect(screen.getByRole("radio", { name: /Paper/ })).toBeTruthy()
    expect(screen.getByRole("radio", { name: /Graphite/ })).toBeTruthy()

    await user.click(screen.getByRole("radio", { name: /Dark/ }))
    expect(document.documentElement.getAttribute("data-theme")).toBe("graphite")
    expect(screen.queryByRole("radio", { name: /Paper/ })).toBeNull()

    await user.click(screen.getByRole("radio", { name: /Onyx/ }))
    expect(document.documentElement.getAttribute("data-theme")).toBe("onyx")
    expect(window.localStorage.getItem(appearanceStorageKeys.mode)).toBe("dark")
    expect(window.localStorage.getItem(appearanceStorageKeys.dark)).toBe("onyx")
  })

  it("reads the stored appearance without repainting the defaults", async () => {
    window.localStorage.setItem(appearanceStorageKeys.mode, "light")
    window.localStorage.setItem(appearanceStorageKeys.light, "linen")
    document.documentElement.setAttribute("data-theme", "linen")
    const seen: (string | null)[] = []
    const observer = new MutationObserver(() => {
      seen.push(document.documentElement.getAttribute("data-theme"))
    })
    observer.observe(document.documentElement, { attributes: true })
    render(
      <Providers>
        <Theme.Picker />
      </Providers>,
    )
    await act(async () => {})
    observer.disconnect()
    expect(seen).not.toContain("paper")
    expect(document.documentElement.getAttribute("data-theme")).toBe("linen")
  })

  it("has the Haptics switch, on by default", () => {
    render(
      <Providers>
        <Theme.Picker />
      </Providers>,
    )
    expect(
      screen
        .getByRole("switch", { name: "Haptics" })
        .getAttribute("aria-checked"),
    ).toBe("true")
  })
})

describe("Field", () => {
  it("keeps amounts as sanitised strings", () => {
    expect(Field.sanitizeAmount("1,234.567", 2)).toBe("1234.56")
    expect(Field.sanitizeAmount("12a.3.4", 8)).toBe("12.34")
    expect(Field.sanitizeAmount("", 2)).toBe("")
  })

  it("links the error to the input when invalid", () => {
    render(
      <Field.Root invalid>
        <Field.Box>
          <div>
            <Field.Label>You lock</Field.Label>
            <Field.Input value="14000.00" onValueChange={() => {}} />
          </div>
          <Field.Currency ticker="MEZO" />
        </Field.Box>
        <Field.Error>Exceeds balance by 1,520.00 MEZO</Field.Error>
      </Field.Root>,
    )
    const input = screen.getByLabelText("You lock")
    expect(input.getAttribute("aria-invalid")).toBe("true")
    const error = screen.getByText("Exceeds balance by 1,520.00 MEZO")
    expect(input.getAttribute("aria-describedby")).toBe(error.id)
  })
})

describe("PriceSlot", () => {
  const epoch = { label: "Epoch 47", remaining: "3d 12h" }

  it("skips a missing price in the summary", () => {
    render(
      <Tooltip.Provider>
        <PriceSlot.Root
          mezo={null}
          btc={{ price: "$105,710", change: "+1.8%", trend: "up" }}
          epoch={epoch}
        />
      </Tooltip.Provider>,
    )
    expect(
      screen.getByRole("button", { name: "BTC $105,710, Epoch 47 3d 12h" }),
    ).toBeTruthy()
  })

  it("shows the epoch and does not cycle under reduced motion", () => {
    vi.restoreAllMocks()
    mockMedia({ reduced: true })
    vi.useFakeTimers()
    const { container } = render(
      <PriceSlot.Root
        mezo={{ price: "$0.184", change: "-2.4%", trend: "down" }}
        btc={{ price: "$105,710", change: "+1.8%", trend: "up" }}
        epoch={epoch}
      />,
    )
    act(() => {
      vi.advanceTimersByTime(12_000)
    })
    const visible = [...container.querySelectorAll("[data-mbx-motion]")].filter(
      (element) => !element.className.includes("invisible"),
    )
    expect(visible).toHaveLength(1)
    expect(visible[0]?.textContent).toContain("Epoch 47")
    vi.useRealTimers()
  })
})

describe("SplitBar", () => {
  it("normalises shares into percentages", () => {
    expect(
      SplitBar.percentages([
        { id: "a", value: 7, color: "red" },
        { id: "b", value: 3, color: "blue" },
      ]),
    ).toEqual([70, 30])
    render(
      <SplitBar.Root
        segments={[
          { id: "kiln", value: 70, color: "red", label: "Kiln Labs" },
          { id: "604", value: 30, color: "blue", label: "veBTC #604" },
        ]}
      />,
    )
    expect(
      screen.getByRole("img", { name: "Kiln Labs 70%, veBTC #604 30%" }),
    ).toBeTruthy()
  })
})

describe("BlockTicker", () => {
  it("links to Matchscan with the block in its name", () => {
    render(
      <Tooltip.Provider>
        <BlockTicker.Root
          block={13078795}
          receivedAt={Date.now()}
          href="https://scan.matchbox.markets/block/13078795"
        />
      </Tooltip.Provider>,
    )
    expect(
      screen
        .getByRole("link", {
          name: "Latest block 13078795, view on Matchscan",
        })
        .getAttribute("href"),
    ).toBe("https://scan.matchbox.markets/block/13078795")
  })
})

describe("Charts", () => {
  it("draws one point per value and a dot on now", () => {
    const { container } = render(
      <LineChart
        label="APY over 9 epochs"
        points={[1.2, 1.5, 1.3, 1.9, 2.2, 2.0, 2.4, 2.8, 2.6]}
        reference={{ value: 1.8, label: "Median 1.80%" }}
        startLabel="Epoch 1"
        endLabel="Epoch 9"
      />,
    )
    const line = container.querySelector("polyline")
    expect(line?.getAttribute("points")?.split(" ")).toHaveLength(9)
    expect(container.querySelectorAll("circle")).toHaveLength(2)
    expect(screen.getByText("Median 1.80%")).toBeTruthy()
  })

  it("makes bars selectable with arrow keys", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <BarChart
        label="Votes per epoch"
        bars={[
          { label: "E45", value: 3 },
          { label: "E46", value: 5 },
          { label: "E47", value: 4 },
        ]}
        onSelect={onSelect}
      />,
    )
    const current = screen.getByRole("button", { name: "E47" })
    expect(current.getAttribute("aria-pressed")).toBe("true")
    current.focus()
    await user.keyboard("{ArrowLeft}")
    expect(onSelect).toHaveBeenCalledWith(1)
    // Home and End select too, so focus and selection never disagree.
    await user.keyboard("{Home}")
    expect(onSelect).toHaveBeenLastCalledWith(0)
    await user.keyboard("{End}")
    expect(onSelect).toHaveBeenLastCalledWith(2)
  })

  it("pages past the ends and keeps a bar tabbable with none selected", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onEdge = vi.fn()
    render(
      <BarChart
        label="Votes per epoch"
        bars={[
          { label: "E45", value: 3 },
          { label: "E46", value: 5 },
        ]}
        selected={-1}
        onSelect={onSelect}
        onEdge={onEdge}
      />,
    )
    const bars = screen.getAllByRole("button")
    expect(bars.map((bar) => bar.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
    ])
    expect(bars.map((bar) => bar.tabIndex)).toEqual([-1, 0])
    bars[1]?.focus()
    await user.keyboard("{ArrowRight}")
    expect(onEdge).toHaveBeenCalledWith(1)
    bars[0]?.focus()
    await user.keyboard("{ArrowLeft}")
    expect(onEdge).toHaveBeenCalledWith(-1)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
