import path from "node:path"
import { mezoMainnet } from "@matchbox/api/chain/client"
import {
  createMarketReader,
  createViemMarketClient,
  type MarketClient,
} from "@matchbox/api/market/reader"
import {
  buildSnapshot,
  type EpochSnapshot,
} from "@matchbox/api/market/snapshot"
import { epochStartOf } from "@matchbox/domain"
import { createPublicClient, custom, type PublicClient } from "viem"
import { base } from "viem/chains"
import { z } from "zod"
import { dayStart } from "../../src/scan/transform"
import {
  epochCloseBound,
  epochStarts,
  epochStatements,
  gaugeFingerprint,
} from "./gauge-rows"
import {
  blockTimestamp,
  lastBlockBefore,
  logger,
  nowSeconds,
  Pacer,
  parseCommon,
  rpcCall,
  StateFile,
  selectRemote,
  writeSqlFiles,
} from "./lib"
import {
  baseBlockBefore,
  btcUsdAt,
  mezoUsdAt,
  referencePricesOf,
} from "./prices-at"

// (h) Past epochs of every Mezo gauge in MARKET_DB (market_epochs and
// market_gauges), the store behind listGaugeHistory: Matchbox Pro's gauge
// profile asks for 12 epochs of votes and incentives, and the market cron
// only keeps the epochs it has run through (two in matchbox-api-market-v2,
// four in matchbox-api-market on 12 Nov 2026). Each finished epoch is read
// as the cron's last run with it as the current epoch read it: the market
// cron's own reader (createMarketReader, all four voters, every gauge's
// weight and reward slots) at the last block at or before 23:55:00 UTC of
// the epoch's last day, turned into rows by its own buildSnapshot, with
// the reference prices of that moment (prices-at.ts: the Skip oracle on
// Mezo, the Aerodrome pool on Base, which only exists from 14 Apr 2026, so
// earlier epochs have weights and amounts but no MEZO price, USD or APR,
// as the live cron would have stored without a MEZO price).
//
// This reads archive state rather than the warehouse's votes and deposits:
// the stored rows are chain reads (weights(gauge), tokenRewardsPerEpoch),
// and reading the same calls at the epoch's closing block reproduces them
// exactly, where a warehouse replay would only approximate them.
//
//   pnpm --filter @matchbox/jobs exec tsx scripts/scan-backfill/gauge-epochs.ts \
//     [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--mezo-rpc <url>] [--base-rpc <url>] \
//     [--compare matchbox-api-market-v2] [--max-requests N] [--write] [--fresh]
//
// --from and --to pick the epochs that start in that range (default: from
// 12 Feb 2026, the first epoch the reader can read, to the last finished
// one: 39 epochs on 12 Nov 2026, about 100 requests and 13 s each). The SQL inserts into an
// epoch only while MARKET_DB has no header row for it, and only absent
// rows (gauge-rows.ts): an epoch the live cron wrote is never touched.

const { values, common } = parseCommon({
  from: { type: "string" },
  to: { type: "string" },
  "mezo-rpc": { type: "string" },
  "base-rpc": { type: "string" },
  compare: { type: "string" },
})
const mezoRpc = values["mezo-rpc"] ?? "https://rpc-internal.mezo.org"
const baseRpc = values["base-rpc"] ?? "https://mainnet.base.org"
const day = z.iso.date()
const current = epochStartOf(nowSeconds())
const lastFinished = current - 7 * 86_400
/**
 * The first epoch the cron's reader can read: at earlier blocks every
 * Mezo RPC (rpc-internal, ValidationCloud, Boar) answers the
 * ValidatorPool precompile's validator(operator) with "Missing or invalid
 * parameters", which fails the read (25 Dec 2025 to 5 Feb 2026), and
 * before December 2025 the voters are not all deployed.
 */
const firstReadable = "2026-02-12"
const first = epochStartOf(
  dayStart(day.parse(values.from ?? firstReadable)) + 6 * 86_400,
)
const last = Math.min(
  lastFinished,
  values.to === undefined
    ? lastFinished
    : epochStartOf(dayStart(day.parse(values.to))),
)
const wanted = epochStarts(first, last)

const pacer = new Pacer(150)

