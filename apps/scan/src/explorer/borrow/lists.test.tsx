import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"
import type { MarketDetailView } from "../../data/scan/borrow-views"
import { LiquidationList, marketOrder } from "./lists"

async function inRouter(node: ReactNode): Promise<void> {
  const root = createRootRoute({ component: () => node })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
  render(<RouterProvider router={router} />)
  await router.load()
}

describe("a liquidation row", () => {
  it("wraps its amounts rather than cutting them, each figure with its unit", async () => {
    await inRouter(
      <LiquidationList
        label="Liquidations"
        empty="None"
        rows={[
          {
            key: "a",
            day: "Fri 28 Aug",
            timestamp: 0,
            borrower: `0x${"18".repeat(20)}`,
            loan: { kind: "trove" },
            detail: "-300,758.66 MUSD, -4.4470 BTC",
            txHash: `0x${"ab".repeat(32)}`,
          },
        ]}
      />,
    )
    const detail = screen.getByText(/MUSD trove/)
    expect(detail.className).not.toMatch(/\btruncate\b/)
    expect(detail.textContent).toBe("MUSD trove, -300,758.66 MUSD, -4.4470 BTC")
  })
})

function market(
  id: string,
  supplied: string | null,
  borrowed: string | null,
): MarketDetailView {
  return {
    id,
    name: "BTC / MUSD",
    loan: { symbol: "MUSD", decimals: 18 },
    collateral: { symbol: "BTC", decimals: 18 },
    lltv: "86%",
    supplied,
    borrowed,
    utilization: null,
    borrowApr: null,
    price: null,
    loanToken: "0x01",
    collateralToken: "0x02",
    oracle: "0x03",
    irm: "0x04",
    fee: "0%",
    utilizationShare: null,
    supplyApy: null,
    available: null,
    liquidationIncentive: "4.38%",
    block: 1,
    updatedAt: 1,
  }
}

describe("the Morpho markets list", () => {
  it("lists a market nobody uses after the ones in use", () => {
    const empty = market("0x29c2", null, null)
    const zero = market("0x0000", "0.00 MUSD", "0.00 MUSD")
    const used = market("0x6f88", "2,500,000.00 mUSDC", "1,800,000.00 mUSDC")
    const small = market("0x4bff", "5,000.00 MUSD", "0.00 MUSD")
    expect(
      marketOrder([empty, used, zero, small]).map((each) => each.id),
    ).toEqual(["0x6f88", "0x4bff", "0x29c2", "0x0000"])
  })
})
