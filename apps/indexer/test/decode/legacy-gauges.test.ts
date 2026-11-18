import { readFileSync } from "node:fs"
import { VOTING_REWARD_EVENTS_ABI as rewardAbi } from "@matchbox/chain"
import { type Address, decodeEventLog, type Hex, parseAbiItem } from "viem"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { enumerationProblems } from "../../scripts/legacy-gauges-complete"
import { CORE_START_BLOCK, resolveHandler } from "../../src/decode/dispatch"
import {
  LEGACY_POOL_REWARDS,
  type LegacyPoolReward,
  WAREHOUSE_LEGACY_POOL_REWARDS,
} from "../../src/decode/handlers/rewards"
import { projectBlock } from "../../src/decode/projection"
import { InMemoryStore } from "../../src/decode/store"
import { networkConfig } from "../../src/ingest/networks"
import type { RawLog } from "../../src/ingest/rpc"
import { logEntry } from "./entries"

// The decoder skips PoolsVoter.GaugeCreated before the explorer's start block,
// so a pool gauge created before it is decoded only if the legacy tables in
// handlers/rewards.ts map its reward contracts. The explorer's own table
// missed the sMUSD gauge, and its incentives were never recorded. These
// tests check the tables against every GaugeCreated before that block, from
// a fixture recorded on chain by scripts/record-legacy-gauges.ts (re-run it
// to refresh; no test calls RPC).

const POOL_GAUGE_CREATED = parseAbiItem(
  "event GaugeCreated(address indexed poolFactory, address indexed votingRewardsFactory, address indexed gaugeFactory, address pool, address bribeVotingReward, address feeVotingReward, address gauge, address creator)",
)
const VOTER_GAUGE_CREATED = parseAbiItem(
  "event GaugeCreated(address indexed gauge, address indexed bribeVotingReward, address indexed creator)",
)

const hexSchema = z.custom<Hex>(
  (value) => typeof value === "string" && /^0x[0-9a-f]*$/i.test(value),
)

const fixture = z
  .object({
    fromBlock: z.string().transform(BigInt),
    toBlock: z.string().transform(BigInt),
    voters: z.record(z.string(), z.string()),
    deployBlocks: z.record(z.string(), z.string().transform(BigInt)),
    logs: z.array(
      z.object({
        address: z.string(),
        blockNumber: z.string().transform(BigInt),
        txHash: hexSchema,
        logIndex: z.number().int(),
        topics: z.array(hexSchema),
        data: hexSchema,
      }),
    ),
  })
  .parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../fixtures/legacy-gauges/gauge-created.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  )

const POOLS_VOTER = fixture.voters.PoolsVoter

function rawLog(entry: (typeof fixture.logs)[number]): RawLog {
  return {
    network: "mezo",
    blockNumber: entry.blockNumber,
    blockHash: `0x${"ab".repeat(32)}`,
    blockTimestamp: 1_765_000_000n,
    txHash: entry.txHash.toLowerCase() as Hex,
    txIndex: 0,
    logIndex: entry.logIndex,
    address: entry.address as Address,
    topics: entry.topics.map((topic) => topic.toLowerCase() as Hex),
    data: entry.data,
  }
}

type PoolGauge = {
  block: bigint
  pool: Address
  gauge: Address
  bribe: Address
  fees: Address
}

const poolGauges: PoolGauge[] = fixture.logs
  .filter((entry) => entry.address === POOLS_VOTER)
  .map((entry) => {
    const { args } = decodeEventLog({
      abi: [POOL_GAUGE_CREATED],
      topics: entry.topics as [Hex, ...Hex[]],
      data: entry.data,
    })
    return {
      block: entry.blockNumber,
      pool: args.pool.toLowerCase() as Address,
      gauge: args.gauge.toLowerCase() as Address,
      bribe: args.bribeVotingReward.toLowerCase() as Address,
      fees: args.feeVotingReward.toLowerCase() as Address,
    }
  })

const TABLES: ReadonlyArray<LegacyPoolReward> = [
  ...LEGACY_POOL_REWARDS,
  ...WAREHOUSE_LEGACY_POOL_REWARDS,
]