const stateSchema = z.object({
  /** {epochStart: buildSnapshot's epoch, and why a price is missing} */
  epochs: z.record(
    z.string(),
    z.object({
      // Written by this script from buildSnapshot's own output.
      snapshot: z.custom<EpochSnapshot>(
        (value) => typeof value === "object" && value !== null,
      ),
      unpriced: z.record(z.string(), z.string()),
    }),
  ),
  failed: z.record(z.string(), z.string()),
})
type State = z.infer<typeof stateSchema>

const store = new StateFile<State>(
  path.join(common.out, "gauge-epochs"),
  stateSchema,
  () => ({ epochs: {}, failed: {} }),
)
const state = store.load(common.fresh)

function pacedClient(url: string, chain: typeof mezoMainnet | typeof base) {
  return createPublicClient({
    chain,
    transport: custom({
      request: ({ method, params }) =>
        rpcCall(pacer, url, method, Array.isArray(params) ? params : []),
    }),
    batch: { multicall: { batchSize: 1024 * 16, wait: 0 } },
  }) as PublicClient
}
const mezo = pacedClient(mezoRpc, mezoMainnet)
const baseClient = pacedClient(baseRpc, base)
const mezoTs = (block: number) => blockTimestamp(pacer, mezoRpc, block)
const baseTs = (block: number) => blockTimestamp(pacer, baseRpc, block)

// The cron's own Multicall3 client (three requests in flight, as live),
// counted against the request budget.
const viemMarket = createViemMarketClient("mezo", mezoRpc)
const marketClient: MarketClient = {
  blockNumber: () => viemMarket.blockNumber(),
  multicall(calls, blockNumber) {
    pacer.requests += 1
    return viemMarket.multicall(calls, blockNumber)
  },
}
const reader = createMarketReader("mezo", marketClient)

const headBlock = Number(await mezo.getBlockNumber())
const headTs = await mezoTs(headBlock)
const baseHead = Number(await baseClient.getBlockNumber())
const baseHeadTs = await baseTs(baseHead)
const started = Date.now()

async function readEpoch(epochStart: number): Promise<void> {
  const key = String(epochStart)
  try {
    const bound = epochCloseBound(epochStart)
    const block = await lastBlockBefore(mezoTs, bound, {
      low: 1,
      lowTs: await mezoTs(1),
      high: headBlock,
      highTs: headTs,
    })
    const blockTs = await mezoTs(block)
    const baseBlock = await baseBlockBefore(
      baseTs,
      { block: baseHead, timestamp: baseHeadTs },
      bound,
    )
    const [btc, mezoPrice] = await Promise.all([
      btcUsdAt(mezo, BigInt(block), blockTs),
      mezoUsdAt(baseClient, BigInt(baseBlock)),
    ])
    // A failed price read is retried; a refused or not-yet-existing source
    // is stored as no price, as the cron stores a null price.
    for (const [token, result] of [
      ["btc", btc],
      ["mezo", mezoPrice],
    ] as const) {
      // Before 14 Apr 2026 the Base pool has no code: slot0 returns no data.
      const beforePool =
        token === "mezo" && /returned no data/.test(result.reason ?? "")
      if (result.price === null && !result.rejected && !beforePool) {
        throw new Error(`${token} price: ${result.reason}`)
      }
    }
    const read = await reader.read({
      blockNumber: BigInt(block),
      epochStarts: [epochStart],
      knownBoostTokens: new Map(),
    })
    const snapshot = buildSnapshot(
      read,
      referencePricesOf(btc, mezoPrice),
      new Date(blockTs * 1000),
    )
    const epoch = snapshot.epochs[0]
    if (epoch === undefined) throw new Error("No epoch in the snapshot")
    const unpriced: Record<string, string> = {}
    if (btc.price === null) unpriced.btc = btc.reason
    if (mezoPrice.price === null) unpriced.mezo = mezoPrice.reason
    state.epochs[key] = { snapshot: epoch, unpriced }
    delete state.failed[key]
  } catch (error) {
    state.failed[key] = String(error).slice(0, 200)
  }
}

for (const epochStart of wanted) {
  if (pacer.requests >= common.maxRequests) break
  if (state.epochs[String(epochStart)] !== undefined) continue
  await readEpoch(epochStart)
  store.save(state)
}

const done = wanted.filter((start) => state.epochs[String(start)] !== undefined)
const label = (start: number) =>
  new Date(start * 1000).toISOString().slice(0, 10)
