import { CONTRACTS } from "@matchbox/chain"
import {
  walletOverviewSchema,
  walletRewardsSchema,
} from "@matchbox/contracts/read-models"
import { demoPrices } from "@matchbox/contracts/read-models/fixtures"
import { isSensitiveKey } from "@matchbox/logger"
import { describe, expect, it } from "vitest"
import { type BuildContext, buildWalletDocuments } from "./build"
import {
  type EarnedRequest,
  earnedKey,
  type VotedGauge,
  type WalletChainReader,
} from "./chain"
import type { LockRow, VoteRow } from "./reader"
import {
  earnedBudgetMs,
  maxEarnedRequests,
  readClaimable,
  withPoolGauges,
} from "./reward-sources"

const wad = 10n ** 18n
const now = 1_794_500_000
const wallet = "0xdc887b3d44bdf789d60d2d427d5e8db6e4ed6ad1"
const vebtc = CONTRACTS.mainnet.veBTC.toLowerCase()
const poolsVoter = CONTRACTS.mainnet.poolsVoter.toLowerCase()
const validatorsVoter = CONTRACTS.mainnet.validatorsVoter.toLowerCase()

// Lock #848 on 12 Nov 2026: it votes the sMUSD pool, whose gauge was made
// before the indexer's first block and whose fee contract no depositor ever
// paid into, and the ChooseMe validator gauge.
const pool = "0xb4d498029af77680cd1ef828b967f010d06c51cc"
const poolGauge = "0x677817bf3e44b90e8f95222f75e2950b7904a401"
const poolBribe = "0x7d98f38a020a94b08eec295bfb6f4e86d581e607"
const poolFees = "0x33b8b1162f0b86d68cad418d96246ee2c5164a01"
const validator = "0xde3593718dcf024daa1e76fcba80e5ce99cd0ea9"
const validatorBribe = "0xb000000000000000000000000000000000000d0e"
const musd = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
const btc = "0x7b7c000000000000000000000000000000000000"
const mezo = "0x7b7c000000000000000000000000000000000001"
const unknownToken = "0x00000000000000000000000000000000000000ee"

const feesEarned = 1_124_591_570_389_013_644_316n
const mezoEarned = 8_701n * wad

const sMusd = {
  address: poolGauge,
  voter: "pools" as const,
  kind: "pool" as const,
  name: "sMUSD",
  vebtcTokenId: null,
  picture: { type: "initials" as const, text: "SM" },
  poolType: null,
  color: "#3D8FA8",
  tickSpacing: null,
  coin: null,
}

const context: BuildContext = {
  nowSeconds: now,
  prices: demoPrices,
  gauges: new Map([[poolGauge, sMusd]]),
  cards: new Map(),
  historicPrice: () => null,
  claimPrices: null,
}

const lock: LockRow = {
  contract_address: vebtc,
  token_id: "848",
  owner: wallet,
  amount: (10n * wad).toString(),
  unlock_at: null,
  is_permanent: true,
  created_at: null,
}

const power = 50n * wad

/** The warehouse's rows: the pool vote names the pool, not its gauge. */
const warehouseVotes: VoteRow[] = [
  {
    voter_contract: poolsVoter,
    token_id: "848",
    gauge: pool,
    current_weight: power.toString(),
    last_updated_at: String(now - 86_400),
  },
  {
    voter_contract: validatorsVoter,
    token_id: "848",
    gauge: validator,
    current_weight: power.toString(),
    last_updated_at: String(now - 86_400),
  },
]

type Calls = {
  pools: string[][]
  gauges: VotedGauge[][]
  earned: EarnedRequest[][]
}

