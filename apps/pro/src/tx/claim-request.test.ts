import { describe, expect, it } from "vitest"
import type { GaugeRef, Lock, Overview, Rewards } from "../data/view-models"
import { claimRequest } from "./claim-request"

function gauge(
  address: string,
  voter: GaugeRef["voter"],
  name: string,
): GaugeRef {
  return {
    address,
    voter,
    name,
    picture: { kind: "initials", initials: name.slice(0, 2), hue: 10 },
    color: { light: "#000", dark: "#fff" },
  }
}

const kiln = gauge("0xaaa", "boost", "Kiln Labs")
const northfield = gauge("0xbbb", "validators", "Northfield Nodes")
const fresh = gauge("0xccc", "boost", "Sats Collective")

function lock(fields: Partial<Lock> & Pick<Lock, "kind" | "tokenId">): Lock {
  return {
    amount: "1",
    usd: "1",
    votingPower: "1",
    votingPowerWei: "1000000000000000000",
    unlocksAt: null,
    expired: false,
    autoMax: false,
    votedThisEpoch: false,
    votes: [],
    claimableUsd: "0",
    ...fields,
  }
}

const rewards: Rewards = {
  address: "0x7c21",
  claimable: {
    epoch: 46,
    usd: "212.48",
    tokens: [
      { symbol: "MEZO", token: "0x7b7c", amount: "812.4", usd: "149.48" },
    ],
  },
  projected: null,
  earned: { usd: "0", fromEpoch: null, toEpoch: null },
  locks: [
    {
      lock: { kind: "vebtc", tokenId: "4120" },
      usd: "203.78",
      tokens: [],
      gauges: [
        {
          address: "0xbbb",
          voter: "validators",
          name: "Northfield Nodes",
          usd: "203.78",
        },
      ],
      projectedUsd: null,
      projectedShares: [],
    },
    {
      lock: { kind: "vemezo", tokenId: "2207" },
      usd: "8.70",
      tokens: [
        { symbol: "MEZO", token: "0x7b7c", amount: "47.3", usd: "8.70" },
      ],
      gauges: [
        { address: "0xAAA", voter: "boost", name: "Kiln Labs", usd: "8.70" },
      ],
      projectedUsd: null,
      projectedShares: [],
    },
  ],
  history: [],
}

const overview: Overview = {
  address: "0x7c21",
  claimable: { epoch: 46, usd: "212.48", tokens: [] },
  locks: [
    lock({
      kind: "vebtc",
      tokenId: "4120",
      votes: [{ gauge: northfield, weight: "1", shareBps: 10_000 }],
    }),
    lock({
      kind: "vemezo",
      tokenId: "2207",
      votingPowerWei: "41260000000000000000000",
      votes: [
        { gauge: kiln, weight: "1", shareBps: 7000 },
        { gauge: fresh, weight: "1", shareBps: 3000 },
      ],
    }),
    lock({
      kind: "vemezo",
      tokenId: "1842",
      votingPowerWei: "18360000000000000000000",
    }),
  ],
  wallet: null,
  suggestion: null,
  activity: [],
}

describe("claimRequest", () => {
  it("claims every lock and joins the gauges each lock votes now", () => {
    const request = claimRequest(rewards, overview, { relock: false })
    expect(request.usd).toBe("212.48")
    expect(request.sources.map((source) => source.lock.tokenId)).toEqual([
      "4120",
      "2207",
    ])
    expect(request.sources[1]?.gauges.map((entry) => entry.name)).toEqual([
      "Kiln Labs",
      "Sats Collective",
    ])
    expect(request.relock).toBe(false)
  })

  it("relocks into the largest live veMEZO lock", () => {
    const request = claimRequest(rewards, overview, { relock: true })
    expect(request.relockInto).toEqual({ tokenId: "2207" })
    expect(request.relock).toBe(true)
  })

  it("claims one lock on its own", () => {
    const request = claimRequest(rewards, overview, {
      relock: false,
      only: { kind: "vemezo", tokenId: "2207" },
    })
    expect(request.sources).toHaveLength(1)
    expect(request.usd).toBe("8.70")
    expect(request.tokens).toHaveLength(1)
  })

  it("cannot relock without a veMEZO lock", () => {
    const request = claimRequest(rewards, null, { relock: true })
    expect(request.relockInto).toBeNull()
    expect(request.relock).toBe(false)
  })
})
