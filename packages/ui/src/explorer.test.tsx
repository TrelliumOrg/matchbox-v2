import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as Age from "./age"
import * as Breadcrumbs from "./breadcrumbs"
import * as CursorPager from "./cursor-pager"
import * as DataTable from "./data-table"
import * as HashChip from "./hash-chip"
import * as RawViewer from "./raw-viewer"
import * as StatusChip from "./status-chip"
import * as SubTabs from "./sub-tabs"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const address = "0x7f3a9c21d0e4b8f61a2c3e5d7b9f0a1c2e4d91c2"
const hash =
  "0x8f3c2e71aa0b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f80915b09a41d"

function Table(): ReactNode {
  return (
    <DataTable.Root caption="Latest transactions" captionHidden>
      <DataTable.Header>
        <DataTable.Column>Action</DataTable.Column>
        <DataTable.Column align="end">Age</DataTable.Column>
      </DataTable.Header>
      <DataTable.Body>
        <DataTable.Row>
          <DataTable.Cell phone="title">Repaid MUSD</DataTable.Cell>
          <DataTable.Cell align="end" phone="value">
            12m
          </DataTable.Cell>
        </DataTable.Row>
      </DataTable.Body>
    </DataTable.Root>
  )
}

describe("DataTable", () => {
  it("keeps table semantics with a named table and column headers", () => {
    render(<Table />)
    const table = screen.getByRole("table", { name: "Latest transactions" })
    expect(within(table).getAllByRole("columnheader")).toHaveLength(2)
    expect(within(table).getByRole("cell", { name: "12m" })).toBeTruthy()
  })

  it("places cells for the two-line phone row", () => {
    render(<Table />)
    const value = screen.getByRole("cell", { name: "12m" })
    expect(value.className).toContain("max-md:col-start-2")
    expect(value.className).toContain("text-right")
    const title = screen.getByRole("cell", { name: "Repaid MUSD" })
    expect(title.className).toContain("max-md:row-start-1")
  })

  it("draws an empty state across every column", () => {
    render(
      <DataTable.Root caption="Transactions">
        <DataTable.Body>
          <DataTable.Empty columns={6}>No transactions</DataTable.Empty>
        </DataTable.Body>
      </DataTable.Root>,
    )
    expect(
      screen
        .getByRole("cell", { name: "No transactions" })
        .getAttribute("colspan"),
    ).toBe("6")
  })
})

describe("CursorPager", () => {
  it("links to keyset cursors and disables an end", () => {
    const cursors = { newer: null, older: "13078612:4" }
    render(
      <CursorPager.Root>
        <CursorPager.Summary>Latest 25</CursorPager.Summary>
        <CursorPager.Newer
          href={CursorPager.cursorHref("/txs", "newer", cursors)}
        />
        <CursorPager.Older
          href={CursorPager.cursorHref("/txs", "older", cursors)}
        />
      </CursorPager.Root>,
    )
    const nav = screen.getByRole("navigation", { name: "Pages" })
    const newer = within(nav).getByRole("button", { name: "Newer" })
    expect(newer.hasAttribute("disabled")).toBe(true)
    const older = within(nav).getByRole("link", { name: "Older" })
    expect(older.getAttribute("href")).toBe("/txs?before=13078612%3A4")
    expect(older.getAttribute("rel")).toBe("next")
  })

  it("builds cursor URLs that keep other filters and never offsets", () => {
    const cursors = { newer: "a", older: "b" }
    expect(
      CursorPager.cursorHref("/txs?type=loans&before=x", "newer", cursors),
    ).toBe("/txs?type=loans&after=a")
    expect(CursorPager.cursorHref("/txs", "older", cursors)).toBe(
      "/txs?before=b",
    )
    expect(
      CursorPager.cursorHref("/txs", "older", { newer: "a", older: null }),
    ).toBeNull()
  })

  it("wraps a router link with asChild", () => {
    render(
      <CursorPager.Older asChild>
        <a href="/router/older" data-router="">
          Older
        </a>
      </CursorPager.Older>,
    )
    const link = screen.getByRole("link", { name: "Older" })
    expect(link.getAttribute("href")).toBe("/router/older")
    expect(link.dataset.router).toBe("")
  })
})

