import { beforeEach, describe, expect, it } from "vitest"
import type { GaugeList, Lock } from "../../data/view-models"
import { gaugesSample, voterSample } from "../samples"
import {
  getSignedVotes,
  noteSignedVote,
  parseSignedVotes,
  prunedVotes,
  resetSignedVotes,
  type SignedVote,
  signedVotesStorageKey,
  voteDeltas,
  withSignedVotes,
} from "./signed-votes"

const wad = 10n ** 18n
const wallet = `0x${"ab".repeat(20)}`
const prices = { veMEZO: "0.2", veBTC: "100000" }

function named(name: string) {
  const gauge = gaugesSample.gauges.find((entry) => entry.name === name)
  if (gauge === undefined) throw new Error(`no gauge ${name}`)
  return gauge
}
const kiln = named("Kiln Labs")
const sats = named("Sats Collective")
const id = (gauge: { address: string }): string => gauge.address.toLowerCase()

const sampleLock = voterSample.lock
if (sampleLock === null) throw new Error("no sample lock")
/** A veMEZO lock with 1,000,000 votes, all of them on Kiln Labs. */
const lock: Lock = {
  ...sampleLock,
  votingPower: "1000000",
  votingPowerWei: `${1_000_000n * wad}`,
  votes: [{ gauge: kiln, weight: `${1_000_000n * wad}`, shareBps: 10_000 }],
}

/** The directory as the API serves it, from `block`. */
function directory(block: number | undefined): GaugeList {
  return { ...gaugesSample, ...(block === undefined ? {} : { block }) }
}
const votesOf = (list: GaugeList, gauge: { address: string }): bigint =>
  BigInt(
    list.gauges.find((entry) => id(entry) === id(gauge))?.votes ?? "missing",
  )
const apyOf = (list: GaugeList, gauge: { address: string }) =>
  list.gauges.find((entry) => id(entry) === id(gauge))?.apyBps

/** The lock moves everything from Kiln Labs to Sats Collective. */
const moved = voteDeltas([lock], "vebtc", [
  { address: sats.address, bps: 10_000 },
])
const signed: SignedVote = {
  wallet,
  block: 13_203_300,
  at: 1_794_500_000,
  deltas: Object.fromEntries(
    [...moved].map(([gauge, delta]) => [gauge, delta.toString()]),
  ),
}
/** Vote showing the signer, with locks read at `block`. */
const viewing = (block: number | undefined) => ({ address: wallet, block })

describe("what a signed vote changes on each gauge", () => {
  it("takes the old votes off and puts the new split on", () => {
    expect(moved).toEqual(
      new Map([
        [id(kiln), -1_000_000n * wad],
        [id(sats), 1_000_000n * wad],
      ]),
    )
  })

  it("leaves out a gauge whose votes stay the same", () => {
    const kept = voteDeltas([lock], "vebtc", [
      { address: kiln.address, bps: 10_000 },
    ])
    expect(kept.size).toBe(0)
  })

  it("leaves the lock's other voter alone", () => {
    // A vote on MEZO gauges does not touch what the lock has on veBTC gauges.
    const mezo = `0x${"ee".repeat(20)}`
    const deltas = voteDeltas([lock], "mezo", [{ address: mezo, bps: 5_000 }])
    expect(deltas).toEqual(new Map([[mezo, 500_000n * wad]]))
  })

  it("adds up every lock that signs the split", () => {
    const second: Lock = { ...lock, tokenId: "9", votes: [] }
    const deltas = voteDeltas([lock, second], "vebtc", [
      { address: sats.address, bps: 10_000 },
    ])
    expect(deltas.get(id(sats))).toBe(2_000_000n * wad)
    expect(deltas.get(id(kiln))).toBe(-1_000_000n * wad)
  })
})

