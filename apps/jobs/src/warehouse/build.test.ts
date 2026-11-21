import { addDays, utcDay } from "@matchbox/api/read-models/claim-prices"
import { CONTRACTS } from "@matchbox/chain"
import {
  type GaugeCard,
  gaugeFundingSchema,
  gaugeHistorySchema,
  protocolActivitySchema,
  protocolEpochSchema,
  protocolHistorySchema,
  protocolSchema,
  walletActivitySchema,
  walletOverviewSchema,
  walletRewardsSchema,
} from "@matchbox/contracts/read-models"
import { demoPrices } from "@matchbox/contracts/read-models/fixtures"
import { describe, expect, it } from "vitest"
import {
  activityRows,
  allocationsFrom,
  type BuildContext,
  buildProtocol,
  buildProtocolActivity,
  buildProtocolHistory,
  buildWalletDocuments,
  epochsSinceLaunch,
  protocolActivityRows,
} from "./build"
import { earnedKey } from "./chain"
import { buildGaugeHistories } from "./gauge-history"
import type { ActivityEventRow, LockRow, ProtocolRows, VoteRow } from "./reader"
import {
  correctLocks,
  countByKind,
  nextSweepSize,
  sweepTiming,
  timedCalls,
} from "./snapshot"

const wad = 10n ** 18n
// Sun 8 Nov 2026 11:53 UTC; the epoch started Thu 5 Nov.
const now = 1_794_138_780
const epochStart = 1_793_836_800
const wallet = "0x7c21000000000000000000000000000000009e0b"
const kiln = "0x1000000000000000000000000000000000000007"
const sats = "0x1000000000000000000000000000000000000112"
const bribe = "0xb000000000000000000000000000000000000007"
const mezo = "0x7b7c000000000000000000000000000000000001"
const btc = "0x7b7c000000000000000000000000000000000000"
const vemezo = CONTRACTS.mainnet.veMEZO.toLowerCase()
const vebtc = CONTRACTS.mainnet.veBTC.toLowerCase()

const kilnRef = {
  address: kiln,
  voter: "boost" as const,
  name: "Kiln Labs",
  vebtcTokenId: "7",
  picture: { type: "initials" as const, text: "KL" },
  poolType: null,
  color: "#3E7CB1",
  kind: "vebtc" as const,
  tickSpacing: null,
  coin: null,
}

/** Kiln Labs at 4.4x: 6413.04 MEZO of incentives on 5,880,000 votes. */
const kilnCard: GaugeCard = {
  gauge: kilnRef,
  votesUnit: "veMEZO",
  meta: null,
  tagline: null,
  isAlive: true,
  apy: "2.56",
  incentives: {
    usd: "1180.00",
    tokens: [
      {
        token: {
          address: "0x7b7c000000000000000000000000000000000001",
          symbol: "MEZO",
          name: "Mezo",
          decimals: 18,
        },
        amount: "6413.04",
        usd: "1180.00",
      },
    ],
  },
  vebtcWeight: "3.1047",
  votes: "5880000",
  optimalVotes: "6970000",
  boost: "4.4",
}

const context: BuildContext = {
  nowSeconds: now,
  prices: demoPrices,
  gauges: new Map([[kiln, kilnRef]]),
  cards: new Map([[kiln, kilnCard]]),
  historicPrice: () => null,
  claimPrices: null,
}

function event(fields: Partial<ActivityEventRow>): ActivityEventRow {
  return {
    tx_hash: `0x${"a".repeat(64)}`,
    log_index: "0",
    block_number: "13078000",
    timestamp: String(now - 3_600),
    action_type: "BOOST_VOTE",
    source: "BOOST_VOTER",
    actor: wallet,
    recipient: null,
    token_id: "2207",
    amount: null,
    duration: null,
    prev_duration: null,
    post_duration: null,
    prev_is_permanent: null,
    post_is_permanent: null,
    merge_source_token_id: null,
    merge_dest_token_id: null,
    token: null,
    gauge: null,
    weight: null,
    boostable_token_id: null,
    boost: null,
    epoch_start: null,
    contract_address: CONTRACTS.mainnet.boostVoter.toLowerCase(),
    ...fields,
  }
}

