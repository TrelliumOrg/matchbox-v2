import { describe, expect, it } from "vitest"
import type { GaugeSummary } from "../../data/view-models"
import { listGauges, matchesSearch, sortGauges } from "./gauge-filter"
import type { VoteSort } from "./vote-route"

const wei = (whole: bigint): string => `${whole * 10n ** 18n}`

let next = 0

function gauge(fields: Partial<GaugeSummary> & { name: string }): GaugeSummary {
  next += 1
  return {
    address: `0x${next.toString(16).padStart(40, "a")}`,
    voter: "boost",
    picture: { kind: "initials", initials: "AB", hue: 10 },
    color: { light: "#000", dark: "#fff" },
    kind: "vebtc",
    meta: {
      kind: "vebtc",
      tokenId: "1",
      weight: "0",
      boost: null,
      lock: "active",
    },
    votesUnit: "veMEZO",
    expired: false,
    tokenId: null,
    tagline: null,
    apyBps: null,
    incentivesUsd: "0",
    incentiveTokens: [],
    veBtcWeight: "0",
    votes: wei(0n),
    optimalVotes: null,
    ...fields,
  }
}

const names = (list: readonly GaugeSummary[]): string[] =>
  list.map((each) => each.name)

const sorts: readonly VoteSort[] = ["incentives", "apy", "votes", "room"]

describe("sortGauges", () => {
  // Mainnet on 13 Nov 2026: one funded veBTC gauge, and gauges without
  // incentives ordered by votes.
  const snf = gauge({
    name: "SNF",
    apyBps: 1029,
    incentivesUsd: "313.55",
    votes: wei(40_417_862n),
  })
  const boar = gauge({ name: "Boar Finance", votes: wei(8_032_743n) })
  const mine = gauge({ name: "veBTC #5910", votes: wei(2_524_825n) })
  const aras = gauge({ name: "aras.haus", votes: wei(1_033_793n) })

  it("puts the most incentives first, whatever the locks vote for", () => {
    expect(names(sortGauges([mine, aras, boar, snf], "incentives"))).toEqual([
      "SNF",
      "Boar Finance",
      "veBTC #5910",
      "aras.haus",
    ])
  })

  it("breaks ties by the most votes, then by address", () => {
    const twin = gauge({ name: "Twin", votes: boar.votes })
    for (const sort of sorts) {
      const sorted = sortGauges([twin, aras, boar], sort)
      expect(names(sorted).slice(0, 2).sort()).toEqual(["Boar Finance", "Twin"])
      expect(sorted.at(-1)?.name).toBe("aras.haus")
      // The same order from any starting order.
      expect(sortGauges([boar, aras, twin], sort)).toEqual(sorted)
    }
  })

  it("breaks an APY tie by incentives", () => {
    const small = gauge({ name: "Small", apyBps: 500, incentivesUsd: "10" })
    const large = gauge({ name: "Large", apyBps: 500, incentivesUsd: "90" })
    expect(names(sortGauges([small, large], "apy"))).toEqual(["Large", "Small"])
  })

  it("orders room to 5x, gauges past it last", () => {
    const far = gauge({
      name: "Far",
      votes: wei(10n),
      optimalVotes: wei(1_000n),
    })
    const near = gauge({
      name: "Near",
      votes: wei(900n),
      optimalVotes: wei(1_000n),
    })
    const past = gauge({
      name: "Past",
      votes: wei(2_000n),
      optimalVotes: wei(1_000n),
    })
    expect(names(sortGauges([past, near, far], "room"))).toEqual([
      "Far",
      "Near",
      "Past",
    ])
  })
})

describe("matchesSearch", () => {
  it("finds a named gauge by the lock id its card shows", () => {
    const named = gauge({ name: "SNF", tokenId: "6033" })
    expect(matchesSearch(named, "#6033")).toBe(true)
    expect(matchesSearch(named, "6033")).toBe(true)
    expect(matchesSearch(named, "snf")).toBe(true)
    expect(matchesSearch(named, "#6034")).toBe(false)
  })

  it("finds a gauge by the start of its address", () => {
    const one = gauge({ name: "One", address: `0xabc${"1".repeat(37)}` })
    expect(matchesSearch(one, "0xabc")).toBe(true)
    expect(matchesSearch(one, "abc1")).toBe(false)
  })
})

describe("listGauges", () => {
  const funded = gauge({
    name: "Kiln Labs",
    apyBps: 250,
    incentivesUsd: "50",
  })
  const picked = gauge({ name: "Kettle Fund", votes: wei(9n) })
  const watched = gauge({ name: "Harbor Node", votes: wei(5n) })
  const gauges = [picked, watched, funded]
  const ballot = new Set([picked.address])
  const watching = new Set([watched.address])
  const tests = {
    all: () => true,
    picked: (each: GaugeSummary) => ballot.has(each.address),
    funded: (each: GaugeSummary) => each.apyBps !== null,
    watching: (each: GaugeSummary) => watching.has(each.address),
  }

  it("lists what each tab counts", () => {
    for (const tab of ["all", "picked", "funded", "watching"] as const) {
      const { rows, counts } = listGauges(gauges, {
        tab,
        sort: "incentives",
        needle: "",
        tests,
      })
      expect(rows).toHaveLength(counts[tab])
    }
  })

  it("counts every tab under the search, and combines the two", () => {
    const { rows, counts } = listGauges(gauges, {
      tab: "watching",
      sort: "incentives",
      needle: "k",
      tests,
    })
    // "k" finds Kiln Labs and Kettle Fund, not Harbor Node.
    expect(counts).toEqual({ all: 2, picked: 1, funded: 1, watching: 0 })
    expect(rows).toEqual([])
  })

  it("never counts a watched gauge that is not in the list", () => {
    // Watching holds every type's gauges; the list is one type's.
    const elsewhere = gauge({ name: "BTC/MUSD", kind: "pool" })
    watching.add(elsewhere.address)
    const { counts } = listGauges(gauges, {
      tab: "all",
      sort: "incentives",
      needle: "",
      tests,
    })
    expect(counts.watching).toBe(1)
    watching.delete(elsewhere.address)
  })
})
