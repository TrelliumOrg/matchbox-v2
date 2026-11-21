import {
  demoChainHead,
  demoPrices,
} from "@matchbox/contracts/read-models/fixtures"
import { describe, expect, it, vi } from "vitest"
import { fixtureHead } from "./blockscout/fixtures"
import { fixtureResponse } from "./fixtures"
import { isActive, sectionFor, sections } from "./sections"
import {
  borrowDelayNote,
  chainSeconds,
  delayedNote,
  epochAt,
  percentToBps,
  readShell,
  toShell,
} from "./shell"
import { shellQuery } from "./shell-context"

// The server function module reads the Worker env; tests need its shape only.
vi.mock("./shell-fn", () => ({ getShell: vi.fn() }))

describe("the delay note", () => {
  it("names what is behind where known", () => {
    expect(delayedNote([])).toBe(
      "Some data is delayed: a few lists and figures are behind the chain while Matchscan's updates catch up.",
    )
    expect(delayedNote(["activity"])).toBe(
      "Some data is delayed: activity is behind the chain while Matchscan's updates catch up.",
    )
    expect(delayedNote(["incentives"])).toContain(": incentives are behind")
    expect(delayedNote(["activity", "votes", "loans"])).toContain(
      ": activity, votes and loans are behind",
    )
  })
})

describe("shell seed", () => {
  it("formats prices for the slot without floats", () => {
    expect(percentToBps("1.8")).toBe(180)
    expect(percentToBps("-2.405")).toBe(-241)
    expect(percentToBps("0.004")).toBe(0)
    expect(percentToBps("0.005")).toBe(1)
    expect(percentToBps("12")).toBe(1200)
    // Digits past what a float holds still round exactly.
    expect(percentToBps("1.23499999999999999999")).toBe(123)
    expect(percentToBps("123456789012.345")).toBe(12_345_678_901_235)
    const shell = toShell(
      demoChainHead,
      {
        btc: {
          usd: "105710",
          change24h: "1.8",
          source: "mezo-oracle",
          updatedAt: 1,
        },
        mezo: null,
      },
      { mode: "simulated" },
      "https://rpc.test",
      demoChainHead.timestamp,
    )
    expect(shell.prices.btc).toEqual({
      price: "$105,710",
      change: "+1.8%",
      trend: "up",
    })
    expect(shell.prices.mezo).toBeNull()
    expect(shell.head?.number).toBe(demoChainHead.block)
  })

  it("numbers epochs from Thu 11 Dec 2025", () => {
    const thursday = Date.UTC(2026, 10, 5, 0, 0, 1) / 1000
    expect(epochAt(thursday)).toEqual({
      number: 47,
      endsAt: Date.UTC(2026, 10, 12) / 1000,
    })
  })

  it("serves the demo head and prices in fixtures mode", () => {
    expect(fixtureResponse("/internal/pro/head")).toEqual({
      status: 200,
      body: { data: fixtureHead },
    })
    expect(fixtureResponse("/internal/pro/prices").body).toEqual({
      data: demoPrices,
    })
    expect(fixtureResponse("/internal/scan/unknown").status).toBe(404)
  })
})

describe("a shell that always renders", () => {
  const options = {
    live: { mode: "simulated" } as const,
    rpc: "https://rpc.test",
    nowSeconds: Date.UTC(2026, 10, 9) / 1000,
  }
  const down = async (): Promise<never> => {
    throw new Error("503 service_disabled")
  }

  it("is whole and cacheable when both reads answer", async () => {
    const shell = await readShell(
      { head: async () => demoChainHead, prices: async () => demoPrices },
      options,
    )
    expect(shell.degraded).toBe(false)
    expect(shell.head?.number).toBe(demoChainHead.block)
  })

  it("renders without prices", async () => {
    const shell = await readShell(
      { head: async () => demoChainHead, prices: down },
      options,
    )
    expect(shell.prices).toEqual({ btc: null, mezo: null })
    expect(shell.head?.number).toBe(demoChainHead.block)
    expect(shell.degraded).toBe(true)
  })

  it("renders without a head, its epoch from the clock", async () => {
    const shell = await readShell(
      { head: down, prices: async () => demoPrices },
      options,
    )
    expect(shell.head).toBeNull()
    expect(shell.epoch).toEqual(epochAt(options.nowSeconds))
    expect(shell.prices.btc).not.toBeNull()
    expect(shell.degraded).toBe(true)
  })

  it("never rejects, even with every read down", async () => {
    const shell = await readShell({ head: down, prices: down }, options)
    expect(shell).toMatchObject({ head: null, degraded: true })
  })
})