describe("HashChip", () => {
  it("shortens addresses to 0x7f3a…91c2 and hashes to 10 and 8", () => {
    expect(HashChip.truncateMiddle(address)).toBe("0x7f3a…91c2")
    expect(
      HashChip.truncateMiddle(
        hash,
        HashChip.defaultLengths.hash.head,
        HashChip.defaultLengths.hash.tail,
      ),
    ).toBe("0x8f3c2e71…5b09a41d")
    expect(HashChip.truncateMiddle("0x1234")).toBe("0x1234")
  })

  it("shows the short value, reads the full one and links", () => {
    render(
      <HashChip.Root value={address}>
        <HashChip.Value href={`/address/${address}`} />
        <HashChip.Copy />
      </HashChip.Root>,
    )
    const link = screen.getByRole("link")
    expect(link.textContent).toContain("0x7f3a…91c2")
    expect(link.getAttribute("title")).toBe(address)
    expect(within(link).getByText(address).className).toContain("sr-only")
  })

  it("copies the full value and says so", async () => {
    // The clock moves only when the test moves it: with time following
    // the real clock, a slow click on a loaded machine let the 1.5 s
    // "Copied" lapse before it was read. Only timeouts are faked, and the
    // click is a plain event inside act, which waits on microtasks alone
    // (user-event waits on a timeout of its own that would never fire).
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    render(<HashChip.Root value={hash} kind="hash" />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy hash" }))
    })
    expect(writeText).toHaveBeenCalledWith(hash)
    expect(screen.getByRole("status").textContent).toBe("Copied")
    act(() => {
      vi.advanceTimersByTime(HashChip.copiedMs)
    })
    expect(screen.getByRole("status").textContent).toBe("")
  })
})

describe("Age", () => {
  const timestamp = Date.UTC(2026, 10, 8, 11, 53, 40) / 1000

  it("formats ages and UTC timestamps", () => {
    expect(Age.formatAge(4)).toBe("4s")
    expect(Age.formatAge(12 * 60)).toBe("12m")
    expect(Age.formatAge(3 * 3600 + 5)).toBe("3h")
    expect(Age.formatAge(-3)).toBe("0s")
    expect(Age.formatTimestamp(timestamp)).toBe("Sun 8 Nov 2026, 11:53:40 UTC")
    expect(Age.tickMs(30)).toBe(1000)
    expect(Age.tickMs(7200)).toBe(60_000)
  })

  it("renders against the server's now, as a time element", () => {
    const html = renderToString(
      <Age.Root timestamp={timestamp} now={timestamp + 4} suffix />,
    )
    expect(html).toContain(">4s ago</time>")
    expect(html).toContain('dateTime="2026-11-08T11:53:40.000Z"')
    // The full time is a tip (hover, focus, tap), not a title.
    expect(html).not.toContain("title=")
    expect(html).toContain('tabindex="0"')
  })

  it("shows the full UTC time on focus, which a tap gives", () => {
    const { container } = render(
      <Age.Root timestamp={timestamp} now={timestamp + 4} suffix />,
    )
    act(() => {
      container.querySelector("time")?.focus()
    })
    expect(screen.getByRole("tooltip").textContent).toBe(
      "Sun 8 Nov 2026, 11:53:40 UTC",
    )
  })

  it("keeps the title inside a link, where the link takes the tap", () => {
    const html = renderToString(
      <Age.Root timestamp={timestamp} now={timestamp + 4} tip={false} />,
    )
    expect(html).toContain('title="Sun 8 Nov 2026, 11:53:40 UTC"')
    expect(html).not.toContain("tabindex")
  })

  it("keeps the age current in the browser", () => {
    vi.useFakeTimers()
    vi.setSystemTime((timestamp + 10) * 1000)
    render(<Age.Root timestamp={timestamp} now={timestamp} />)
    expect(screen.getByText("10s")).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByText("15s")).toBeTruthy()
  })
})

