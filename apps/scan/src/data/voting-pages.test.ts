import type { GaugeCard } from "@matchbox/contracts/read-models"
import { describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  env: { SCAN_DATA: "fixtures" } as Record<string, unknown>,
  scenario: undefined as string | undefined,
  headers: new Map<string, string>(),
}))
vi.mock("cloudflare:workers", () => ({ env: state.env }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: (name: string) =>
    name === "x-scan-fixture" ? state.scenario : undefined,
  setResponseHeader: (name: string, value: string) => {
    state.headers.set(name, value)
  },
}))

const { byVoteShare, gaugesPage, gaugePage, directoryPageSize, unitTotals } =
  await import("./gauges.server")
const { crowdSize } = await import("./scan/fixtures/voting")
const { epochsPage, epochPage } = await import("./epochs.server")
const { joinedText, locksPage, lockPage } = await import("./locks.server")
const { gauges } = await import("./scan/fixtures/world")
const { demoKindCards } = await import(
  "@matchbox/contracts/read-models/fixtures"
)
const { fixtureNow } = await import("./scan/fixtures/shared")

// The fixtures' "now" (Mon 9 Nov 2026, Epoch 47), so today is their today.
vi.useFakeTimers({ toFake: ["Date"] })
vi.setSystemTime(fixtureNow * 1000)

/**
 * The Voting and Locks pages' view models from the fixtures: formatted on
 * the server, each section degrading on its own, and an epoch the jobs
 * Worker has not computed never shown as zeros.
 */

function reset(scenario?: string): void {
  state.scenario = scenario
  state.headers.clear()
}