describe("sections", () => {
  it("lists the nine nav sections with five phone tabs including More", () => {
    expect(sections.map((section) => section.label)).toEqual([
      "Home",
      "Network",
      "Borrow",
      "Pools",
      "Gauges",
      "Validators",
      "Locks",
      "Epochs",
      "Tokens",
    ])
    // Network moves under More on phones to make room for Pools.
    expect(
      sections
        .filter((section) => section.phoneTab)
        .map((section) => section.label),
    ).toEqual(["Home", "Borrow", "Pools", "Gauges"])
  })

  it("marks the section an entity page belongs to", () => {
    const network = sectionFor("network")
    expect(isActive(network, "/tx/0xab")).toBe(true)
    expect(isActive(network, "/networks")).toBe(false)
    expect(isActive(sectionFor("home"), "/network")).toBe(false)
    expect(isActive(sectionFor("epochs"), "/epochs/47")).toBe(true)
    expect(isActive(sectionFor("pools"), "/pools/ethereum/0xab")).toBe(true)
  })
})

describe("the chain clock", () => {
  const head = {
    number: 1000,
    timestamp: Date.UTC(2026, 10, 11, 23, 59) / 1000,
  }
  const shell = { head, renderedAt: 0 }

  it("moves on 3.8s a block from the shell's head", () => {
    expect(chainSeconds(shell, 1000)).toBe(head.timestamp)
    expect(chainSeconds(shell, 1010)).toBe(head.timestamp + 38)
    expect(chainSeconds(shell, 990)).toBe(head.timestamp)
  })

  it("rolls the epoch over at the boundary instead of stopping at 0s", () => {
    // 23:59 Wed 11 Nov: Epoch 47, a minute left. 30 blocks later: Epoch 48.
    expect(epochAt(chainSeconds(shell, 1000)).number).toBe(47)
    expect(epochAt(chainSeconds(shell, 1030)).number).toBe(48)
  })

  it("uses the server's clock without a head", () => {
    expect(chainSeconds({ head: null, renderedAt: 123 }, 5000)).toBe(123)
  })
})

describe("the shell query", () => {
  it("refreshes with the head, not on a timer", () => {
    expect(shellQuery.meta).toEqual({ block: true })
    expect(shellQuery.queryKey).toEqual(["shell"])
  })
})

describe("the Borrow delay note", () => {
  const page = "/address/0x00000000000000000000000000000000000000aa"

  it("follows the address document's own snapshot when it has one", () => {
    expect(borrowDelayNote(page, false, true)).toBe(true)
    // /status says delayed, the document's fresher read says current.
    expect(borrowDelayNote(`${page}/loans`, true, false)).toBe(false)
  })

  it("falls back to /status when the document carries no snapshot", () => {
    expect(borrowDelayNote(page, true, null)).toBe(true)
    expect(borrowDelayNote(page, true, undefined)).toBe(true)
    expect(borrowDelayNote(page, false, null)).toBe(false)
  })

  it("shows only on address pages", () => {
    expect(borrowDelayNote("/borrow", true, true)).toBe(false)
    expect(borrowDelayNote("/", true, null)).toBe(false)
  })
})