describe("allocationsFrom", () => {
  it("splits basis points exactly, remainder on the largest", () => {
    const gauge = context.gauges.get(kiln)
    if (gauge === undefined) throw new Error("fixture")
    const split = allocationsFrom([
      { gauge, weight: 1n },
      { gauge: { ...gauge, address: sats }, weight: 1n },
      { gauge: { ...gauge, address: bribe }, weight: 1n },
    ])
    expect(split.map((entry) => entry.basisPoints)).toEqual([3334, 3333, 3333])
  })
})

describe("activity rows", () => {
  it("folds one vote transaction into one row with allocations", () => {
    const rows = activityRows(context, [
      event({
        gauge: kiln,
        weight: (28_882n * wad).toString(),
        log_index: "3",
      }),
      event({
        gauge: sats,
        weight: (12_378n * wad).toString(),
        log_index: "4",
      }),
    ])
    expect(rows).toHaveLength(1)
    const [vote] = rows
    expect(vote).toMatchObject({
      type: "vote",
      id: `0x${"a".repeat(64)}-3`,
      lock: { escrow: "vemezo", tokenId: "2207" },
      votes: "41260",
      epoch: { start: epochStart },
    })
    if (vote?.type !== "vote") throw new Error("expected a vote")
    expect(vote.allocations.map((entry) => entry.basisPoints)).toEqual([
      7000, 3000,
    ])
    expect(vote.allocations[0]?.gauge.name).toBe("Kiln Labs")
    // A gauge without a profile falls back to its short address.
    expect(vote.allocations[1]?.gauge.name).toBe("0x1000…0112")
  })

  it("folds a claim transaction and maps lock events", () => {
    const claimTx = `0x${"c".repeat(64)}`
    const rows = activityRows(context, [
      event({
        tx_hash: claimTx,
        action_type: "VOTE_BRIBE_CLAIMED",
        source: "BRIBE_VOTING_REWARD",
        token: mezo,
        amount: ((2_652_170n * wad) / 1000n).toString(),
        gauge: kiln,
        timestamp: String(now - 7_200),
      }),
      event({
        tx_hash: claimTx,
        log_index: "1",
        action_type: "VOTE_FEE_CLAIMED",
        source: "FEE_VOTING_REWARD",
        token: btc,
        amount: ((148n * wad) / 1_000_000n).toString(),
        gauge: kiln,
        timestamp: String(now - 7_200),
      }),
      event({
        tx_hash: `0x${"d".repeat(64)}`,
        action_type: "LOCK_AMOUNT_INCREASED",
        source: "VOTING_ESCROW",
        contract_address: vemezo,
        amount: (6_000n * wad).toString(),
        duration: "1894147200",
        timestamp: String(now - 86_400),
      }),
    ])
    expect(rows.map((row) => row.type)).toEqual(["claim", "lock-add"])
    const [claim, add] = rows
    if (claim?.type !== "claim" || add?.type !== "lock-add") {
      throw new Error("unexpected rows")
    }
    expect(claim.rewards.tokens.map((token) => token.amount)).toEqual([
      "2652.17",
      "0.000148",
    ])
    // 2652.17 MEZO at $0.184 is $488.00; 0.000148 BTC at $105,710 is $15.65.
    expect(claim.rewards.usd).toBe("503.65")
    expect(claim.epoch?.start).toBe(epochStart - 604_800)
    expect(claim.locks).toEqual([{ escrow: "vemezo", tokenId: "2207" }])
    expect(add).toMatchObject({
      lock: { escrow: "vemezo", tokenId: "2207" },
      amount: { amount: "6000", usd: "1104.00" },
      unlocksAt: 1_894_147_200,
    })
  })
})

