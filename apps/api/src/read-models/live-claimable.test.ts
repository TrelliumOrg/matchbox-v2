import type { WalletLock } from "@matchbox/contracts/read-models"
import {
  demoGaugeDirectory,
  demoPrices,
  demoWalletOverview,
  demoWalletRewards,
} from "@matchbox/contracts/read-models/fixtures"
import type { PublicClient } from "viem"
import { describe, expect, it } from "vitest"
import {
  ClaimableUnread,
  createLiveClaimableReader,
  maxEarnedCallsPerView,
  overlayClaimable,
} from "./live-claimable"
import { gaugeCardsFrom } from "./wallet-extras"

const wad = 10n ** 18n
const cards = gaugeCardsFrom(demoGaugeDirectory)

// Lock #848 on 12 Nov 2026: a veBTC lock voting the sMUSD pool and a
// validator gauge, with 1,124.59 MUSD of pool fees the stored document
// did not have.
const pool = "0xb4D498029af77680cD1eF828b967f010d06C51CC"
const poolGauge = "0x677817bF3e44b90E8F95222F75e2950b7904a401"
const poolBribe = "0x7D98F38a020a94b08EeC295BFb6f4E86d581e607"
const poolFees = "0x33b8B1162F0b86d68CAd418D96246Ee2c5164a01"
const validator = "0xdE3593718dCF024dAa1e76FCba80e5ce99cD0ea9"
const validatorBribe = "0x85292D29D25775155ceb861C18AeA688fbcF2446"
const musd = "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186"
const mezo = "0x7B7c000000000000000000000000000000000001"
const zero = "0x0000000000000000000000000000000000000000"
const feesEarned = 1_124_591_570_389_013_644_316n
const mezoEarned = 8_701n * wad

const [template] = demoWalletOverview.locks.filter(
  (lock) => lock.escrow === "vebtc",
)
if (template === undefined) throw new Error("fixture")

/** The stored document: #848 with only the validator's MEZO. */
const storedLock: WalletLock = {
  ...template,
  tokenId: "848",
  votingPower: "50.0137",
  claimable: {
    usd: "34.03",
    tokens: [
      {
        token: {
          address: mezo.toLowerCase(),
          symbol: "MEZO",
          name: "Mezo",
          decimals: 18,
        },
        amount: "8701",
        usd: "34.03",
      },
    ],
  },
}
const overview = {
  ...demoWalletOverview,
  locks: [storedLock],
  claimable: storedLock.claimable,
}
const rewards = {
  ...demoWalletRewards,
  byLock: [],
  readyToClaim: storedLock.claimable,
}

type Call = {
  functionName: string
  args?: readonly unknown[]
  address?: string
}
type Result =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: Error }

const same = (left: unknown, right: string): boolean =>
  typeof left === "string" && left.toLowerCase() === right.toLowerCase()

/** Mezo, as far as lock #848 is concerned. */
function answer(call: Call): unknown {
  const [first, second] = call.args ?? []
  switch (call.functionName) {
    case "getBlockNumber":
      return 13_180_426n
    case "poolVote":
      return first === 848n && second === 0n ? pool : undefined
    case "gaugeVote":
      return first === 848n && second === 0n ? validator : undefined
    case "gauges":
      return same(first, pool) ? poolGauge : zero
    case "gaugeToBribe":
      return same(first, poolGauge) ? poolBribe : validatorBribe
    case "gaugeToFees":
      return same(first, poolGauge) ? poolFees : zero
    case "earned":
      if (same(call.address, poolFees) && same(first, musd)) return feesEarned
      if (same(call.address, validatorBribe) && same(first, mezo)) {
        return mezoEarned
      }
      return 0n
    default:
      return undefined
  }
}

type FakeCall = Call & { address?: string }

/**
 * A client like the Worker's. `fail` decides, per request, whether it is
 * lost: "throttled" rejects the request; "refused" answers every call with
 * the fallback endpoint's -32602, as viem's multicall hands it back.
 */
