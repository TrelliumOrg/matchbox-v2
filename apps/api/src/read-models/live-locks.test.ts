import { CONTRACTS } from "@matchbox/chain"
import {
  type WalletLock,
  walletOverviewSchema,
  walletRewardsSchema,
} from "@matchbox/contracts/read-models"
import {
  demoGaugeCards,
  demoGaugeDirectory,
  demoNow,
  demoPrices,
  demoWalletOverview,
  demoWalletRewards,
} from "@matchbox/contracts/read-models/fixtures"
import { decimalToScaledBigInt } from "@matchbox/domain"
import type { PublicClient } from "viem"
import { describe, expect, it } from "vitest"
import { rejectedWithin } from "../test-timing"
import { type ChainRequestOptions, ClaimableUnread } from "./live-claimable"
import {
  createLatestLockIdsReader,
  createLiveLockReader,
  createLiveLocksReader,
  createOwnerLocksReader,
  type LiveLocks,
  lockCounts,
  reconcileWallet,
} from "./live-locks"
import type { LiveLock } from "./live-wallet"
import { gaugeCardsFrom } from "./wallet-extras"

const wad = 10n ** 18n
const cards = gaugeCardsFrom(demoGaugeDirectory)
const kiln = demoGaugeCards.kilnLabs.gauge.address
const wallet = `0x${"ab".repeat(20)}`
const zero = "0x0000000000000000000000000000000000000000"
// A pool and its gauge: PoolsVoter votes name the pool.
const pool = "0xb4D498029af77680cD1eF828b967f010d06C51CC"
const poolGauge = "0x677817bF3e44b90E8F95222F75e2950b7904a401"

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

type Chain = {
  block: bigint
  /** Lock ids per escrow contract address, lower case. */
  ids: Record<string, bigint[]>
  locked: Record<string, { amount: bigint; end: bigint; isPermanent: boolean }>
  power: Record<string, bigint>
  /** `${voter contract}:${tokenId}` to the targets voted and their weights. */
  votes: Record<string, { target: string; weight: bigint }[]>
  lastVoted: bigint
  /** ownerOf by lock id; a lock not named has no owner (zero address). */
  owners?: Record<string, string>
  /** tokenId() per escrow contract, lower case. */
  latest?: Record<string, bigint>
}

/** A client like the Worker's, over a small chain state. */
function client(
  chain: Chain,
  lose: (call: Call) => boolean = () => false,
  options: ChainRequestOptions = {},
) {
  const requests: Call[][] = []
  function answer(call: Call): unknown {
    const [first, second] = call.args ?? []
    const contract = (call.address ?? "").toLowerCase()
    const votes = chain.votes[`${contract}:${first}`] ?? []
    switch (call.functionName) {
      case "getBlockNumber":
        return chain.block
      case "balanceOf":
        return BigInt(chain.ids[contract]?.length ?? 0)
      case "ownerToNFTokenIdList":
        return chain.ids[contract]?.[Number(second)] ?? 0n
      case "locked":
        return chain.locked[String(first)]
      case "votingPowerOfNFT":
        return chain.power[String(first)]
      case "usedWeights":
        return votes.reduce((sum, vote) => sum + vote.weight, 0n)
      case "lastVoted":
        return votes.length === 0 ? 0n : chain.lastVoted
      case "gaugeVote":
      case "poolVote":
        return votes[Number(second)]?.target
      case "votes":
        return votes.find((vote) => same(second, vote.target))?.weight ?? 0n
      case "gauges":
        return same(first, pool) ? poolGauge : zero
      case "ownerOf":
        return chain.owners?.[String(first)] ?? zero
      case "tokenId":
        return chain.latest?.[contract]
      default:
        return undefined
    }
  }
  const fake = {
    async multicall(input: { contracts: readonly Call[] }) {
      requests.push([...input.contracts])
      return input.contracts.map((call): Result => {
        const result = lose(call) ? undefined : answer(call)
        return result === undefined
          ? { status: "failure", error: new Error("reverted") }
          : { status: "success", result }
      })
    },
  }
  const clock = { now: 0 }
  const timing = {
    wait: async (ms: number) => {
      clock.now += ms
    },
    now: () => clock.now,
  }
  const viem = fake as unknown as PublicClient
  const reader = createLiveLocksReader(viem, timing, options)
  const one = createLiveLockReader(viem, timing, options)
  const owner = createOwnerLocksReader(viem, timing, options)
  const latest = createLatestLockIdsReader(viem, timing, options)
  return { reader, one, owner, latest, requests }
}

