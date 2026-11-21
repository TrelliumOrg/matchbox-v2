import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { LiveProvider } from "@matchbox/live/context"
import { render, screen, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { borrowFigures } from "../data/borrow"
import { emptyFigures, type HomeFigures } from "../data/figures"
import {
  borrowTotalsFixtures,
  fixtureFigures,
  fixtureNames,
  longValidatorName,
  unnamedProposer,
} from "../data/fixtures"
import { shortAddress } from "../data/validators"
import { ProCard, ScanCard } from "./cards"
import { FiguresProvider } from "./live"
import { ownRoutes, reviewedLinks } from "./reviewed-links"
import { Classic, Footer, Header, Support } from "./sections"
import { stuartQuestions } from "./stuart"

const renderedAt = Date.UTC(2026, 10, 8, 12)

// The browser's clock is the test's: the page reads it once hydrated.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(renderedAt)
})

afterEach(() => {
  vi.useRealTimers()
})

function Page({
  figures,
  read = () => new Promise<HomeFigures>(() => {}),
  children,
}: {
  figures: HomeFigures
  read?: () => Promise<HomeFigures>
  children: ReactNode
}): ReactNode {
  return (
    <LiveProvider
      head={1}
      config={{ mode: "simulated" }}
      rpc="https://rpc.example"
      pollLatest={() => Promise.resolve(1)}
    >
      <FiguresProvider seed={figures} read={read}>
        {children}
      </FiguresProvider>
    </LiveProvider>
  )
}

/** A figure's text as a screen reader reads it: without aria-hidden parts. */
function live(container: HTMLElement, key: string): string {
  const figure = container.querySelector(`[data-live="${key}"]`)
  if (figure === null) return ""
  const copy = figure.cloneNode(true) as Element
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) {
    hidden.remove()
  }
  return copy.textContent ?? ""
}

describe("the cards on first paint", () => {
  it("paint the snapshot's figures in place, formatted as the frames", () => {
    const { container } = render(
      <Page figures={fixtureFigures(renderedAt)}>
        <ProCard renderedAt={renderedAt} />
        <ScanCard renderedAt={renderedAt} />
      </Page>,
    )
    expect(live(container, "pro.incentivesTotal")).toBe("$14,820")
    expect(live(container, "pro.gauge1.name")).toBe("BTC/MUSD")
    expect(live(container, "pro.gauge1.votes")).toBe("112.40 veBTC")
    expect(live(container, "pro.gauge1.incentives")).toBe("$4,210")
    expect(live(container, "pro.gauge3.votes")).toBe("5.88M veMEZO")
    expect(live(container, "scan.vebtcLocked")).toBe("1,404.32 BTC")
    expect(live(container, "scan.vebtcLockedUsd")).toBe("$148.45M")
    expect(live(container, "scan.borrowed")).toBe("4.06M MUSD")
    expect(live(container, "scan.borrowedEnclaves")).toBe("98.6%")
    expect(live(container, "scan.block1.txns")).toMatch(/^\d+ txns?$/)
    expect(
      container.querySelector('[data-computed="epoch.countdown"]')?.textContent,
    ).toBe("3d 12h")
    expect(
      container.querySelector('[data-computed="epoch.number"]')?.textContent,
    ).toBe("47")
  })

  it("never write zero or a dash", () => {
    const { container } = render(
      <Page figures={fixtureFigures(renderedAt)}>
        <ScanCard renderedAt={renderedAt} />
      </Page>,
    )
    expect(container.textContent).not.toMatch(/\$0\b|—|–/)
  })

  it("say Not available in every live slot when there was never a value", () => {
    const { container } = render(
      <Page figures={emptyFigures}>
        <ProCard renderedAt={renderedAt} />
        <ScanCard renderedAt={renderedAt} />
      </Page>,
    )
    expect(live(container, "pro.incentivesTotal")).toBe("Not available")
    expect(live(container, "scan.vebtcLocked")).toBe("Not available")
    expect(screen.getAllByText("Not available")).toHaveLength(5)
    // The epoch is computed locally, so it shows with no data at all.
    expect(container.textContent).toContain("Closes in 3d 12h")
    expect(container.textContent).not.toMatch(/\$0\b|—|–/)
  })

  it("keep the As of note hidden while the figures are fresh", () => {
    const { container } = render(
      <Page figures={fixtureFigures(renderedAt)}>
        <ProCard renderedAt={renderedAt} />
      </Page>,
    )
    const note = container.querySelector('[data-live="pro.asOf"]')
    expect(note?.getAttribute("data-shown")).toBe("false")
  })

  it("show As of when the fresh request answers with figures read long ago", async () => {
    // The browser's request succeeds, but the edge could not reach the
    // API and answered with what it read 40 minutes before.
    const readAt = renderedAt - 40 * 60_000
    const old = fixtureFigures(readAt)
    const { container } = render(
      <Page figures={old} read={() => Promise.resolve(old)}>
        <ProCard renderedAt={renderedAt} />
        <ScanCard renderedAt={renderedAt} />
      </Page>,
    )
    const note = (key: string) =>
      container.querySelector(`[data-live="${key}"]`)
    await vi.waitFor(
      () => expect(note("pro.asOf")?.getAttribute("data-shown")).toBe("true"),
      { timeout: 5_000 },
    )
    expect(note("scan.asOf")?.getAttribute("data-shown")).toBe("true")
    expect(note("pro.asOf")?.textContent).toMatch(/^As of \d\d:\d\d$/)
  })

  it("show As of on Matchscan alone when only its blocks went stale", async () => {
    const fresh = fixtureFigures(renderedAt)
    const figures = {
      ...fresh,
      at: { ...fresh.at, blocks: renderedAt - 4 * 60_000 },
    }
    const { container } = render(
      <Page figures={figures} read={() => Promise.resolve(figures)}>
        <ProCard renderedAt={renderedAt} />
        <ScanCard renderedAt={renderedAt} />
      </Page>,
    )
    const note = (key: string) =>
      container.querySelector(`[data-live="${key}"]`)
    await vi.waitFor(
      () => expect(note("scan.asOf")?.getAttribute("data-shown")).toBe("true"),
      { timeout: 5_000 },
    )
    expect(note("pro.asOf")?.getAttribute("data-shown")).toBe("false")
  })
})