function chain(
  calls: Calls,
  overrides: Partial<WalletChainReader> = {},
): WalletChainReader {
  const earned = new Map([
    [
      earnedKey({ rewardContract: poolFees, token: musd, tokenId: "848" }),
      feesEarned,
    ],
    [
      earnedKey({
        rewardContract: validatorBribe,
        token: mezo,
        tokenId: "848",
      }),
      mezoEarned,
    ],
  ])
  return {
    async votingPower() {
      return new Map([["vebtc:848", power]])
    },
    async locked() {
      return new Map()
    },
    async poolGauges(pools) {
      calls.pools.push([...pools])
      return {
        gauges: new Map(pools.includes(pool) ? [[pool, poolGauge]] : []),
        failed: [],
      }
    },
    async rewardContracts(gauges) {
      calls.gauges.push([...gauges])
      return {
        contracts: gauges.flatMap(({ gauge }) =>
          gauge === poolGauge
            ? [
                { gauge, rewardContract: poolBribe },
                { gauge, rewardContract: poolFees },
              ]
            : gauge === validator
              ? [{ gauge, rewardContract: validatorBribe }]
              : [],
        ),
        failed: [],
      }
    },
    async rewardTokens() {
      return {
        tokens: new Map([
          [poolBribe, [musd, btc]],
          [poolFees, [musd]],
          [validatorBribe, [mezo, unknownToken]],
        ]),
        failed: [],
        truncated: [],
      }
    },
    async earned(requests) {
      calls.earned.push([...requests])
      return {
        earned: new Map(
          requests.flatMap((request) => {
            const amount = earned.get(earnedKey(request))
            return amount === undefined
              ? []
              : [[earnedKey(request), amount] as const]
          }),
        ),
        failed: [],
      }
    },
    diagnostics() {
      return { rejectedRequests: 0, lostRequests: 0, errors: [] }
    },
    async head() {
      return 13_182_500
    },
    ...overrides,
  }
}

const noCalls = (): Calls => ({ pools: [], gauges: [], earned: [] })