describe("lock duration rows", () => {
  it("turns permanent locks and unlocks into lock-extend rows", () => {
    const ts = now - 600
    const rows = activityRows(context, [
      event({
        tx_hash: `0x${"e".repeat(64)}`,
        action_type: "LOCK_PERMANENT",
        source: "VOTING_ESCROW",
        contract_address: vebtc,
        token_id: "9",
        amount: wad.toString(),
        prev_duration: "2385587",
        prev_is_permanent: false,
        post_is_permanent: true,
        timestamp: String(ts),
      }),
      event({
        tx_hash: `0x${"f".repeat(64)}`,
        action_type: "LOCK_PERMANENT_UNLOCKED",
        source: "VOTING_ESCROW",
        contract_address: vebtc,
        token_id: "10",
        amount: wad.toString(),
        prev_duration: "126144000",
        post_duration: "126000697",
        prev_is_permanent: true,
        post_is_permanent: false,
        timestamp: String(ts - 60),
      }),
      event({
        tx_hash: `0x${"b".repeat(64)}`,
        action_type: "LOCK_EXTENDED",
        source: "VOTING_ESCROW",
        contract_address: vemezo,
        amount: "0",
        duration: "1798675200",
        prev_duration: "2529856",
        timestamp: String(ts - 120),
      }),
    ])
    expect(rows).toEqual([
      expect.objectContaining({
        type: "lock-extend",
        lock: { escrow: "vebtc", tokenId: "9" },
        previousUnlocksAt: ts + 2_385_587,
        unlocksAt: null,
      }),
      expect.objectContaining({
        type: "lock-extend",
        lock: { escrow: "vebtc", tokenId: "10" },
        previousUnlocksAt: null,
        unlocksAt: ts - 60 + 126_000_697,
      }),
      expect.objectContaining({
        type: "lock-extend",
        lock: { escrow: "vemezo", tokenId: "2207" },
        previousUnlocksAt: ts - 120 + 2_529_856,
        unlocksAt: 1_798_675_200,
      }),
    ])
  })
})