// The escrow and voter contracts, as the reader addresses them.
const veBtc = CONTRACTS.mainnet.veBTC.toLowerCase()
const veMezo = CONTRACTS.mainnet.veMEZO.toLowerCase()
const boostVoter = CONTRACTS.mainnet.boostVoter.toLowerCase()
const poolsVoter = CONTRACTS.mainnet.poolsVoter.toLowerCase()

/** 0xcc1b…2b2b on 13 Nov 2026: a new veBTC lock beside a voting veMEZO one. */
const chain: Chain = {
  block: 13_203_206n,
  ids: { [veBtc]: [6179n], [veMezo]: [2322n] },
  locked: {
    "6179": { amount: 10n ** 13n, end: 0n, isPermanent: true },
    "2322": { amount: 77_642n * wad, end: 0n, isPermanent: true },
  },
  power: { "6179": 10n ** 13n, "2322": 77_642n * wad },
  votes: {
    [`${boostVoter}:2322`]: [{ target: kiln, weight: 77_642n * wad }],
  },
  lastVoted: 1_793_829_369n,
}

describe("a wallet's locks read from the chain", () => {
  it("reads the lock set, each lock and its votes in three requests", async () => {
    const { reader, requests } = client(chain)
    // The stored document names the veMEZO lock only.
    const live = await reader(wallet, 1_500, { vebtc: 0, vemezo: 1 })
    expect(requests).toHaveLength(3)
    expect(live.block).toBe(13_203_206)
    expect(live.capped).toEqual([])
    expect(live.locks).toEqual([
      {
        escrow: "vebtc",
        tokenId: "6179",
        amount: 10n ** 13n,
        end: 0,
        isPermanent: true,
        votingPower: 10n ** 13n,
        votes: [],
        lastVotedAt: 0,
        lastVoted: [],
        earned: [],
      },
      {
        escrow: "vemezo",
        tokenId: "2322",
        amount: 77_642n * wad,
        end: 0,
        isPermanent: true,
        votingPower: 77_642n * wad,
        votes: [{ gauge: kiln, voter: "boost", weight: 77_642n * wad }],
        lastVotedAt: 1_793_829_369,
        lastVoted: [{ voter: "boost", at: 1_793_829_369 }],
        earned: [],
      },
    ] satisfies LiveLock[])
  })

  it("names a pool vote by the pool's gauge", async () => {
    const { reader } = client({
      ...chain,
      votes: { [`${poolsVoter}:6179`]: [{ target: pool, weight: 10n ** 13n }] },
    })
    const live = await reader(wallet, 1_500, { vebtc: 1, vemezo: 1 })
    expect(live.locks[0]?.votes).toEqual([
      { gauge: poolGauge.toLowerCase(), voter: "pools", weight: 10n ** 13n },
    ])
  })

  it("asks again for ids past the ones it guessed", async () => {
    const ids = [11n, 12n, 13n, 14n, 15n]
    const { reader, requests } = client({
      ...chain,
      ids: { [veBtc]: [], [veMezo]: ids },
      locked: Object.fromEntries(
        ids.map((id) => [
          String(id),
          { amount: wad, end: 0n, isPermanent: true },
        ]),
      ),
      power: Object.fromEntries(ids.map((id) => [String(id), wad])),
      votes: {},
    })
    const live = await reader(wallet, 1_500, { vebtc: 0, vemezo: 0 })
    expect(live.locks.map((lock) => lock.tokenId)).toEqual(
      ids.map((id) => String(id)),
    )
    // Ids, the rest of the ids, the locks. Nothing votes: no fourth.
    expect(requests).toHaveLength(3)
  })

  it("says so when the wallet holds more locks than it lists", async () => {
    const ids = Array.from({ length: 60 }, (_, index) => BigInt(index + 1))
    const { reader } = client({
      ...chain,
      ids: { [veBtc]: [], [veMezo]: ids },
      locked: Object.fromEntries(
        ids.map((id) => [
          String(id),
          { amount: wad, end: 0n, isPermanent: true },
        ]),
      ),
      power: Object.fromEntries(ids.map((id) => [String(id), wad])),
      votes: {},
    })
    const live = await reader(wallet, 1_500, { vebtc: 0, vemezo: 60 })
    expect(live.locks).toHaveLength(50)
    expect(live.capped).toEqual(["vemezo"])
  })

  it("gives the read up when a lock does not answer, never drops it", async () => {
    const { reader } = client(
      chain,
      (call) => call.functionName === "locked" && call.args?.[0] === 2322n,
    )
    await expect(
      reader(wallet, 1_500, { vebtc: 0, vemezo: 1 }),
    ).rejects.toBeInstanceOf(ClaimableUnread)
  })

  it("gives the read up when the chain does not answer at all", async () => {
    const { reader } = client(
      chain,
      (call) => call.functionName === "getBlockNumber",
    )
    await expect(
      reader(wallet, 1_500, { vebtc: 0, vemezo: 1 }),
    ).rejects.toBeInstanceOf(ClaimableUnread)
  })
})