describe("Matchscan's Borrowed stat", () => {
  /** The fixtures' figures with the given Borrowed stat (null: none). */
  function withBorrow(stat: ReturnType<typeof borrowFigures>): HomeFigures {
    const figures = fixtureFigures(renderedAt)
    return {
      ...figures,
      scan: {
        ...figures.scan,
        borrowedMusd: stat?.borrowedMusd ?? null,
        borrowedEnclaves: stat?.borrowedEnclaves ?? null,
        borrowedSeries: stat?.borrowedSeries ?? null,
      },
    }
  }

  function stat(container: HTMLElement): Element {
    const slot = container.querySelector('[data-live="scan.borrowed"]')
    const box = slot?.closest(".st")
    if (box === null || box === undefined) throw new Error("no Borrowed stat")
    return box
  }

  function sparkline(container: HTMLElement): string | null {
    const line = container.querySelector(
      '[data-live="scan.borrowedSeries"] path[fill="none"]',
    )
    return line === null ? null : (line.getAttribute("d") ?? "")
  }

  function paint(figures: HomeFigures): HTMLElement {
    return render(
      <Page figures={figures}>
        <ScanCard renderedAt={renderedAt} />
      </Page>,
    ).container
  }

  const normal = () => borrowFigures(borrowTotalsFixtures.normal(renderedAt))

  it("shows MUSD abbreviated, the Enclaves share and the sparkline", () => {
    const container = paint(withBorrow(normal()))
    expect(live(container, "scan.borrowed")).toBe("4.06M MUSD")
    expect(stat(container).querySelector(".s")?.textContent).toBe(
      "98.6% in Enclaves",
    )
    expect(stat(container).textContent).not.toContain("$")
    expect(sparkline(container)?.match(/M/g)).toHaveLength(1)
  })

  it("says Not available with no total, with no subline and no sparkline", () => {
    const container = paint(
      withBorrow(borrowFigures(borrowTotalsFixtures.missingVenue(renderedAt))),
    )
    expect(live(container, "scan.borrowed")).toBe("Not available")
    expect(stat(container).querySelector(".s")?.textContent).toBe("")
    expect(sparkline(container)).toBeNull()
  })

  it("leaves the subline out when the share is missing", () => {
    const stat0 = normal()
    const container = paint(
      withBorrow(stat0 === null ? null : { ...stat0, borrowedEnclaves: null }),
    )
    expect(live(container, "scan.borrowed")).toBe("4.06M MUSD")
    expect(stat(container).querySelector(".s")?.textContent).toBe("")
  })

  it("draws the history's gaps as gaps", () => {
    const container = paint(
      withBorrow(borrowFigures(borrowTotalsFixtures.gaps(renderedAt))),
    )
    // Two pieces, either side of the missing day, and nothing drawn
    // before the closes start.
    expect(sparkline(container)?.match(/M/g)).toHaveLength(2)
    expect(sparkline(container)?.startsWith("M0 ")).toBe(false)
  })

  it("draws no sparkline from fewer than two days", () => {
    const stat0 = normal()
    const container = paint(
      withBorrow(stat0 === null ? null : { ...stat0, borrowedSeries: null }),
    )
    expect(live(container, "scan.borrowed")).toBe("4.06M MUSD")
    expect(sparkline(container)).toBeNull()
  })
})

