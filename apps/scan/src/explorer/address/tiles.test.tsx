import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"
import { documentTokenBalance } from "../../data/entities.server"
import { tokenBalance } from "../../data/views"
import { Tiles } from "./tiles"

/** Amounts nobody can know are said so, never shown as a number. */

/** Renders `node` inside a router, so its links resolve. */
async function inRouter(node: ReactNode): Promise<void> {
  const root = createRootRoute({ component: () => node })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
  render(<RouterProvider router={router} />)
  await router.load()
}

const noTokens = { status: "ok" as const, data: { items: [], more: false } }
const unavailable = { status: "unavailable" as const }

describe("the address tiles", () => {
  it("say the wallet balance is not available, not 0 BTC", () => {
    render(
      <Tiles
        balance={null}
        tokens={noTokens}
        borrow={unavailable}
        locks={unavailable}
      />,
    )
    expect(screen.getByText("Not available")).toBeTruthy()
    expect(screen.queryByText(/0\.0000/)).toBeNull()
  })
})

describe("the wallet tile's balances", () => {
  const balance = (index: number) =>
    tokenBalance({
      token: {
        address_hash: `0x${index.toString(16).padStart(40, "0")}`,
        symbol: `T${index}`,
        name: null,
        decimals: "18",
        type: "ERC-20",
      },
      value: "1000000000000000000",
    })
  const tiles = (items: ReturnType<typeof balance>[], more: boolean) =>
    inRouter(
      <Tiles
        balance="1.0000"
        tokens={{ status: "ok", data: { items, more } }}
        borrow={unavailable}
        locks={unavailable}
      />,
    )

  it("say they are the first page when the address holds more", async () => {
    // As live: a full first page of 50, and a next page after it.
    await tiles(
      Array.from({ length: 50 }, (_, index) => balance(index + 1)),
      true,
    )
    expect(
      await screen.findByText(
        "4 of the first 50 balances shown. This address holds more.",
      ),
    ).toBeTruthy()
  })

  it("count the balances a short list leaves out, and say nothing for a few", async () => {
    await tiles(
      Array.from({ length: 9 }, (_, index) => balance(index + 1)),
      false,
    )
    expect(await screen.findByText("4 of 9 balances shown")).toBeTruthy()
    cleanup()
    await tiles([balance(1), balance(2)], false)
    expect(await screen.findByText("T1")).toBeTruthy()
    expect(screen.queryByText(/balances shown/)).toBeNull()
  })
})

describe("a balance whose token never said its decimals", () => {
  const token = {
    address_hash: "0x00000000000000000000000000000000000000aa",
    symbol: "ODD",
    name: "Odd",
    decimals: null,
  }

  it("labels a fungible amount as raw units", () => {
    expect(
      tokenBalance({ token: { ...token, type: "ERC-20" }, value: "1500000" })
        .amount,
    ).toBe("1,500,000 raw units")
    expect(
      documentTokenBalance({
        token: {
          address: token.address_hash,
          symbol: "ODD",
          name: "Odd",
          decimals: null,
        },
        value: "1500000",
        value_usd: null,
        priced_as: null,
      }).amount,
    ).toBe("1,500,000 raw units")
  })

  it("keeps an NFT's count as a count", () => {
    expect(
      tokenBalance({ token: { ...token, type: "ERC-721" }, value: "4" }).amount,
    ).toBe("4")
  })
})