function client(
  fail: (
    request: number,
    calls: readonly FakeCall[],
  ) => "throttled" | "refused" | null = () => null,
) {
  const requests: FakeCall[][] = []
  const fake = {
    async multicall(input: { contracts: readonly FakeCall[] }) {
      const index = requests.length
      requests.push([...input.contracts])
      const outcome = fail(index, input.contracts)
      if (outcome === "throttled")
        throw new Error("HTTP request failed. Status: 429")
      if (outcome === "refused") {
        const error = new Error("Missing or invalid parameters.")
        return input.contracts.map((): Result => ({ status: "failure", error }))
      }
      return input.contracts.map((call): Result => {
        const result = answer(call as Call & { address: string })
        return result === undefined
          ? { status: "failure", error: new Error("reverted") }
          : { status: "success", result }
      })
    },
  }
  const clock = { now: 0 }
  const reader = createLiveClaimableReader(fake as unknown as PublicClient, {
    wait: async (ms) => {
      clock.now += ms
    },
    now: () => clock.now,
  })
  return { reader, requests, clock }
}

function laid(live: Awaited<ReturnType<ReturnType<typeof client>["reader"]>>) {
  return overlayClaimable({
    overview,
    rewards,
    live,
    cards,
    prices: demoPrices,
    nowSeconds: 1_794_500_000,
  })
}

const symbols = (
  tokens: readonly { token: { symbol: string }; amount: string }[],
) => tokens.map((token) => `${token.token.symbol} ${token.amount}`).sort()

describe("live claimable over a stored document", () => {
  it("adds the pool fees the stored document did not have", async () => {
    const { reader, requests } = client()
    const live = await reader(overview, 1_200)
    expect(live.block).toBe(13_180_426)
    expect(live.partial).toBe(false)
    const result = laid(live)
    const [lock] = result.overview.locks
    expect(symbols(lock?.claimable.tokens ?? [])).toEqual([
      "MEZO 8701",
      "MUSD 1124.591570389013644316",
    ])
    // The wallet's total and the Rewards ledger follow.
    expect(symbols(result.overview.claimable.tokens)).toEqual([
      "MEZO 8701",
      "MUSD 1124.591570389013644316",
    ])
    expect(symbols(result.rewards.readyToClaim.tokens)).toEqual(
      symbols(result.overview.claimable.tokens),
    )
    // Rewards names the pool's gauge, so Claim can ask for its fees.
    const entry = result.rewards.byLock.find(
      (each) => each.lock.tokenId === "848",
    )
    expect(
      entry?.gauges.map((gauge) => [gauge.gauge.address, gauge.gauge.voter]),
    ).toEqual(
      expect.arrayContaining([
        [poolGauge.toLowerCase(), "pools"],
        [validator.toLowerCase(), "validators"],
      ]),
    )
    // Everything else in the document is as stored.
    expect(lock?.locked).toEqual(storedLock.locked)
    expect(lock?.vote).toEqual(storedLock.vote)
    // Four round trips: votes, the pool's gauge, reward contracts, earned.
    expect(requests).toHaveLength(4)
  })

  it("reads the lock's votes from the chain, not from the stored document", async () => {
    // The stored vote is whatever the fixture says; the read asks the
    // voters, so a vote changed since the document was built is followed.
    const { reader, requests } = client()
    await reader(overview, 1_200)
    expect(
      new Set((requests[0] ?? []).map((call) => call.functionName)),
    ).toEqual(new Set(["getBlockNumber", "gaugeVote", "poolVote"]))
  })
})