describe("wallet documents", () => {
  const locks: LockRow[] = [
    {
      contract_address: vemezo,
      token_id: "2207",
      owner: wallet,
      amount: (48_000n * wad).toString(),
      unlock_at: "1894147200",
      is_permanent: false,
      created_at: "1781168520",
    },
    {
      contract_address: vebtc,
      token_id: "9",
      owner: wallet,
      amount: (wad / 2n).toString(),
      unlock_at: String(now - 60),
      is_permanent: false,
      created_at: null,
    },
  ]
  const votes: VoteRow[] = [
    {
      voter_contract: CONTRACTS.mainnet.boostVoter.toLowerCase(),
      token_id: "2207",
      gauge: kiln,
      current_weight: (41_260n * wad).toString(),
      last_updated_at: String(now - 3_600),
    },
  ]

  it("gives each voter its own shares and last vote, and names a pool vote's gauge", () => {
    const pool = "0xb4d498029af77680cd1ef828b967f010d06c51cc"
    const poolGauge = "0x677817bf3e44b90e8f95222f75e2950b7904a401"
    const validator = "0xde3593718dcf024daa1e76fcba80e5ce99cd0ea9"
    const sMusd = {
      ...kilnRef,
      address: poolGauge,
      voter: "pools" as const,
      kind: "pool" as const,
      name: "sMUSD",
      vebtcTokenId: null,
    }
    const pooled: BuildContext = {
      ...context,
      gauges: new Map([[poolGauge, sMusd]]),
      poolGauges: new Map([[pool, poolGauge]]),
    }
    const power = 50n * wad
    const documents = buildWalletDocuments(
      pooled,
      {
        wallet,
        locks: [
          {
            contract_address: vebtc,
            token_id: "848",
            owner: wallet,
            amount: (10n * wad).toString(),
            unlock_at: null,
            is_permanent: true,
            created_at: null,
          },
        ],
        // As the snapshot hands them over: the pool vote already on its
        // gauge (reward-sources.ts), voted this epoch; the validator vote
        // from two weeks ago.
        votes: [
          {
            voter_contract: CONTRACTS.mainnet.poolsVoter.toLowerCase(),
            token_id: "848",
            gauge: poolGauge,
            current_weight: power.toString(),
            last_updated_at: String(now - 3_600),
          },
          {
            voter_contract: CONTRACTS.mainnet.validatorsVoter.toLowerCase(),
            token_id: "848",
            gauge: validator,
            current_weight: power.toString(),
            last_updated_at: String(now - 1_209_600),
          },
        ],
        // The event still names the pool.
        events: [
          event({
            action_type: "BOOST_VOTE",
            source: "POOLS_VOTER",
            contract_address: CONTRACTS.mainnet.poolsVoter.toLowerCase(),
            token_id: "848",
            gauge: pool,
            weight: power.toString(),
          }),
        ],
        rewardSources: [],
        votingPower: new Map([["vebtc:848", power]]),
        earned: new Map(),
      },
      new Map(),
    )
    const [lock] = walletOverviewSchema.parse(documents.overview).locks
    if (lock?.vote.status !== "voted") throw new Error("not voted")
    // Together: twice the lock's power, half each.
    expect(lock.vote.votes).toBe("100")
    expect(
      lock.vote.allocations.map((allocation) => allocation.basisPoints),
    ).toEqual([5_000, 5_000])
    expect(lock.vote.votedAt).toBe(now - 3_600)
    // Per voter: the full power and 100% on each, each with its own time.
    expect(
      lock.vote.byVoter.map((each) => [
        each.voter,
        each.votes,
        each.allocations.map((allocation) => [
          allocation.gauge.name,
          allocation.basisPoints,
        ]),
        each.votedAt,
      ]),
    ).toEqual([
      ["validators", "50", [["0xde35…0ea9", 10_000]], now - 1_209_600],
      ["pools", "50", [["sMUSD", 10_000]], now - 3_600],
    ])
    const [row] = walletActivitySchema.parse(documents.activity).rows
    if (row?.type !== "vote") throw new Error("no vote row")
    expect(row.allocations.map((allocation) => allocation.gauge.name)).toEqual([
      "sMUSD",
    ])
  })

  it("builds overview, rewards and activity that parse", () => {
    const documents = buildWalletDocuments(
      context,
      {
        wallet,
        locks,
        votes,
        events: [],
        rewardSources: [{ gauge: kiln, reward_contract: bribe, token: mezo }],
        votingPower: new Map([["vemezo:2207", 41_260n * wad]]),
        earned: new Map([
          [
            earnedKey({ rewardContract: bribe, token: mezo, tokenId: "2207" }),
            (4_730n * wad) / 100n,
          ],
        ]),
      },
      new Map(),
    )
    const overview = walletOverviewSchema.parse(documents.overview)
    walletRewardsSchema.parse(documents.rewards)
    walletActivitySchema.parse(documents.activity)
    const [mezoLock, btcLock] = overview.locks
    expect(mezoLock).toMatchObject({
      tab: "vemezo",
      votingPower: "41260",
      locked: { amount: "48000", usd: "8832.00" },
      vote: { status: "voted", votes: "41260" },
      claimable: { usd: "8.70" },
    })
    expect(btcLock).toMatchObject({
      tab: "expired",
      isWithdrawable: true,
      vote: { status: "not-voted" },
      claimable: { usd: "0.00", tokens: [] },
    })
    expect(overview.claimable.usd).toBe("8.70")
    // 41,260 of Kiln's 5,880,000 votes earn 41260/5880000 of 6413.04 MEZO.
    expect(mezoLock?.projected?.tokens[0]?.amount).toBe("45.000345306122448979")
    expect(btcLock?.projected).toBeNull()
    expect(overview.projected?.usd).toBe(mezoLock?.projected?.usd)
    // The expired veBTC lock outranks everything else.
    expect(overview.suggestion).toEqual({
      type: "withdraw",
      lock: { escrow: "vebtc", tokenId: "9" },
      amount: btcLock?.locked,
    })
    expect(documents.rewards.byLock).toHaveLength(1)
    expect(documents.rewards.byLock[0]?.gauges[0]).toMatchObject({
      gauge: { name: "Kiln Labs" },
      usd: "8.70",
    })
  })

  it("prices stored claims as the document's, by their token amounts", () => {
    const claimEvent = (tx: string, ts: number) =>
      event({
        tx_hash: tx,
        action_type: "VOTE_BRIBE_CLAIMED",
        source: "BRIBE_VOTING_REWARD",
        token: mezo,
        amount: ((2_652_170n * wad) / 1000n).toString(),
        gauge: kiln,
        timestamp: String(ts),
      })
    // Stored weeks ago, when MEZO was priced otherwise, with a token the
    // registry does not know beside it.
    const [stored] = activityRows(context, [
      claimEvent(`0x${"e".repeat(64)}`, now - 30 * 86_400),
    ])
    if (stored?.type !== "claim") throw new Error("unexpected row")
    const [mezoAmount] = stored.rewards.tokens
    if (mezoAmount === undefined) throw new Error("unexpected row")
    const stale = {
      ...stored,
      rewards: {
        usd: "1005.00",
        tokens: [
          { ...mezoAmount, usd: "1000.00" },
          {
            token: {
              address: `0x${"9".repeat(40)}`,
              symbol: "ODD",
              name: "Odd",
              decimals: 18,
            },
            amount: "5",
            usd: "5.00",
          },
        ],
      },
    }
    const staleDay = utcDay(now - 30 * 86_400)
    const recentDay = utcDay(now - 7_200)
    const priced: BuildContext = {
      ...context,
      claimPrices: {
        daily: new Map([
          [`mezo:${staleDay}`, { usd: "0.184", source: "coingecko" }],
          [`mezo:${recentDay}`, { usd: "0.25", source: "coingecko" }],
        ]),
        coverage: {
          btc: null,
          mezo: { from: "2025-12-03", through: recentDay },
        },
      },
    }
    const build = (claimContext: BuildContext) =>
      buildWalletDocuments(
        claimContext,
        {
          wallet,
          locks: [],
          votes: [],
          events: [claimEvent(`0x${"f".repeat(64)}`, now - 7_200)],
          rewardSources: [],
          votingPower: new Map(),
          earned: new Map(),
          storedClaims: [stale],
        },
        new Map(),
      )
    const documents = build(priced)
    // 2652.17 MEZO at each claim's own day: $0.184 ($488.00) and $0.25
    // ($663.04). The unregistered token counts no dollars: that claim is
    // counted as one with a token that had no price.
    expect(documents.rewards.earned).toMatchObject({
      usd: "1151.04",
      whenClaimed: { unpriced: 1, pending: 0 },
    })
    expect(documents.rewards.history).toHaveLength(1)
    expect(documents.rewards.history[0]?.atClaim).toMatchObject({
      usd: "663.04",
      tokens: [{ price: "0.25", day: recentDay, source: "coingecko" }],
    })
    const claimRow = documents.activity.rows[0]
    expect(claimRow?.type === "claim" && claimRow.atClaim?.usd).toBe("663.04")

    // The recent claim's day is not checked yet: pending, not $0.
    const unsettled = build({
      ...priced,
      claimPrices: {
        daily: new Map([
          [`mezo:${staleDay}`, { usd: "0.184", source: "coingecko" }],
        ]),
        coverage: {
          btc: null,
          mezo: { from: "2025-12-03", through: staleDay },
        },
      },
    })
    expect(unsettled.rewards.earned).toMatchObject({
      usd: "488.00",
      whenClaimed: { unpriced: 1, pending: 1, settling: 1 },
    })
    expect(unsettled.rewards.history[0]?.atClaim).toBeUndefined()
    expect(unsettled.earnedBasis).not.toBe(documents.earnedBasis)

    // Inside the settling days it carries an estimate, at the sample
    // nearest before it, which Earned leaves out: Earned never drops
    // when the day settles lower.
    const sampled = build({
      ...priced,
      historicPrice: (token, at) =>
        token === "mezo" && at === now - 7_200 ? "0.2" : null,
      claimPrices: {
        daily: new Map([
          [`mezo:${staleDay}`, { usd: "0.184", source: "coingecko" }],
        ]),
        coverage: {
          btc: null,
          mezo: { from: "2025-12-03", through: staleDay },
        },
      },
    })
    expect(sampled.rewards.earned).toMatchObject({
      usd: "488.00",
      whenClaimed: { pending: 1 },
    })
    const estimate = {
      usd: "530.43",
      tokens: [{ token: mezo, price: "0.2", usd: "530.43" }],
      finalOn: addDays(recentDay, 3),
    }
    expect(sampled.rewards.history[0]?.estimate).toEqual(estimate)
    const settling = sampled.activity.rows[0]
    expect(settling?.type === "claim" && settling.estimate).toEqual(estimate)
    // Once valued, the estimate goes.
    expect(documents.rewards.history[0]?.estimate).toBeUndefined()

    // Prices unknown this run: every claim pending (the snapshot carries
    // the previous Earned instead).
    expect(build(context).rewards.earned).toMatchObject({
      usd: "0.00",
      whenClaimed: { unpriced: 0, pending: 2, settling: 1 },
    })

    // A claim weeks old with no price yet (a day not checked, a leftover
    // estimate on a stored row) is pending but not settling: the line
    // under Earned never calls it recent.
    const older = build({
      ...priced,
      claimPrices: {
        daily: new Map(),
        coverage: {
          btc: null,
          mezo: { from: "2025-12-03", through: addDays(staleDay, -1) },
        },
      },
    })
    expect(older.rewards.earned.whenClaimed).toEqual({
      unpriced: 0,
      pending: 2,
      settling: 1,
    })
  })
})