describe("gauges", () => {
  it("lists every type with counts, filtered and ordered", async () => {
    reset()
    const page = await gaugesPage({ type: "pool", sort: "apy" })
    expect(page.directory.status).toBe("ok")
    if (page.directory.status !== "ok") return
    const view = page.directory.data
    // 8 veBTC gauges, 4 demo gauges of other kinds, 2 validators the
    // validators pages add (fixtures/validators.ts), and the crowd of veBTC
    // lock gauges that makes the directory production-sized.
    expect(view.counts.all).toBe(14 + crowdSize)
    expect(view.rows.map((row) => row.gauge.kind)).toEqual(["pool", "pool"])
    expect(view.rows[0]?.apy).toBe("12.80%")
    expect(view.rows[0]?.votes).toBe("88.1000 veBTC")
    // Tallow & Co left the set: its gauge is not alive, so not counted.
    expect(view.split?.counts).toEqual({ validators: 2, pools: 2 })
    expect(state.headers.get("x-scan-cache")).toBe("list")
  })

  it("pages the whole directory on the server, at production size", async () => {
    reset()
    const first = await gaugesPage({ type: "all", sort: "votes" })
    if (first.directory.status !== "ok") throw new Error("no directory")
    const view = first.directory.data
    // One page reaches the browser, never all ~780 gauges.
    expect(view.rows).toHaveLength(directoryPageSize)
    expect(view.total).toBe(view.counts.all)
    expect(view.from).toBe(1)
    expect(view.next).toBe(view.rows.at(-1)?.gauge.address)
    // Following the cursor visits every gauge once, in the one order.
    const seen = [...view.rows.map((row) => row.gauge.address)]
    let after = view.next
    let pages = 1
    while (after !== null) {
      const page = await gaugesPage({ type: "all", sort: "votes", after })
      if (page.directory.status !== "ok") throw new Error("no page")
      expect(page.directory.data.from).toBe(seen.length + 1)
      seen.push(...page.directory.data.rows.map((row) => row.gauge.address))
      after = page.directory.data.next
      pages += 1
    }
    expect(seen).toHaveLength(view.total)
    expect(new Set(seen).size).toBe(view.total)
    expect(pages).toBe(Math.ceil(view.total / directoryPageSize))
  })

  it("filters and orders every gauge before it pages", async () => {
    reset()
    // The tab's total is the whole kind, not the loaded rows.
    const vebtc = await gaugesPage({ type: "vebtc", sort: "votes" })
    if (vebtc.directory.status !== "ok") throw new Error("no directory")
    expect(vebtc.directory.data.total).toBe(vebtc.directory.data.counts.vebtc)
    expect(vebtc.directory.data.total).toBeGreaterThan(directoryPageSize)
    // An order over the whole set: a gauge last in Pro's order but first
    // by APY leads the first page.
    const apy = await gaugesPage({ type: "all", sort: "apy" })
    if (apy.directory.status !== "ok") throw new Error("no directory")
    expect(apy.directory.data.rows[0]?.apy).toBe("12.80%")
  })

  it("ranks All by each gauge's share of its own escrow's votes", async () => {
    reset()
    const page = await gaugesPage({ type: "all", sort: "votes" })
    if (page.directory.status !== "ok") throw new Error("no directory")
    const rows = page.directory.data.rows
    // Within one unit the order is still votes, largest first.
    const amount = (text: string) =>
      Number(text.split(" ")[0]?.replaceAll(",", ""))
    for (const unit of ["veBTC", "veMEZO"]) {
      const live = rows.filter(
        (row) => !row.expired && row.votes.endsWith(unit),
      )
      const votes = live.map((row) => amount(row.votes))
      expect(votes).toEqual([...votes].sort((a, b) => b - a))
    }
  })

  it("puts a veBTC gauge with a large share above small veMEZO ones", () => {
    const card = (votes: string, votesUnit: "veBTC" | "veMEZO") =>
      ({ votes, votesUnit }) as unknown as GaugeCard
    // 40% of veBTC's votes against 1% of veMEZO's, whose raw amount is
    // 10,000 times larger.
    const pool = card("40", "veBTC")
    const boost = card("10000", "veMEZO")
    const cards = [boost, pool, card("60", "veBTC"), card("990000", "veMEZO")]
    const order = byVoteShare(unitTotals(cards))
    expect([boost, pool].sort(order)).toEqual([pool, boost])
    expect(order(card("1", "veBTC"), card("1", "veBTC"))).toBe(0)
  })

  it("starts again from the top for a cursor the order no longer holds", async () => {
    reset()
    const gone = await gaugesPage({
      type: "all",
      sort: "votes",
      after: `0x${"f".repeat(40)}`,
    })
    if (gone.directory.status !== "ok") throw new Error("no directory")
    expect(gone.directory.data).toMatchObject({ from: 1, restarted: true })
    const junk = await gaugesPage({ type: "all", sort: "votes", after: "x" })
    if (junk.directory.status !== "ok") throw new Error("no directory")
    expect(junk.directory.data).toMatchObject({ from: 1, restarted: false })
  })

  it("names a gauge's lock once", async () => {
    reset()
    const page = await gaugesPage({ type: "vebtc", sort: "votes" })
    if (page.directory.status !== "ok") throw new Error("no directory")
    const vebtc604 = page.directory.data.rows.find(
      (row) => row.gauge.name === "veBTC #604",
    )
    expect(vebtc604?.gauge.tokenId).toBeNull()
    const kiln = page.directory.data.rows.find(
      (row) => row.gauge.name === "Kiln Labs",
    )
    expect(kiln?.gauge.tokenId).toBe("7")
    expect(kiln?.votesNote).toBe("1.09M to optimal")
  })

  it("says not available yet while the database is not bound", async () => {
    reset("disabled")
    const page = await gaugesPage({ type: "all", sort: "votes" })
    expect(page.directory.status).toBe("disabled")
    expect(page.emissions.status).toBe("disabled")
    expect(state.headers.get("x-scan-degraded")).toBe("1")
  })

  it("draws a gauge with its votes, voters and deposits", async () => {
    reset()
    const page = await gaugePage({ gauge: gauges.kilnLabs, range: "30d" })
    expect(page.header.status).toBe("ok")
    if (page.header.status !== "ok") return
    expect(page.header.data.band?.note).toBe("1.09M to go")
    expect(page.votes.status === "ok" && page.votes.data?.figure).toBe(
      "5.88M veMEZO",
    )
    expect(page.voters.status === "ok" && page.voters.data.length).toBe(2)
    expect(page.deposits.status === "ok" && page.deposits.data[0]?.amount).toBe(
      "6,413.04 MEZO",
    )
    expect(page.pool).toBeNull()
  })

  it("adds a pool gauge's pool series", async () => {
    reset()
    const address = demoKindCards.btcMusdCl.gauge.address.toLowerCase()
    const page = await gaugePage({ gauge: address, range: "90d" })
    expect(page.pool?.name).toBe("BTC/MUSD")
    expect(page.pool?.volume.status).toBe("ok")
    if (page.pool?.volume.status !== "ok") return
    expect(page.pool.volume.data.points).toHaveLength(90)
    expect(page.pool.volume.data.partial).toBe(true)
    expect(page.pool.volume.data.figure).toMatch(/ BTC$/)
  })

  it("is missing for a gauge Pro has no document for", async () => {
    reset()
    const page = await gaugePage({
      gauge: `0x${"12".repeat(20)}`,
      range: "30d",
    })
    expect(page.header.status).toBe("missing")
  })
})