describe("the recorded GaugeCreated fixture", () => {
  it("covers every block before the start, from before any voter existed", () => {
    expect(fixture.fromBlock).toBe(networkConfig("mezo").startBlock)
    expect(fixture.toBlock).toBe(CORE_START_BLOCK - 1n)
    for (const deployed of Object.values(fixture.deployBlocks)) {
      expect(deployed).toBeGreaterThanOrEqual(fixture.fromBlock)
    }
  })

  it("holds the 10 pool gauges and 55 voter gauges recorded on 11 Nov 2026", () => {
    expect(poolGauges).toHaveLength(10)
    expect(fixture.logs).toHaveLength(65)
  })

  it("matches each voter's length() at the last block, read independently of eth_getLogs", () => {
    // eth_call length() at block 7,739,499 on 11 Nov 2026; the recorder
    // reads these again and refuses to write a fixture that disagrees.
    const input = {
      voters: fixture.voters as Record<string, Address>,
      deployBlocks: fixture.deployBlocks,
      lengths: {
        PoolsVoter: 10n,
        BoostVoter: 33n,
        ThirdPartyVoter: 1n,
        ValidatorsVoter: 21n,
      },
      fromBlock: fixture.fromBlock,
      toBlock: fixture.toBlock,
      logs: fixture.logs,
    }
    expect(enumerationProblems(input)).toEqual([])

    // One gauge missing from what eth_getLogs returned is caught.
    const missing = fixture.logs.findIndex((log) => log.address === POOLS_VOTER)
    expect(
      enumerationProblems({
        ...input,
        logs: fixture.logs.filter((_, index) => index !== missing),
      }),
    ).toEqual([
      "PoolsVoter.length() is 10 at block 7739499, but 9 GaugeCreated logs were recorded",
    ])
  })
})

describe("pool gauges created before the start block", () => {
  it("are skipped by the GaugeCreated handler, which is why the tables exist", () => {
    for (const entry of fixture.logs.filter(
      (log) => log.address === POOLS_VOTER,
    )) {
      expect(resolveHandler(rawLog(entry), new InMemoryStore())).toBe(undefined)
    }
  })

  it.each(poolGauges.map((gauge) => [gauge.gauge, gauge] as const))(
    "has both reward contracts of %s in a legacy table",
    (_, gauge) => {
      const bribe = TABLES.findIndex((entry) => entry[0] === gauge.bribe)
      const fees = TABLES.findIndex((entry) => entry[0] === gauge.fees)
      expect(TABLES[bribe]).toEqual([gauge.bribe, gauge.pool, gauge.gauge])
      expect(TABLES[fees]).toEqual([gauge.fees, gauge.pool, gauge.gauge])
      // dispatch.ts reads even entries as bribes and odd as fees, per table.
      const position = (address: Address) => {
        const own = LEGACY_POOL_REWARDS.some((entry) => entry[0] === address)
          ? LEGACY_POOL_REWARDS
          : WAREHOUSE_LEGACY_POOL_REWARDS
        return own.findIndex((entry) => entry[0] === address) % 2
      }
      expect(position(gauge.bribe)).toBe(0)
      expect(position(gauge.fees)).toBe(1)
    },
  )

  it.each(poolGauges.map((gauge) => [gauge.gauge, gauge] as const))(
    "decodes deposits on %s's contracts from its creation block",
    (_, gauge) => {
      for (const [address, rewardType] of [
        [gauge.bribe, "Bribe"],
        [gauge.fees, "Fee"],
      ] as const) {
        const store = new InMemoryStore()
        const handled = projectBlock(
          [
            logEntry(
              rewardAbi,
              "NotifyReward",
              {
                from: gauge.gauge,
                reward: gauge.pool,
                epoch: 1_765_411_200n,
                amount: 1n,
              },
              {
                address,
                block: gauge.block,
                timestamp: 1_765_411_201n,
              },
            ),
          ],
          store,
        )
        expect(handled, address).toBe(1)
        expect(store.rewardDeposits).toMatchObject([
          { rewardType, gauge: gauge.gauge, pool: gauge.pool },
        ])
      }
    },
  )

  it("lists no reward contract that no recorded gauge created", () => {
    const recorded = new Set(
      poolGauges.flatMap((gauge) => [gauge.bribe, gauge.fees]),
    )
    for (const [reward] of TABLES) expect(recorded).toContain(reward)
    expect(TABLES).toHaveLength(recorded.size)
  })
})

describe("other voters' gauges created before the start block", () => {
  const voterLogs = fixture.logs.filter((log) => log.address !== POOLS_VOTER)

  it("are 55, all with the 3-argument GaugeCreated", () => {
    expect(voterLogs).toHaveLength(55)
  })

  it("each register their bribe reward contract", () => {
    for (const entry of voterLogs) {
      const { args } = decodeEventLog({
        abi: [VOTER_GAUGE_CREATED],
        topics: entry.topics as [Hex, ...Hex[]],
        data: entry.data,
      })
      const store = new InMemoryStore()
      const log = rawLog(entry)
      const handled = projectBlock(
        [
          {
            log,
            tx: {
              network: "mezo",
              hash: log.txHash,
              blockNumber: log.blockNumber,
              txIndex: 0,
              from: args.creator.toLowerCase() as Address,
              to: log.address,
              input: "0x",
            },
          },
        ],
        store,
      )
      expect(handled, entry.txHash).toBe(1)
      expect(
        store.dataSources.get(args.bribeVotingReward.toLowerCase() as Address),
      ).toMatchObject({
        template: "VoterBribeReward",
        gauge: args.gauge.toLowerCase(),
      })
    }
  })
})