describe("one lock read from the chain", () => {
  const owned: Chain = { ...chain, owners: { "6179": wallet, "2322": wallet } }

  it("reads a lock that does not vote, with its owner, in one request", async () => {
    const { one, requests } = client(owned)
    const read = await one("vebtc", "6179", 1_500)
    expect(requests).toHaveLength(1)
    expect(read).toEqual({
      block: 13_203_206,
      owner: wallet,
      lock: {
        escrow: "vebtc",
        tokenId: "6179",
        amount: 10n ** 13n,
        end: 0,
        isPermanent: true,
        votingPower: 10n ** 13n,
        votes: [],
        lastVotedAt: 0,
        lastVoted: [],
        earned: [],
      },
    } satisfies Awaited<ReturnType<typeof one>>)
  })

  it("reads a lock that votes in two", async () => {
    const { one, requests } = client(owned)
    const read = await one("vemezo", "2322", 1_500)
    expect(requests).toHaveLength(2)
    expect(read.lock?.votes).toEqual([
      { gauge: kiln, voter: "boost", weight: 77_642n * wad },
    ])
    expect(read.lock?.lastVotedAt).toBe(1_793_829_369)
  })

  it("says there is no such lock when it has no owner", async () => {
    const { one, requests } = client(owned)
    expect(await one("vebtc", "999999", 1_500)).toEqual({
      block: 13_203_206,
      owner: null,
      lock: null,
    })
    expect(requests).toHaveLength(1)
    // An escrow whose ownerOf reverts for it says the same.
    const reverting = client(owned, (call) => call.functionName === "ownerOf")
    expect((await reverting.one("vebtc", "6179", 1_500)).owner).toBeNull()
  })

  it("gives the read up when the chain does not answer", async () => {
    const { one } = client(
      owned,
      (call) => call.functionName === "getBlockNumber",
    )
    await expect(one("vebtc", "6179", 1_500)).rejects.toBeInstanceOf(
      ClaimableUnread,
    )
  })
})

describe("a wallet's locks for a list: amount and unlock only", () => {
  it("reads the lock set and each lock's amount in two requests, no voter calls", async () => {
    const { owner, requests } = client(chain)
    const read = await owner(wallet, 1_500, { vebtc: 0, vemezo: 1 })
    expect(requests).toHaveLength(2)
    expect(requests.flat().map((call) => call.functionName)).not.toContain(
      "usedWeights",
    )
    expect(read).toEqual({
      block: 13_203_206,
      capped: [],
      locks: [
        {
          escrow: "vebtc",
          tokenId: "6179",
          amount: 10n ** 13n,
          end: 0,
          isPermanent: true,
        },
        {
          escrow: "vemezo",
          tokenId: "2322",
          amount: 77_642n * wad,
          end: 0,
          isPermanent: true,
        },
      ],
    })
  })

  it("reads a wallet with no locks in one request", async () => {
    const { owner, requests } = client({ ...chain, ids: {} })
    expect((await owner(wallet, 1_500, { vebtc: 0, vemezo: 0 })).locks).toEqual(
      [],
    )
    expect(requests).toHaveLength(1)
  })

  it("reads a wallet past 50 locks an escrow in three requests, cut at 50", async () => {
    const ids = Array.from({ length: 60 }, (_, index) => BigInt(index + 1))
    const { owner, requests } = client({
      ...chain,
      ids: { [veBtc]: ids, [veMezo]: ids.map((id) => id + 1_000n) },
      locked: Object.fromEntries(
        [...ids, ...ids.map((id) => id + 1_000n)].map((id) => [
          String(id),
          { amount: wad, end: 0n, isPermanent: true },
        ]),
      ),
    })
    const read = await owner(wallet, 1_500, { vebtc: 25, vemezo: 0 })
    // Counts with 27 and 2 ids, the other ids, then 100 `locked` calls.
    expect(requests).toHaveLength(3)
    expect(read.locks).toHaveLength(100)
    expect(read.capped).toEqual(["vebtc", "vemezo"])
  })
})