describe("epochs", () => {
  it("shows the current epoch and pages the rest", async () => {
    reset()
    const page = await epochsPage({ cursor: null })
    expect(page.current.status === "ok" && page.current.data.computed).toBe(
      true,
    )
    expect(page.table.status === "ok" && page.table.data.rows.length).toBe(8)
    expect(page.emissions.status === "ok" && page.emissions.data?.figure).toBe(
      "1,916,000 MEZO",
    )
  })

  it("never shows a still-filling epoch as zeros", async () => {
    reset("filling")
    const page = await epochPage({ epoch: 47 })
    expect(page.doc).toEqual({ status: "ok", data: null })
    expect(page.asOf).not.toBeNull()
    expect(state.headers.get("x-scan-cache")).toBe("fresh")
  })

  it("keeps a sealed epoch long and ranks each gauge type", async () => {
    reset()
    const page = await epochPage({ epoch: 45 })
    expect(state.headers.get("x-scan-cache")).toBe("final")
    if (page.doc.status !== "ok" || page.doc.data === null) {
      throw new Error("no epoch")
    }
    expect(page.doc.data.sources.map((table) => table.source)).toEqual([
      "BOOST_VOTER",
      "VALIDATORS_VOTER",
      "POOLS_VOTER",
    ])
    expect(page.doc.data.sources[1]?.rows[0]?.gauge.name).toBe(
      "Northfield Nodes",
    )
  })

  it("is missing for an epoch not started", async () => {
    reset()
    const page = await epochPage({ epoch: 48 })
    expect(page.doc.status).toBe("missing")
  })
})

describe("locks", () => {
  it("lists veMEZO locks with the escrow series", async () => {
    reset()
    const page = await locksPage({
      escrow: "vemezo",
      order: "amount",
      range: "30d",
      cursor: null,
    })
    expect(page.list.status === "ok" && page.list.data.rows[0]?.amount).toBe(
      "250,000.00 MEZO",
    )
    expect(page.locked.status === "ok" && page.locked.data.kind).toBe("level")
    expect(page.net.status === "ok" && page.net.data.kind).toBe("flow")
    expect(page.netStats.map((stat) => stat.label)).toEqual([
      "Locked today",
      "Withdrawn today",
    ])
  })

  it("draws a lock's votes by epoch and its history", async () => {
    reset()
    const page = await lockPage({ escrow: "vemezo", id: "2207" })
    expect(page.lock.status).toBe("ok")
    expect(page.indexed).toBe(true)
    expect(page.cards).toEqual([
      { label: "Amount locked", value: "18,402.55 MEZO" },
      { label: "Unlocks", value: "3 Mar 2028" },
      // The chain's, decayed over the time left (fixtures/world liveLockOf).
      { label: "Voting power", value: "6,054 veMEZO" },
      // This epoch's votes are the chain's too.
      { label: "Votes Epoch 47", value: "18,402 veMEZO" },
      { label: "Boost", value: "4.4×" },
    ])
    expect(
      page.votes.status === "ok" && page.votes.data.splits[0]?.parts,
    ).toHaveLength(2)
    expect(
      page.activity.status === "ok" && page.activity.data.rows.length,
    ).toBeGreaterThan(0)
  })

  it("sends a lock's history with its plain words joined", async () => {
    reset()
    const page = await lockPage({ escrow: "vemezo", id: "2207" })
    const rows = page.activity.status === "ok" ? page.activity.data.rows : []
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      // Never two plain parts in a row, and the words still read the same.
      row.parts.forEach((part, index) => {
        if (index > 0 && part.kind === "text") {
          expect(row.parts[index - 1]?.kind).not.toBe("text")
        }
      })
    }
    expect(
      joinedText([
        { kind: "text", text: "Voted" },
        { kind: "text", text: " " },
        { kind: "figure", text: "12,000 veMEZO" },
        { kind: "text", text: " " },
        { kind: "text", text: "for" },
      ]),
    ).toEqual([
      { kind: "text", text: "Voted " },
      { kind: "figure", text: "12,000 veMEZO" },
      { kind: "text", text: " for" },
    ])
  })

  it("draws a lock the chain has and the store does not yet", async () => {
    reset()
    const page = await lockPage({ escrow: "vebtc", id: "6179" })
    expect(page.lock).toMatchObject({
      status: "ok",
      data: { owner: expect.stringMatching(/^0x/), state: "auto-max" },
    })
    expect(page.indexed).toBe(false)
    expect(page.cards).toEqual([
      { label: "Amount locked", value: "0.0500 BTC" },
      { label: "Unlocks", value: "Auto max" },
      { label: "Voting power", value: "0.0500 veBTC" },
      { label: "Votes Epoch 47", value: "Not voted" },
    ])
    // Nothing indexed yet: no epochs, and the page says why.
    expect(page.votes).toEqual({
      status: "ok",
      data: { splits: [], cut: false },
    })
    expect(state.headers.get("x-scan-cache")).toBe("fresh")
  })

  it("is missing for a lock the escrow never minted", async () => {
    reset()
    const page = await lockPage({ escrow: "vebtc", id: "999999" })
    expect(page.lock.status).toBe("missing")
  })
})