describe("claimable from the chain", () => {
  it("shows a pool gauge's fees to a lock that votes the pool, with no deposit row", async () => {
    const calls = noCalls()
    const reader = chain(calls)
    const claimable = await readClaimable(reader, warehouseVotes)
    const documents = buildWalletDocuments(
      context,
      {
        wallet,
        locks: [lock],
        votes: claimable.votes,
        events: [],
        rewardSources: claimable.sources,
        votingPower: await reader.votingPower([]),
        earned: claimable.earned,
      },
      new Map(),
    )
    const overview = walletOverviewSchema.parse(documents.overview)
    const rewards = walletRewardsSchema.parse(documents.rewards)
    const [built] = overview.locks
    if (built === undefined) throw new Error("no lock")

    // The vote is on the gauge, by name, not on a bare pool address.
    if (built.vote.status !== "voted") throw new Error("not voted")
    expect(
      built.vote.allocations.map((allocation) => allocation.gauge.address),
    ).toEqual(expect.arrayContaining([poolGauge, validator]))
    expect(
      built.vote.allocations.find(
        (allocation) => allocation.gauge.address === poolGauge,
      )?.gauge.name,
    ).toBe("sMUSD")

    // 1,124.59 MUSD of pool fees and 8,701 MEZO from the validator gauge.
    expect(
      built.claimable.tokens.map((entry) => [entry.token.symbol, entry.amount]),
    ).toEqual(
      expect.arrayContaining([
        ["MUSD", "1124.591570389013644316"],
        ["MEZO", "8701"],
      ]),
    )
    expect(built.claimable.tokens).toHaveLength(2)
    expect(overview.claimable.tokens).toHaveLength(2)

    // Rewards names the gauge the fees come from, so Claim can ask
    // PoolsVoter for its bribe and fee contracts (claimBribes, claimFees).
    const byLock = rewards.byLock.find((entry) => entry.lock.tokenId === "848")
    expect(
      byLock?.gauges.map((gauge) => [gauge.gauge.address, gauge.gauge.voter]),
    ).toEqual(
      expect.arrayContaining([
        [poolGauge, "pools"],
        [validator, "validators"],
      ]),
    )
  })

  it("was blind to them from the warehouse's rows alone (before 12 Nov 2026)", async () => {
    // The old inputs: the vote as the warehouse has it, and reward
    // contracts from reward_deposits, which has no row for the pool.
    const documents = buildWalletDocuments(
      context,
      {
        wallet,
        locks: [lock],
        votes: warehouseVotes,
        events: [],
        rewardSources: [],
        votingPower: new Map([["vebtc:848", power]]),
        earned: new Map([
          [
            earnedKey({
              rewardContract: poolFees,
              token: musd,
              tokenId: "848",
            }),
            feesEarned,
          ],
        ]),
      },
      new Map(),
    )
    const [built] = walletOverviewSchema.parse(documents.overview).locks
    expect(built?.claimable.tokens).toEqual([])
    if (built?.vote.status !== "voted") throw new Error("not voted")
    expect(
      built.vote.allocations.map((allocation) => allocation.gauge.address),
    ).toContain(pool)
  })

  it("asks the chain for the pool's gauge and each gauge's own reward contracts", async () => {
    const calls = noCalls()
    const claimable = await readClaimable(chain(calls), warehouseVotes)
    expect(calls.pools).toEqual([[pool]])
    expect(calls.gauges).toEqual([
      [
        { gauge: poolGauge, voter: "pools" },
        { gauge: validator, voter: "validators" },
      ],
    ])
    // One call per lock, reward contract and token that contract pays.
    expect(calls.earned).toHaveLength(1)
    expect(calls.earned[0]?.map(earnedKey).sort()).toEqual(
      [
        { rewardContract: poolBribe, token: musd },
        { rewardContract: poolBribe, token: btc },
        { rewardContract: poolFees, token: musd },
        { rewardContract: validatorBribe, token: mezo },
        { rewardContract: validatorBribe, token: unknownToken },
      ]
        .map((request) => earnedKey({ ...request, tokenId: "848" }))
        .sort(),
    )
    expect(claimable.dropped).toBe(0)
  })

  it("marks the lock unread when a read fails, never as having less to claim", async () => {
    const every = {
      poolGauges: 0,
      rewardContracts: 0,
      rewardLists: 0,
      earned: 0,
    }
    const clean = await readClaimable(chain(noCalls()), warehouseVotes)
    expect(clean.unread.size).toBe(0)
    expect(clean.failures).toEqual(every)

    // gaugeToFees for the pool gauge was in a lost request, twice.
    const lostContracts = await readClaimable(
      chain(noCalls(), {
        async rewardContracts(gauges) {
          return {
            contracts: gauges.flatMap(({ gauge }) =>
              gauge === validator
                ? [{ gauge, rewardContract: validatorBribe }]
                : [],
            ),
            failed: [poolGauge],
          }
        },
      }),
      warehouseVotes,
    )
    // The validator's MEZO was read; the pool's fees were not. Writing
    // that would show $34 where $1,158 is claimable.
    expect(lostContracts.earned.size).toBe(1)
    expect([...lostContracts.unread]).toEqual(["848"])
    expect(lostContracts.failures).toEqual({ ...every, rewardContracts: 1 })

    const lostPool = await readClaimable(
      chain(noCalls(), {
        async poolGauges() {
          return { gauges: new Map(), failed: [pool] }
        },
      }),
      warehouseVotes,
    )
    expect([...lostPool.unread]).toEqual(["848"])
    expect(lostPool.failures).toEqual({ ...every, poolGauges: 1 })

    const lostTokens = await readClaimable(
      chain(noCalls(), {
        async rewardTokens() {
          return {
            tokens: new Map([
              [poolBribe, [musd, btc]],
              [validatorBribe, [mezo]],
            ]),
            failed: [poolFees],
            truncated: [],
          }
        },
      }),
      warehouseVotes,
    )
    expect([...lostTokens.unread]).toEqual(["848"])
    expect(lostTokens.failures).toEqual({ ...every, rewardLists: 1 })

    const lostEarned = await readClaimable(
      chain(noCalls(), {
        async earned(requests) {
          return { earned: new Map(), failed: [...requests].slice(0, 1) }
        },
      }),
      warehouseVotes,
    )
    expect([...lostEarned.unread]).toEqual(["848"])
    expect(lostEarned.failures).toEqual({ ...every, earned: 1 })
  })

  it("reports its counts under keys the logger does not redact", async () => {
    // The first run logged "rewardTokens":"[redacted]": a key ending in
    // "token" reads as a credential (12 Nov 2026).
    const claimable = await readClaimable(chain(noCalls()), warehouseVotes)
    for (const key of [
      ...Object.keys(claimable.failures),
      // The other fields of the snapshot's three warnings.
      "walletsSkipped",
      "dropped",
      "wallets",
      "contracts",
    ]) {
      expect(isSensitiveKey(key), key).toBe(false)
    }
  })

  it("leaves a vote alone when PoolsVoter has no gauge for its address", () => {
    const [poolVote, validatorVote] = warehouseVotes
    if (poolVote === undefined || validatorVote === undefined) {
      throw new Error("fixture")
    }
    // Already a gauge address, or a pool whose gauge was killed.
    expect(withPoolGauges([poolVote], new Map())).toEqual([poolVote])
    // Only PoolsVoter votes are keyed by pool.
    expect(
      withPoolGauges([validatorVote], new Map([[validator, poolGauge]])),
    ).toEqual([validatorVote])
    expect(withPoolGauges([poolVote], new Map([[pool, poolGauge]]))).toEqual([
      { ...poolVote, gauge: poolGauge },
    ])
  })

  it("reads no chain at all for wallets that do not vote", async () => {
    const calls = noCalls()
    const claimable = await readClaimable(chain(calls), [])
    expect(calls.pools).toEqual([])
    expect(calls.earned).toEqual([])
    expect(claimable.earned.size).toBe(0)
  })

  it("caps the earned calls of a run, keeping the wallets ranked first", async () => {
    const calls = noCalls()
    // Each lock makes 5 calls: 400 locks ask for 2,000.
    const votes = Array.from({ length: 400 }, (_, index) =>
      warehouseVotes.map((vote) => ({ ...vote, token_id: `${index + 1}` })),
    ).flat()
    const claimable = await readClaimable(chain(calls), votes, {
      // The highest ids are the wallets a run needs first.
      rank: (tokenId) => -Number(tokenId),
    })
    const asked = calls.earned.flat()
    expect(asked).toHaveLength(maxEarnedRequests)
    expect(claimable.asked).toBe(maxEarnedRequests)
    expect(claimable.dropped).toBe(2_000 - maxEarnedRequests)
    expect(asked.some((request) => request.tokenId === "400")).toBe(true)
    expect(asked.some((request) => request.tokenId === "1")).toBe(false)
    // The locks left out are unread, not empty.
    expect(claimable.unread.has("1")).toBe(true)
    expect(claimable.unread.has("400")).toBe(false)
  })

  it("reads the wallets someone is waiting for first, gently, before the rest", async () => {
    const paces: (string | undefined)[] = []
    const order: string[][] = []
    const reader = chain(noCalls(), {
      async earned(requests, options) {
        paces.push(
          options?.pace === undefined
            ? undefined
            : `${options.pace.perRequest}x${options.pace.inFlight}`,
        )
        order.push([...new Set(requests.map((request) => request.tokenId))])
        expect(options?.deadline).toBe(1_000 + earnedBudgetMs)
        return { earned: new Map(), failed: [] }
      },
    })
    const votes = ["1", "2", "3", "848"].flatMap((id) =>
      warehouseVotes.map((vote) => ({ ...vote, token_id: id })),
    )
    await readClaimable(reader, votes, {
      // #848's wallet is ranked last by the sweep, but someone is waiting.
      rank: (tokenId) => (tokenId === "848" ? 99 : Number(tokenId)),
      waiting: (tokenId) => tokenId === "848",
      now: () => 1_000,
    })
    // One request at a time for the waiting wallet, then the bulk.
    expect(paces).toEqual(["10x1", undefined])
    expect(order).toEqual([["848"], ["1", "2", "3"]])
  })

  it("puts a waiting wallet ahead of the cap", async () => {
    const calls = noCalls()
    const votes = Array.from({ length: 400 }, (_, index) =>
      warehouseVotes.map((vote) => ({ ...vote, token_id: `${index + 1}` })),
    ).flat()
    const claimable = await readClaimable(chain(calls), votes, {
      rank: (tokenId) => Number(tokenId),
      // Ranked last of 400, past the cap, but waiting.
      waiting: (tokenId) => tokenId === "400",
    })
    expect(claimable.unread.has("400")).toBe(false)
    expect(calls.earned[0]?.every((request) => request.tokenId === "400")).toBe(
      true,
    )
  })
})