describe("each escrow's newest lock id", () => {
  it("reads both counters in one request", async () => {
    const { latest, requests } = client({
      ...chain,
      latest: { [veBtc]: 6_179n, [veMezo]: 2_945n },
    })
    expect(await latest(1_500)).toEqual({
      block: 13_203_206,
      ids: { vebtc: 6_179n, vemezo: 2_945n },
    })
    expect(requests).toHaveLength(1)
  })
})

describe("a chain that never answers", () => {
  /** An RPC client whose requests never come back. */
  const hung = {
    multicall: () => new Promise(() => undefined),
  } as unknown as PublicClient

  it("gives every read up at its deadline, not the client's", async () => {
    const readers = [
      () => createLiveLockReader(hung)("vebtc", "6179", Date.now() + 100),
      () =>
        createLiveLocksReader(hung)(wallet, Date.now() + 100, {
          vebtc: 0,
          vemezo: 0,
        }),
      () =>
        createOwnerLocksReader(hung)(wallet, Date.now() + 100, {
          vebtc: 0,
          vemezo: 0,
        }),
      () => createLatestLockIdsReader(hung)(Date.now() + 100),
    ]
    for (const read of readers) {
      // The 100 ms deadline, well before a timer at 1 s.
      expect(await rejectedWithin(read(), 1_000)).toBeInstanceOf(
        ClaimableUnread,
      )
    }
  })

  it("asks once with one attempt, as Matchscan's readers do", async () => {
    const { one, requests } = client(
      chain,
      (call) => call.functionName === "getBlockNumber",
      { attempts: 1 },
    )
    await expect(one("vebtc", "6179", 1_500)).rejects.toBeInstanceOf(
      ClaimableUnread,
    )
    expect(requests).toHaveLength(1)
  })
})

// The stored documents: veBTC #4120 and veMEZO #2207, with history.
const stored = { overview: demoWalletOverview, rewards: demoWalletRewards }
const [vebtc4120, vemezo2207] = demoWalletOverview.locks
if (vebtc4120 === undefined || vemezo2207 === undefined) {
  throw new Error("fixture")
}

/** The chain's view of a stored lock, unchanged unless `patch` says. */
function onChain(lock: WalletLock, patch: Partial<LiveLock> = {}): LiveLock {
  return {
    escrow: lock.escrow,
    tokenId: lock.tokenId,
    amount: 8n * 10n ** 17n,
    end: lock.unlocksAt ?? 0,
    isPermanent: lock.isPermanent,
    votingPower: 6n * 10n ** 17n,
    votes: [],
    lastVotedAt: 0,
    lastVoted: [],
    earned: [],
    ...patch,
  }
}

function reconcile(live: Partial<LiveLocks> & { locks: LiveLock[] }) {
  const result = reconcileWallet({
    ...stored,
    live: { block: 13_203_206, capped: [], ...live },
    cards,
    prices: demoPrices,
    nowSeconds: demoNow,
  })
  // What is served must still be a valid document.
  walletOverviewSchema.parse(result.overview)
  walletRewardsSchema.parse(result.rewards)
  return result
}

const ids = (locks: readonly { tokenId: string }[]) =>
  locks.map((lock) => lock.tokenId)

/** "MEZO 47300000000000000000": exact, whatever zeros the decimal carries. */
const amounts = (
  tokens: readonly { token: { symbol: string }; amount: string }[],
) =>
  tokens
    .map(
      (entry) =>
        `${entry.token.symbol} ${decimalToScaledBigInt(entry.amount, 18)}`,
    )
    .sort()