describe("protocol", () => {
  it("totals incentives per epoch and voter, and lists funded gauges", () => {
    const protocol = buildProtocol(context, protocolRows, null)
    const parsed = protocolSchema.parse(protocol)
    // Every epoch from Epoch 0 (Thu 11 Dec 2025) to the current one (47).
    expect(parsed.incentivesByEpoch).toHaveLength(48)
    expect(parsed.incentivesByEpoch[0]?.epoch.number).toBe(0)
    expect(parsed.incentivesByEpoch.at(-1)?.epoch.number).toBe(47)
    expect(
      parsed.incentivesByEpoch.slice(-3).map((bar) => bar.totalUsd),
    ).toEqual(["0.00", "100.00", "1180.00"])
    expect(parsed.incentivesByEpoch.at(-2)?.poolsUsd).toBe("100.00")
    expect(parsed.incentives).toEqual({
      usd: "1180.00",
      previousUsd: "100.00",
      changeUsd: "1080.00",
    })
    expect(parsed.funded.gauges[0]).toMatchObject({
      gauge: { name: "Kiln Labs" },
      deposits: 3,
    })
    expect(parsed.stats).toMatchObject({
      vemezoLocked: "282900000",
      vemezoLockers: 1356,
      vebtcLocked: "1404.32",
      vebtcLockedUsd: "148450667.20",
      vebtcVoteWeight: "1099.72",
      vebtcVotes: 38,
    })
  })

  it("keeps more of the feed than the protocol document, in the same order", () => {
    // 230 votes, each its own transaction, newest first.
    const rows = {
      ...protocolRows,
      feed: Array.from({ length: 230 }, (_, index) =>
        event({
          tx_hash: `0x${index.toString(16).padStart(64, "0")}`,
          timestamp: String(now - 60 * (index + 1)),
          weight: "1000000000000000000",
        }),
      ),
    }
    const protocol = buildProtocol(context, rows, null)
    const activity = protocolActivitySchema.parse(
      buildProtocolActivity(context, rows),
    )
    expect(protocol.feed.rows).toHaveLength(20)
    expect(activity.rows).toHaveLength(protocolActivityRows)
    // The page paints with the protocol document's rows and continues
    // from the last of them, so they have to be the head of this list.
    expect(activity.rows.slice(0, protocol.feed.rows.length)).toEqual(
      protocol.feed.rows,
    )
  })

  it("writes one document per epoch, keeping stats frozen at epoch end", () => {
    const frozen = { ...protocolRows, vebtcVotes: 12 }
    const earlier = buildProtocol(context, frozen, null).stats
    const { history, epochs } = buildProtocolHistory(
      context,
      protocolRows,
      null,
      new Map([[46, earlier]]),
    )
    protocolHistorySchema.parse(history)
    expect(epochs.map((epoch) => epoch.epoch.number)).toEqual(
      epochsSinceLaunch(now).map((_, index) => index),
    )
    for (const epoch of epochs) protocolEpochSchema.parse(epoch)
    expect(epochs.at(-1)?.stats?.vebtcVotes).toBe(38)
    expect(epochs.at(-2)?.stats?.vebtcVotes).toBe(12)
    expect(epochs.at(-3)?.stats).toBeNull()
    expect(epochs.at(-2)).toMatchObject({
      incentives: { usd: "100.00", previousUsd: "0.00", changeUsd: "100.00" },
      funded: { count: 1 },
      deposits: 1,
    })
    expect(history.epochs.at(-1)).toMatchObject({
      totalUsd: "1180.00",
      fundedGauges: 1,
      deposits: 3,
    })
  })
})