describe("a signed vote over the gauge directory", () => {
  it("shows the vote while the directory is older than its block", () => {
    const stale = directory(signed.block - 12)
    const shown = withSignedVotes(
      stale,
      [signed],
      prices,
      viewing(signed.block),
    )
    expect(votesOf(shown, sats)).toBe(BigInt(sats.votes) + 1_000_000n * wad)
    expect(votesOf(shown, kiln)).toBe(BigInt(kiln.votes) - 1_000_000n * wad)
    // Untouched gauges are the same objects: nothing to redraw.
    const other = named("Tinder Fund")
    expect(shown.gauges.find((entry) => id(entry) === id(other))).toBe(
      stale.gauges.find((entry) => id(entry) === id(other)),
    )
  })

  it("lowers the APY of the gauge voted into, and raises the one left", () => {
    const stale = directory(signed.block - 12)
    const shown = withSignedVotes(
      stale,
      [signed],
      prices,
      viewing(signed.block),
    )
    const before = { sats: apyOf(stale, sats), kiln: apyOf(stale, kiln) }
    if (typeof before.sats !== "number" || typeof before.kiln !== "number") {
      throw new Error("sample gauges need an APY")
    }
    // The same incentives among more votes: old APY times old over new.
    expect(apyOf(shown, sats)).toBe(
      Number((BigInt(before.sats) * BigInt(sats.votes)) / votesOf(shown, sats)),
    )
    expect(apyOf(shown, sats)).toBeLessThan(before.sats)
    expect(apyOf(shown, kiln)).toBeGreaterThan(before.kiln)
  })

  it("steps aside once the directory is from the vote's block or later", () => {
    for (const block of [signed.block, signed.block + 40]) {
      const fresh = directory(block)
      expect(withSignedVotes(fresh, [signed], prices, viewing(block))).toBe(
        fresh,
      )
    }
  })

  it("waits for the signer's locks to be from the vote's block", () => {
    // Vote draws the directory's total, less the locks' own votes, plus
    // the ballot. With the locks from before the vote that is already the
    // new total: adding the vote too would count it twice.
    const stale = directory(signed.block - 12)
    expect(
      withSignedVotes(stale, [signed], prices, viewing(signed.block - 1)),
    ).toBe(stale)
    // Locks from an API that does not say where they are from: the same.
    expect(withSignedVotes(stale, [signed], prices, viewing(undefined))).toBe(
      stale,
    )
  })

  it("shows it to anyone else looking at the gauges", () => {
    const stale = directory(signed.block - 12)
    const other = { address: `0x${"cd".repeat(20)}`, block: undefined }
    expect(votesOf(withSignedVotes(stale, [signed], prices, null), sats)).toBe(
      BigInt(sats.votes) + 1_000_000n * wad,
    )
    expect(votesOf(withSignedVotes(stale, [signed], prices, other), sats)).toBe(
      BigInt(sats.votes) + 1_000_000n * wad,
    )
  })

  it("gives a gauge that had no votes the APY its incentives pay", () => {
    const empty: GaugeList = {
      ...directory(signed.block - 12),
      gauges: gaugesSample.gauges.map((gauge) =>
        id(gauge) === id(sats)
          ? { ...gauge, votes: "0", apyBps: null, incentivesUsd: "100.00" }
          : gauge,
      ),
    }
    const shown = withSignedVotes(
      empty,
      [signed],
      prices,
      viewing(signed.block),
    )
    // 100 USD a week on 1,000,000 veMEZO at 0.20: 100 * 52 / 200,000 = 2.6%.
    expect(apyOf(shown, sats)).toBe(260)
  })

  it("gives no APY on less than a dollar of incentives, votes or not", () => {
    const small: GaugeList = {
      ...directory(signed.block - 12),
      gauges: gaugesSample.gauges.map((gauge) =>
        id(gauge) === id(sats)
          ? {
              ...gauge,
              votes: "0",
              apyBps: null,
              incentivesUsd: "0.28",
              // As the server sends it for less than a dollar.
              apyMinVotes: null,
            }
          : gauge,
      ),
    }
    const shown = withSignedVotes(
      small,
      [signed],
      prices,
      viewing(signed.block),
    )
    expect(votesOf(shown, sats)).toBe(1_000_000n * wad)
    expect(apyOf(shown, sats)).toBeNull()
  })

  it("gives no APY to a gauge the server does not count as funded", () => {
    const unfunded: GaugeList = {
      ...directory(signed.block - 12),
      gauges: gaugesSample.gauges.map((gauge) =>
        id(gauge) === id(sats)
          ? {
              ...gauge,
              votes: "0",
              apyBps: null,
              incentivesUsd: "100.00",
              funded: false,
              apyMinVotes: null,
            }
          : gauge,
      ),
    }
    const shown = withSignedVotes(
      unfunded,
      [signed],
      prices,
      viewing(signed.block),
    )
    expect(votesOf(shown, sats)).toBe(1_000_000n * wad)
    expect(apyOf(shown, sats)).toBeNull()
  })

  it("gives no APY, and does not throw, when the server sent no floor", () => {
    // A directory from a server or cache from before `apyMinVotes`.
    const older: GaugeList = {
      ...directory(signed.block - 12),
      gauges: gaugesSample.gauges.map((gauge) => {
        const copy = { ...gauge }
        Reflect.deleteProperty(copy, "apyMinVotes")
        return copy
      }),
    }
    const shown = withSignedVotes(
      older,
      [signed],
      prices,
      viewing(signed.block),
    )
    // The votes still move; only the APY waits for a number to check.
    expect(votesOf(shown, sats)).toBe(BigInt(sats.votes) + 1_000_000n * wad)
    expect(apyOf(shown, sats)).toBeNull()
    expect(apyOf(shown, kiln)).toBeNull()
  })

  it("never shows votes below zero or an APY on none", () => {
    const drained: SignedVote = {
      ...signed,
      deltas: { [id(kiln)]: `-${BigInt(kiln.votes) + wad}` },
    }
    const shown = withSignedVotes(
      directory(signed.block - 12),
      [drained],
      prices,
      viewing(signed.block),
    )
    expect(votesOf(shown, kiln)).toBe(0n)
    expect(apyOf(shown, kiln)).toBeNull()
  })

  it("adds up votes signed one after another", () => {
    const again: SignedVote = { ...signed, block: signed.block + 3 }
    const shown = withSignedVotes(
      directory(signed.block - 12),
      [again, signed],
      prices,
      viewing(again.block),
    )
    expect(votesOf(shown, sats)).toBe(BigInt(sats.votes) + 2_000_000n * wad)
    // The directory caught up with the first: only the second is added.
    const between = withSignedVotes(
      directory(signed.block + 1),
      [again, signed],
      prices,
      viewing(again.block),
    )
    expect(votesOf(between, sats)).toBe(BigInt(sats.votes) + 1_000_000n * wad)
  })
})