/** {epochStart: {gauge: fingerprint}} for the report and comparison. */
const fingerprints = new Map<number, Map<string, string>>(
  done.map((start) => [
    start,
    new Map(
      (state.epochs[String(start)]?.snapshot.gauges ?? []).map((row) => [
        row.gauge.gaugeAddress,
        gaugeFingerprint(row.incentives),
      ]),
    ),
  ]),
)
logger.info({
  message:
    done.length === wanted.length
      ? "Gauge epochs complete"
      : "Stopped at the request budget or on failures",
  epochs: wanted.length,
  read: done.length,
  firstEpoch: done[0] === undefined ? null : label(done[0]),
  lastEpoch: done.at(-1) === undefined ? null : label(done.at(-1) ?? 0),
  rows: done.reduce(
    (sum, start) => sum + (fingerprints.get(start)?.size ?? 0),
    0,
  ),
  requests: pacer.requests,
  elapsedSeconds: Math.round((Date.now() - started) / 1000),
  failed: state.failed,
})
for (const start of done) {
  const entry = state.epochs[String(start)]
  if (entry === undefined) continue
  const prints = [...(fingerprints.get(start)?.values() ?? [])]
  logger.info({
    message: "Epoch",
    epoch: label(start),
    block: entry.snapshot.epoch.blockNumber,
    asOf: entry.snapshot.epoch.asOf,
    rows: prints.length,
    withVotes: prints.filter((value) => !/^weight=(0|null) /.test(value))
      .length,
    withRewards: prints.filter((value) => !value.endsWith("rewards=[]")).length,
    btcUsd: entry.snapshot.epoch.prices.btcUsd?.usd ?? null,
    mezoUsd: entry.snapshot.epoch.prices.mezoUsd?.usd ?? null,
    unpriced: entry.unpriced,
  })
}
if (values.compare !== undefined) {
  // Per epoch: rows the store holds, rows the SQL would insert (none for
  // an epoch the store has), and gauges whose weight or rewards differ.
  const present = selectRemote(
    values.compare,
    `SELECT epoch_start, gauge_address, json_extract(incentives, '$.weight') AS weight, json_extract(incentives, '$.rewards') AS rewards FROM market_gauges WHERE network = 'mezo' AND epoch_start < ${current}`,
    z.object({
      epoch_start: z.number(),
      gauge_address: z.string(),
      weight: z.string().nullable(),
      rewards: z.string(),
    }),
  )
  const headers = new Set(
    selectRemote(
      values.compare,
      "SELECT epoch_start FROM market_epochs WHERE network = 'mezo'",
      z.object({ epoch_start: z.number() }),
    ).map((row) => row.epoch_start),
  )
  const rewardsSchema = z.array(
    z.object({ token: z.string(), amount: z.string() }),
  )
  const stored = new Map<number, Map<string, string>>()
  for (const row of present) {
    const bucket = stored.get(row.epoch_start) ?? new Map<string, string>()
    bucket.set(
      row.gauge_address,
      gaugeFingerprint({
        weight: row.weight,
        rewards: rewardsSchema.parse(JSON.parse(row.rewards)),
      }),
    )
    stored.set(row.epoch_start, bucket)
  }
  for (const start of done) {
    const ours = fingerprints.get(start) ?? new Map<string, string>()
    const theirs = stored.get(start) ?? new Map<string, string>()
    const differences: { gauge: string; backfill: string; stored: string }[] =
      []
    let overlap = 0
    let equal = 0
    for (const [gauge, value] of ours) {
      const kept = theirs.get(gauge)
      if (kept === undefined) continue
      overlap += 1
      if (kept === value) equal += 1
      else if (differences.length < 5) {
        differences.push({ gauge, backfill: value, stored: kept })
      }
    }
    logger.info({
      message: "Compared with the stored epoch",
      database: values.compare,
      epoch: label(start),
      storedHeader: headers.has(start),
      storedRows: theirs.size,
      wouldInsert: headers.has(start) ? 0 : ours.size - theirs.size,
      overlap,
      equal,
      differences,
    })
  }
}
if (common.write) {
  if (Object.keys(state.failed).length > 0) {
    throw new Error("Epochs failed; run again to retry them before --write")
  }
  const statements = []
  for (const start of done) {
    const entry = state.epochs[String(start)]
    if (entry !== undefined) {
      statements.push(...(await epochStatements(entry.snapshot)))
    }
  }
  const files = writeSqlFiles(
    path.join(common.out, "gauge-epochs"),
    "gauge-epochs",
    statements,
  )
  logger.info({ message: "SQL written", files })
}