describe("sweep size", () => {
  it("shrinks after a slow run and grows after a fast one", () => {
    expect(nextSweepSize(200, sweepTiming.targetMs + 1, 300)).toBe(150)
    expect(nextSweepSize(30, 40_000, 300)).toBe(25)
    expect(nextSweepSize(150, sweepTiming.fastMs - 1, 300)).toBe(175)
    expect(nextSweepSize(290, 1_000, 300)).toBe(300)
    expect(nextSweepSize(150, 15_000, 300)).toBe(150)
  })
})

const protocolRows: ProtocolRows = {
  lockStats: [
    {
      contract_address: vemezo,
      lockers: 1356,
      amount: (282_900_000n * wad).toString(),
    },
    {
      contract_address: vebtc,
      lockers: 90,
      amount: ((140_432n * wad) / 100n).toString(),
    },
  ],
  vebtcVoteWeight: ((109_972n * wad) / 100n).toString(),
  vebtcVotes: 38,
  deposits: [
    {
      epoch_start: String(epochStart),
      voter_source: "BOOST_VOTER",
      gauge: kiln,
      token: mezo,
      amount: ((641_304n * wad) / 100n).toString(),
      deposits: 3,
    },
    {
      epoch_start: String(epochStart - 604_800),
      voter_source: "POOLS_VOTER",
      gauge: sats,
      token: "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
      amount: (100n * wad).toString(),
      deposits: 1,
    },
  ],
  feed: [],
  feedTotal: 0,
}

