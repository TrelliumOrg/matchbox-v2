import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"
import type { TvlView } from "../../data/network"
import { TvlPanel } from "./network-values"

async function inRouter(node: ReactNode): Promise<void> {
  const root = createRootRoute({ component: () => node })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/network"] }),
  })
  render(<RouterProvider router={router} />)
  await router.load()
}

const period = {
  range: "30d" as const,
  from: "2026-10-21",
  to: "2026-11-20",
  min: "2025-05-06",
  max: "2026-11-20",
  text: "30d",
}

function tvl(unpriced: string[]): TvlView {
  return {
    figure: "$17.48B",
    change: null,
    parts: [{ label: "veBTC", value: "$17.47B", bps: 10_000 }],
    missing: [],
    apart: null,
    history: null,
    unpriced,
  }
}

/** Seventeen pool tokens without a symbol, as mainnet's TVL card had. */
const addresses = Array.from(
  { length: 17 },
  (_, index) => `0x${(index + 1).toString(16).padStart(2, "0").repeat(20)}`,
)

describe("the TVL card's unpriced tokens", () => {
  it("counts a long list and keeps the addresses one tap away", async () => {
    await inRouter(<TvlPanel tvl={tvl(addresses)} period={period} />)
    const summary = screen.getByText("No price: 17 tokens")
    expect(summary.tagName).toBe("SUMMARY")
    const links = screen.getAllByRole("link", { hidden: true })
    expect(links).toHaveLength(17)
    expect(links[0]?.getAttribute("href")).toBe(`/address/${addresses[0]}`)
    expect(document.body.textContent).not.toContain(addresses[0])
  })

  it("names a few inline", async () => {
    await inRouter(<TvlPanel tvl={tvl(["sMUSD"])} period={period} />)
    expect(screen.getByText(/No price:/).textContent).toBe("No price: sMUSD")
  })
})