describe("stored wallet documents reconciled with the chain", () => {
  it("adds a lock the chain has and the document lacks", () => {
    const created = onChain(vebtc4120, {
      tokenId: "6179",
      amount: 10n ** 13n,
      end: 0,
      isPermanent: true,
      votingPower: 10n ** 13n,
    })
    const { overview, added } = reconcile({
      locks: [onChain(vebtc4120), onChain(vemezo2207), created],
    })
    expect(ids(overview.locks)).toEqual(["4120", "2207", "6179"])
    expect(ids(added)).toEqual(["6179"])
    const lock = overview.locks.find((each) => each.tokenId === "6179")
    expect(lock).toMatchObject({
      escrow: "vebtc",
      tab: "vebtc",
      isPermanent: true,
      unlocksAt: null,
      votingPower: "0.00001",
      vote: { status: "not-voted" },
      // Nothing is known of when it was made until the indexer has it.
      createdAt: null,
    })
    expect(lock?.locked.amount).toBe("0.00001")
    expect(lock?.claimable.tokens).toEqual([])
  })

  it("drops a lock the wallet no longer owns, and its rewards entry", () => {
    const { overview, rewards, removed } = reconcile({
      locks: [onChain(vemezo2207)],
    })
    expect(ids(overview.locks)).toEqual(["2207"])
    expect(removed).toBe(1)
    expect(rewards.byLock.map((entry) => entry.lock.tokenId)).toEqual(
      demoWalletRewards.byLock
        .map((entry) => entry.lock.tokenId)
        .filter((tokenId) => tokenId !== "4120"),
    )
    // The wallet's claimable is what its remaining lock can claim.
    expect(amounts(overview.claimable.tokens)).toEqual(
      amounts(overview.locks[0]?.claimable.tokens ?? []),
    )
    expect(overview.claimable.tokens.length).toBeGreaterThan(0)
    expect(rewards.readyToClaim).toEqual(overview.claimable)
  })

  it("keeps a stored lock a capped read did not return", () => {
    const { overview, removed } = reconcile({
      locks: [onChain(vebtc4120)],
      capped: ["vemezo"],
    })
    expect(ids(overview.locks)).toEqual(["4120", "2207"])
    expect(removed).toBe(0)
    expect(overview.locks[1]).toEqual(vemezo2207)
  })

  it("takes amount, unlock, power and votes from the chain", () => {
    const { overview } = reconcile({
      locks: [
        onChain(vebtc4120, { amount: 2n * wad, votingPower: 2n * wad }),
        onChain(vemezo2207, {
          amount: 60_000n * wad,
          end: demoNow + 86_400 * 700,
          votingPower: 50_000n * wad,
          votes: [{ gauge: kiln, voter: "boost", weight: 50_000n * wad }],
          lastVotedAt: demoNow - 30,
          lastVoted: [{ voter: "boost", at: demoNow - 30 }],
        }),
      ],
    })
    const [btcLock, mezoLock] = overview.locks
    expect(btcLock?.locked.amount).toBe("2")
    expect(btcLock?.votingPower).toBe("2")
    // The stored document said it votes; the chain says it does not now.
    expect(btcLock?.vote.status).toBe("not-voted")
    expect(mezoLock?.locked.amount).toBe("60000")
    expect(mezoLock?.unlocksAt).toBe(demoNow + 86_400 * 700)
    expect(mezoLock?.vote).toMatchObject({
      status: "voted",
      votes: "50000",
      votedAt: demoNow - 30,
      byVoter: [
        {
          voter: "boost",
          votes: "50000",
          allocations: [{ gauge: { address: kiln }, basisPoints: 10_000 }],
        },
      ],
    })
    expect(mezoLock?.projected).not.toBeNull()
  })

  it("keeps what only history knows: claimable, creation, activity, earned", () => {
    const { overview, rewards } = reconcile({
      locks: [onChain(vebtc4120), onChain(vemezo2207)],
    })
    expect(overview.locks.map((lock) => lock.createdAt)).toEqual(
      demoWalletOverview.locks.map((lock) => lock.createdAt),
    )
    expect(overview.locks.map((lock) => lock.claimable)).toEqual(
      demoWalletOverview.locks.map((lock) => lock.claimable),
    )
    expect(overview.recentActivity).toEqual(demoWalletOverview.recentActivity)
    expect(overview.recentActivity.length).toBeGreaterThan(0)
    expect(rewards.history).toEqual(demoWalletRewards.history)
    expect(rewards.earned).toEqual(demoWalletRewards.earned)
    expect(rewards.byLock).toEqual(demoWalletRewards.byLock)
  })

  it("counts the stored locks per escrow", () => {
    expect(lockCounts(demoWalletOverview)).toEqual({ vebtc: 1, vemezo: 1 })
  })
})