describe("gauge history", () => {
  it("builds every epoch per gauge, carrying votes forward, and counts funding", () => {
    const { histories, funding } = buildGaugeHistories(
      context,
      [
        {
          gauge: kiln,
          source: "BOOST_VOTER",
          epoch_start: String(epochStart - 2 * 604_800),
          weight: (5_000_000n * wad).toString(),
        },
        {
          gauge: kiln,
          source: "BOOST_VOTER",
          epoch_start: String(epochStart),
          weight: (5_880_000n * wad).toString(),
        },
      ],
      protocolRows.deposits,
    )
    const kilnHistory = histories.find((history) => history.address === kiln)
    expect(kilnHistory?.votesUnit).toBe("veMEZO")
    expect(kilnHistory?.epochs.map((epoch) => epoch.votes)).toEqual([
      "5000000",
      "5000000",
      "5880000",
    ])
    expect(kilnHistory?.epochs.at(-1)?.incentives.tokens[0]?.amount).toBe(
      "6413.04",
    )
    for (const history of histories) gaugeHistorySchema.parse(history)
    const satsHistory = histories.find((history) => history.address === sats)
    expect(satsHistory?.votesUnit).toBe("veBTC")
    // Sats was funded last epoch (finished); Kiln only this one (not yet).
    expect(gaugeFundingSchema.parse(funding).gauges).toEqual({
      [sats]: { recent: 1, total: 1, streak: 1 },
    })
    expect(funding.throughEpoch).toBe(46)
  })
})