describe("a read that fails never becomes a smaller figure", () => {
  it("asks a throttled request once more, and has the answer", async () => {
    // The earned request is lost once.
    const { reader, requests } = client((index) =>
      index === 3 ? "throttled" : null,
    )
    const result = laid(await reader(overview, 1_200))
    expect(symbols(result.overview.claimable.tokens)).toContain(
      "MUSD 1124.591570389013644316",
    )
    expect(requests).toHaveLength(5)
  })

  it("gives the read up when the RPC stays throttled", async () => {
    const { reader } = client((index) => (index >= 3 ? "throttled" : null))
    await expect(reader(overview, 1_200)).rejects.toBeInstanceOf(
      ClaimableUnread,
    )
  })

  it("does not take a fallback endpoint's refusal for an answer", async () => {
    // Every call of the request comes back failed with -32602. Without the
    // probe that would read as "no votes" or "nothing earned".
    const refusedVotes = client((index) => (index <= 1 ? "refused" : null))
    await expect(refusedVotes.reader(overview, 1_200)).rejects.toBeInstanceOf(
      ClaimableUnread,
    )
    const refusedEarned = client((index) => (index >= 3 ? "refused" : null))
    await expect(refusedEarned.reader(overview, 1_200)).rejects.toBeInstanceOf(
      ClaimableUnread,
    )
    // Refused once, then served: the answer is whole.
    const once = client((index) => (index === 0 ? "refused" : null))
    expect(
      symbols(
        laid(await once.reader(overview, 1_200)).overview.claimable.tokens,
      ),
    ).toContain("MUSD 1124.591570389013644316")
  })

  it("stops at the deadline", async () => {
    const { reader, requests, clock } = client()
    clock.now = 2_000
    await expect(reader(overview, 1_200)).rejects.toBeInstanceOf(
      ClaimableUnread,
    )
    expect(requests).toHaveLength(0)
  })
})

describe("what one view may cost", () => {
  it("reads the largest locks live and leaves the rest stored, saying so", async () => {
    // 60 locks, each voting a pool and a validator: 3 contracts times the
    // known tokens per lock, far past the bound.
    const many = Array.from({ length: 60 }, (_, index) => ({
      ...storedLock,
      tokenId: `${900 + index}`,
      votingPower: `${index + 1}`,
    }))
    const fake = {
      async multicall(input: { contracts: readonly FakeCall[] }) {
        return input.contracts.map((call): Result => {
          const [, second] = call.args ?? []
          if (call.functionName === "poolVote") {
            return second === 0n
              ? { status: "success", result: pool }
              : { status: "failure", error: new Error("reverted") }
          }
          if (call.functionName === "gaugeVote") {
            return second === 0n
              ? { status: "success", result: validator }
              : { status: "failure", error: new Error("reverted") }
          }
          const result = answer(call as Call & { address: string })
          return result === undefined
            ? { status: "failure", error: new Error("reverted") }
            : { status: "success", result }
        })
      },
    }
    let earnedCalls = 0
    const counting = {
      async multicall(input: { contracts: readonly FakeCall[] }) {
        earnedCalls += input.contracts.filter(
          (call) => call.functionName === "earned",
        ).length
        return fake.multicall(input)
      },
    }
    const reader = createLiveClaimableReader(
      counting as unknown as PublicClient,
    )
    const live = await reader({ ...overview, locks: many }, Date.now() + 5_000)
    expect(live.partial).toBe(true)
    expect(earnedCalls).toBeLessThanOrEqual(maxEarnedCallsPerView)
    expect(live.locks.length).toBeGreaterThan(0)
    expect(live.locks.length).toBeLessThan(60)
    // The largest lock (the last one) is among those read.
    expect(live.locks.some((lock) => lock.tokenId === "959")).toBe(true)
    // The locks left out keep their stored claimable.
    const result = overlayClaimable({
      overview: { ...overview, locks: many },
      rewards,
      live,
      cards,
      prices: demoPrices,
      nowSeconds: 1_794_500_000,
    })
    const smallest = result.overview.locks.find(
      (lock) => lock.tokenId === "900",
    )
    expect(smallest?.claimable).toEqual(storedLock.claimable)
  })
})