describe("Latest blocks", () => {
  const harbor = "0x41b1a7f633eb9dac1fc19adae41aa7562c620971"

  /** The fixtures with the three blocks proposed by `proposers`. */
  function proposedBy(proposers: readonly string[]): HomeFigures {
    const figures = fixtureFigures(renderedAt)
    const blocks = (figures.scan.blocks ?? []).map((block, index) => ({
      ...block,
      address: harbor,
      proposer: proposers[index] ?? block.proposer,
    }))
    return { ...figures, scan: { ...figures.scan, blocks } }
  }

  /** A row's name, its no-break spaces (cards.tsx) read as spaces. */
  const spokenName = (container: HTMLElement, row: number): string =>
    live(container, `scan.block${row}.validator`).replaceAll(" ", " ")

  it("show each validator's name, else its short address, never blank", () => {
    const figures = fixtureFigures(renderedAt)
    const container = render(
      <Page figures={figures}>
        <ScanCard renderedAt={renderedAt} />
      </Page>,
    ).container
    const shown = [1, 2, 3].map((row) => spokenName(container, row))
    for (const name of shown) {
      expect(name).not.toBe("")
      expect(name).not.toMatch(/unknown/i)
    }
    // At most one of three blocks in a row is the unnamed proposer's.
    expect(
      shown.filter((name) => name === shortAddress(unnamedProposer)),
    ).toHaveLength(
      (figures.scan.blocks ?? []).filter(
        (block) => block.address === unnamedProposer,
      ).length,
    )
    expect(
      shown.filter((name) => Object.values(fixtureNames).includes(name)).length,
    ).toBeGreaterThanOrEqual(2)
  })

  it("swap a name in for its address when it arrives after first paint", async () => {
    const painted = proposedBy([shortAddress(harbor), "Copperline", "x"])
    const named = proposedBy([longValidatorName, "Copperline", "x"])
    const container = render(
      <Page figures={painted} read={() => Promise.resolve(named)}>
        <ScanCard renderedAt={renderedAt} />
      </Page>,
    ).container
    expect(spokenName(container, 1)).toBe("0x41b1…0971")
    await vi.waitFor(
      () => expect(spokenName(container, 1)).toBe(longValidatorName),
      { timeout: 5_000 },
    )
    // In full on hover; one line, cut by the cell (styles.css).
    expect(
      container
        .querySelector('[data-live="scan.block1.validator"]')
        ?.getAttribute("title"),
    ).toBe(longValidatorName)
    const css = readFileSync(join(__dirname, "..", "styles.css"), "utf8")
    expect(css).toMatch(
      /\.br \.s \[torph-root\] \{[^}]*max-width: 100%;[^}]*text-overflow: ellipsis;/,
    )
  })

  it("keep three digits' room for the transaction count", () => {
    // styles.css gives `.tc` a hidden "000" in the count's grid cell, so
    // the cell is as wide at 9 as at 10 and the count never moves (the
    // smoke tests measure it).
    const css = readFileSync(join(__dirname, "..", "styles.css"), "utf8")
    expect(css).toMatch(/\.br \.tc::before \{[^}]*content: "000";/)
    const figures = fixtureFigures(renderedAt)
    const blocks = (figures.scan.blocks ?? []).map((block, index) => ({
      ...block,
      transactions: [9, 10, 100][index] ?? 0,
    }))
    const container = render(
      <Page figures={{ ...figures, scan: { ...figures.scan, blocks } }}>
        <ScanCard renderedAt={renderedAt} />
      </Page>,
    ).container
    for (const [index, count] of ["9", "10", "100"].entries()) {
      const key = `scan.block${index + 1}.txns`
      expect(live(container, key)).toBe(`${count} txns`)
      expect(
        container.querySelector(`[data-live="${key}"] .tc`)?.textContent,
      ).toBe(count)
    }
  })

  it("keep both units in place and show one, so the word never changes", () => {
    const figures = fixtureFigures(renderedAt)
    const blocks = (figures.scan.blocks ?? []).map((block, index) => ({
      ...block,
      transactions: [1, 2, 0][index] ?? 0,
    }))
    const container = render(
      <Page figures={{ ...figures, scan: { ...figures.scan, blocks } }}>
        <ScanCard renderedAt={renderedAt} />
      </Page>,
    ).container
    expect(live(container, "scan.block1.txns")).toBe("1 txn")
    expect(live(container, "scan.block2.txns")).toBe("2 txns")
    expect(live(container, "scan.block3.txns")).toBe("0 txns")
    const units = [
      ...container.querySelectorAll(
        '[data-live="scan.block1.txns"] .tu > span',
      ),
    ].map((unit) => `${unit.textContent}:${unit.getAttribute("aria-hidden")}`)
    expect(units).toEqual(["txn:false", "txns:true"])
  })
})