describe("chain-corrected locks", () => {
  const lock = (tokenId: string, amount: string): LockRow => ({
    contract_address: "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279",
    token_id: tokenId,
    owner: "0xc9442775a305d8d428dcb8f9029d34bc121c2a67",
    amount,
    unlock_at: "0",
    is_permanent: false,
    created_at: null,
  })

  it("takes the chain's amount and drops locks the chain says are empty", () => {
    // veBTC #1048: the warehouse saw only later deposits (0.0071 BTC).
    const corrected = correctLocks(
      [
        lock("1048", "7120366742651627"),
        lock("5871", "13500000000000000"),
        lock("9", "5"),
      ],
      new Map([
        [
          "vebtc:1048",
          { amount: 5_014_200_000_000_000_000n, end: 0n, isPermanent: true },
        ],
        ["vebtc:5871", { amount: 0n, end: 0n, isPermanent: false }],
      ]),
    )
    expect(
      corrected.map((row) => [row.token_id, row.amount, row.is_permanent]),
    ).toEqual([
      ["1048", "5014200000000000000", true],
      ["9", "5", false],
    ])
  })

  it("reports locked totals from escrow supply over the warehouse sum", () => {
    const stats = buildProtocol(
      {
        ...context,
        escrowSupply: {
          vebtc: 804_300_245_524_626_339_279n,
          vemezo: 282_928_843_502_055_892_242_558_692n,
        },
      },
      protocolRows,
      null,
    ).stats
    expect(stats.vebtcLocked).toBe("804.300245524626339279")
    expect(stats.vemezoLocked).toBe("282928843.502055892242558692")
  })
})

describe("what a run logs about itself", () => {
  it("times each call by method and changes nothing about it", async () => {
    let now = 0
    const spent: [number, string][] = []
    const reader = {
      label: "warehouse",
      async locksOf(wallets: string[]) {
        now += 40
        return wallets.length
      },
      head() {
        now += 3
        return 13_181_373
      },
      async broken(): Promise<never> {
        now += 7
        throw new Error("connection reset")
      },
    }
    const timed = timedCalls(
      reader,
      () => now,
      (ms, method) => {
        spent.push([ms, method])
      },
    )
    expect(await timed.locksOf(["a", "b"])).toBe(2)
    expect(timed.head()).toBe(13_181_373)
    // A failure is timed too, and still fails.
    await expect(timed.broken()).rejects.toThrow("connection reset")
    expect(timed.label).toBe("warehouse")
    expect(spent).toEqual([
      [40, "locksOf"],
      [3, "head"],
      [7, "broken"],
    ])
  })

  it("counts the documents written by kind", () => {
    expect(
      countByKind([
        { kind: "wallet-overview" },
        { kind: "gauge-history" },
        { kind: "gauge-history" },
        { kind: "protocol-epoch" },
      ]),
    ).toEqual({ "wallet-overview": 1, "gauge-history": 2, "protocol-epoch": 1 })
    expect(countByKind([])).toEqual({})
  })
})