describe("signed votes kept for the tab", () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    resetSignedVotes()
  })

  it("notes a vote and reads it back after a reload", () => {
    noteSignedVote({ wallet, block: 13_203_300n, deltas: moved })
    const [noted] = getSignedVotes()
    expect(noted).toMatchObject({
      wallet,
      block: 13_203_300,
      deltas: signed.deltas,
    })
    resetSignedVotes()
    expect(getSignedVotes()).toEqual([noted])
  })

  it("notes nothing for a vote that changed nothing", () => {
    noteSignedVote({ wallet, block: 13_203_300n, deltas: new Map() })
    expect(getSignedVotes()).toEqual([])
  })

  it("drops a vote too old to still be ahead of the directory", () => {
    expect(prunedVotes([signed], signed.at + 60)).toEqual([signed])
    expect(prunedVotes([signed], signed.at + 21 * 60)).toEqual([])
  })

  it("reads stored votes without trusting them", () => {
    expect(parseSignedVotes(null)).toEqual([])
    expect(parseSignedVotes("not json")).toEqual([])
    expect(parseSignedVotes(JSON.stringify({ block: 1 }))).toEqual([])
    expect(
      parseSignedVotes(
        JSON.stringify([
          signed,
          { ...signed, wallet: "someone" },
          { ...signed, deltas: { [id(kiln)]: "1e18" } },
          { ...signed, block: "13203300" },
        ]),
      ),
    ).toEqual([signed])
    window.sessionStorage.setItem(signedVotesStorageKey, "[{]")
    resetSignedVotes()
    expect(getSignedVotes()).toEqual([])
  })
})