describe("Matchscan's search", () => {
  it("is a plain GET form to this Worker's search route", () => {
    render(
      <Page figures={emptyFigures}>
        <ScanCard renderedAt={renderedAt} />
      </Page>,
    )
    const form = screen.getByRole("searchbox").closest("form")
    if (form === null) throw new Error("the search field is not in a form")
    expect(form.closest("search")).not.toBeNull()
    // `/search` here redirects to the matching Matchscan page (search.ts).
    expect(form.getAttribute("action")).toBe("/search")
    expect(form.getAttribute("method")).toBe("get")
    expect(within(form).getByRole("searchbox").getAttribute("name")).toBe("q")
  })
})

describe("the static parts", () => {
  it("link every product to its real address", () => {
    render(
      <>
        <Header />
        <Classic />
        <Footer />
      </>,
    )
    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"))
    for (const href of [
      "https://pro.matchbox.markets/?from=home",
      "https://scan.matchbox.markets",
      "https://id.matchbox.markets",
      "https://developer.matchbox.markets",
      "https://docs.matchbox.markets",
      "https://app.matchbox.markets",
    ]) {
      expect(hrefs).toContain(href)
    }
    expect(screen.getByText("The original Matchbox app")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Open Classic" }).getAttribute("href"),
    ).toBe("https://app.matchbox.markets")
  })

  it("link only own routes and reviewed addresses from the footer", () => {
    const { container } = render(<Footer />)
    const hrefs = [...container.querySelectorAll("a[href]")].map(
      (link) => link.getAttribute("href") ?? "",
    )
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) {
      if (href.startsWith("/")) expect(ownRoutes).toContain(href)
      else expect(Object.keys(reviewedLinks)).toContain(href)
    }
    // Classic has no Terms page (README, Open questions).
    expect(hrefs.some((href) => href.includes("/terms"))).toBe(false)
  })

  it("give the phone a menu button that opens every product and the theme", () => {
    render(<Header />)
    const button = screen.getByRole("button", { name: "Menu" })
    const id = button.getAttribute("popovertarget")
    if (id === null) throw new Error("the menu button opens no popover")
    const menu = document.getElementById(id)
    if (menu === null) throw new Error("the menu button's popover is missing")
    expect(menu.getAttribute("popover")).toBe("auto")
    const hrefs = [...menu.querySelectorAll("a")].map((link) =>
      link.getAttribute("href"),
    )
    expect(hrefs).toEqual([
      "https://pro.matchbox.markets/?from=home",
      "https://scan.matchbox.markets",
      "https://id.matchbox.markets",
      "https://developer.matchbox.markets",
      "https://docs.matchbox.markets",
    ])
    // Its own radio group, so it never steals the header switch's choice.
    const names = new Set(
      [...document.querySelectorAll('input[type="radio"]')].map(
        (input) => (input as HTMLInputElement).name,
      ),
    )
    expect(names.size).toBe(2)
    expect(menu.querySelectorAll('input[type="radio"]')).toHaveLength(3)
  })

  it("start Stuart on the owner's line, with four to six short questions", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    render(<Support />)
    expect(screen.getByText("Ask about your locks.")).toBeTruthy()
    expect(stuartQuestions.length).toBeGreaterThanOrEqual(4)
    expect(stuartQuestions.length).toBeLessThanOrEqual(6)
    for (const question of stuartQuestions) {
      expect(question.split(" ").length).toBeLessThanOrEqual(5)
    }
    vi.unstubAllGlobals()
  })
})

describe("nothing personal", () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? files(path) : [path]
    })
  }

  it("has no wallet code: no wallet package, no wagmi, no viem", () => {
    const root = join(__dirname, "..", "..")
    const manifest = readFileSync(join(root, "package.json"), "utf8")
    expect(manifest).not.toMatch(/@matchbox\/wallet|wagmi|viem|walletconnect/i)
    for (const file of files(join(root, "src"))) {
      if (file.endsWith(".test.tsx") || file.endsWith(".test.ts")) continue
      expect(readFileSync(file, "utf8")).not.toMatch(
        /from "(@matchbox\/wallet|wagmi|viem)/,
      )
    }
  })
})
