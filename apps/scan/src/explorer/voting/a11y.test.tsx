import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"
import type { PoolPanels } from "../../data/gauges"
import type { LocksPage } from "../../data/locks"
import { Votes } from "../address/votes"
import { ColumnBars } from "./governance-panels"
import { LocksView } from "./locks-page"
import { GaugePicture, ShareBar } from "./parts"
import { PoolCards } from "./pool-panels"

/**
 * Accessibility and privacy of the voting pages' pieces: valid
 * description lists, one name per navigation, headings in order, and
 * gauge images that send no referrer.
 */

/** Renders `node` inside a router, so its links resolve. */
async function inRouter(node: ReactNode): Promise<HTMLElement> {
  const root = createRootRoute({ component: () => node })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
  const { container } = render(<RouterProvider router={router} />)
  await router.load()
  return container
}

const empty = { status: "ok" as const, data: { points: [] } }

describe("the voting pages' markup", () => {
  it("keeps only dt and dd in each group of a share bar's list", () => {
    const { container } = render(
      <ShareBar
        label="veBTC votes"
        segments={[
          { label: "Validators", value: "96.4 veBTC", bps: 6000 },
          { label: "Pools", value: "64.3 veBTC", bps: 4000 },
        ]}
      />,
    )
    const groups = container.querySelectorAll("dl > div")
    expect(groups).toHaveLength(2)
    for (const group of groups) {
      const tags = [...group.children].map((child) => child.tagName)
      expect(tags.every((tag) => tag === "DT" || tag === "DD")).toBe(true)
    }
  })

  it("loads gauge images with no referrer", () => {
    const { container } = render(
      <GaugePicture
        picture={{ kind: "image", url: "https://example.org/logo.png" }}
      />,
    )
    expect(container.querySelector("img")?.getAttribute("referrerpolicy")).toBe(
      "no-referrer",
    )
  })

  it("names each period toggle on a pool gauge by its chart", async () => {
    const pool = {
      name: "BTC/MUSD",
      volumeLabel: "BTC swapped into BTC/MUSD",
      liquidityLabel: "BTC in BTC/MUSD",
      facts: [],
      volume: empty,
      volumeStats: [],
      liquidity: empty,
      liquidityStats: [],
      tickers: ["BTC", "MUSD"],
    } as unknown as PoolPanels
    await inRouter(
      <PoolCards
        pool={pool}
        period={{
          range: "30d",
          from: "2026-10-18",
          to: "2026-11-16",
          min: "2025-05-06",
          max: "2026-11-16",
          text: "30d",
        }}
        gauge={`0x${"21".repeat(20)}`}
      />,
    )
    const names = screen
      .getAllByRole("navigation")
      .map((nav) => nav.getAttribute("aria-label"))
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(names.length)
  })

  it("names each period toggle on the locks page by its chart", async () => {
    const page = {
      escrow: "vebtc",
      order: "amount",
      period: {
        range: "30d",
        from: "2026-10-18",
        to: "2026-11-16",
        min: "2025-05-06",
        max: "2026-11-16",
        text: "30d",
      },
      paged: false,
      list: { status: "ok", data: { rows: [], next: null, expired: 0 } },
      locked: empty,
      lockedStats: [],
      net: empty,
      netStats: [],
      distribution: { status: "unavailable" },
      now: 0,
    } as unknown as LocksPage
    await inRouter(<LocksView page={page} />)
    const periods = screen
      .getAllByRole("navigation")
      .map((nav) => nav.getAttribute("aria-label") ?? "")
      .filter((name) => name.startsWith("Period"))
    expect(periods).toHaveLength(2)
    expect(new Set(periods).size).toBe(2)
  })

  it("heads an address's votes with an h2 above each epoch's h3", async () => {
    const container = await inRouter(
      <Votes
        votes={{
          partial: false,
          epochs: [
            {
              epoch: 47,
              votes: [
                {
                  epoch: 47,
                  epochStart: 0,
                  gauge: `0x${"4d".repeat(20)}`,
                  gaugeName: "Kiln Labs",
                  escrow: "vemezo",
                  id: "2207",
                  weight: "12,000 veMEZO",
                  votedAt: 0,
                  carried: false,
                },
              ],
            },
          ],
        }}
      />,
    )
    const levels = [...container.querySelectorAll("h1, h2, h3, h4")].map(
      (heading) => Number(heading.tagName.slice(1)),
    )
    expect(levels[0]).toBe(2)
    for (const [index, level] of levels.entries()) {
      if (index > 0) expect(level - (levels[index - 1] ?? 0)).toBeLessThan(2)
    }
  })

  it("counts one lock in the singular on a lock column", () => {
    render(
      <ColumnBars
        label="Lock length"
        columns={[
          {
            label: "1 week",
            value: 1,
            text: "1.0000 BTC",
            short: "1 BTC",
            count: 1,
            tone: "acc",
          },
          {
            label: "4 years",
            value: 2,
            text: "2.0000 BTC",
            short: "2 BTC",
            count: 1_200,
            tone: "acc",
          },
        ]}
      />,
    )
    const [one, many] = screen.getAllByRole("listitem")
    expect(one?.getAttribute("aria-label")).toBe("1 week: 1.0000 BTC, 1 lock")
    expect(one?.getAttribute("data-inspect-label")).toBe("1 week, 1 lock")
    expect(many?.getAttribute("aria-label")).toBe(
      "4 years: 2.0000 BTC, 1,200 locks",
    )
  })
})