describe("StatusChip", () => {
  it("says the state in words with an icon", () => {
    render(
      <>
        <StatusChip.Root tone={StatusChip.txTone("success")}>
          Success
        </StatusChip.Root>
        <StatusChip.Root tone="negative" variant="chip">
          Failed
        </StatusChip.Root>
      </>,
    )
    const success = screen.getByText("Success")
    expect(success.className).toContain("text-pos")
    expect(success.querySelector("svg")).not.toBeNull()
    expect(screen.getByText("Failed").className).toContain("bg-neg-soft")
    expect(StatusChip.txTone("pending")).toBe("pending")
  })
})

describe("Breadcrumbs", () => {
  it("is a named list with the current page marked", () => {
    render(
      <Breadcrumbs.Root>
        <Breadcrumbs.Item href="/network">Network</Breadcrumbs.Item>
        <Breadcrumbs.Item asChild>
          <a href="/blocks">Blocks</a>
        </Breadcrumbs.Item>
        <Breadcrumbs.Current mono>13,078,795</Breadcrumbs.Current>
      </Breadcrumbs.Root>,
    )
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" })
    expect(within(nav).getAllByRole("listitem")).toHaveLength(3)
    expect(within(nav).getByRole("link", { name: "Blocks" })).toBeTruthy()
    expect(
      within(nav).getByText("13,078,795").getAttribute("aria-current"),
    ).toBe("page")
  })
})

describe("RawViewer", () => {
  const decoded = {
    name: "repay(uint256 amount)",
    params: [
      { name: "amount", type: "uint256", value: "5000000000000000000000" },
    ],
  }

  it("toggles between the decoded call and the raw input", async () => {
    const user = userEvent.setup()
    render(
      <RawViewer.Root
        title="Input"
        decoded={decoded}
        raw={{ kind: "input", data: "0x371fd8e6000000" }}
      />,
    )
    const section = screen.getByRole("region", { name: "Input" })
    expect(within(section).getByText("repay(uint256 amount)")).toBeTruthy()
    expect(
      within(section).getByRole("rowheader", { name: "amount" }),
    ).toBeTruthy()
    await user.click(within(section).getByRole("radio", { name: "Raw" }))
    expect(within(section).getByText("0x371fd8e6000000")).toBeTruthy()
    expect(within(section).getByRole("button", { name: "Copy" })).toBeTruthy()
  })

  it("shows raw topics and data without a toggle when nothing decoded", () => {
    render(
      <RawViewer.Root
        title="Log 3"
        decoded={null}
        raw={{ kind: "log", topics: ["0xddf2", "0x0001"], data: "0x00ff" }}
      />,
    )
    expect(screen.queryByRole("radiogroup")).toBeNull()
    expect(screen.getByText("Topic 1")).toBeTruthy()
    expect(screen.getByText("0x00ff")).toBeTruthy()
  })
})

describe("SubTabs", () => {
  it("lists link tabs that scroll sideways only, the current one marked", () => {
    render(
      <SubTabs.Root label="Gauge types" className="mt-5">
        <SubTabs.Item>
          <a href="/gauges" aria-current="page">
            All
          </a>
        </SubTabs.Item>
        <SubTabs.Item>
          <a href="/gauges?type=pool">Pools</a>
        </SubTabs.Item>
      </SubTabs.Root>,
    )
    const nav = screen.getByRole("navigation", { name: "Gauge types" })
    expect(nav.className).toContain("mt-5")
    const list = within(nav).getByRole("list")
    expect(list.className).toContain("scroll-row")
    const links = within(list).getAllByRole("link")
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link.className).toContain(SubTabs.itemClass)
      // No negative margin pulling the underline out of the row.
      expect(link.className).not.toContain("-mb-px")
    }
    expect(links[0]?.getAttribute("aria-current")).toBe("page")
    expect(links[1]?.getAttribute("aria-current")).toBeNull()
  })
})
