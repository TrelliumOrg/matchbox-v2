import path from "node:path"
import { mezoMainnet } from "@matchbox/api/chain/client"
import { MORPHO_BLUE_DEPLOY_BLOCK } from "@matchbox/chain"
import { createPublicClient, custom, type PublicClient } from "viem"
import { z } from "zod"
import { discoverMorphoAccounts } from "../../src/live/morpho"
import { createLiveChainReader } from "../../src/live/snapshot"
import { createClosingChainReader } from "../../src/scan/closing"
import { dayOf, nextDay } from "../../src/scan/transform"
import {
  accountsAt,
  closeBound,
  historyMetrics,
  historyStatements,
  marketIdsOf,
  missingSupplies,
  readClosePoints,
} from "./closes"
import {
  blockTimestamp,
  compareWithPresent,
  lastBlockBefore,
  logger,
  nowSeconds,
  Pacer,
  parseCommon,
  presentDailyRows,
  rpcCall,
  StateFile,
  summarizeDays,
  writeSqlFiles,
} from "./lib"

// (f) Daily closes of the closing writer's series, from Mezo archive
// state, which only started on 11 Nov 2026:
// - escrow.supply: veBTC and veMEZO supply();
// - musd.trove_debt and musd.trove_coll: every trove's
//   getEntireDebtAndColl, summed; musd.stability_pool:
//   getTotalMUSDDeposits();
// - morpho.total_supply and morpho.total_borrow: market(id) per market;
//   morpho.total_collateral: position(id, account).collateral summed over
//   the accounts the live snapshot knows (every Supply, Borrow and
//   SupplyCollateral onBehalf);
// - token.total_supply: totalSupply() of the closing writer's 8 tokens.
// Each day is read at the head block of the day's last closing run (23:55
// UTC), with the live snapshot's and the closing writer's own readers and
// arithmetic (closes.ts). Morpho markets and accounts come from one log
// scan, as the live snapshot's discovery finds them (one getLogs per
// 10,000 blocks, once).
//
//   pnpm --filter @matchbox/jobs exec tsx scripts/scan-backfill/daily-history.ts \
//     [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--mezo-rpc <url>] \
//     [--compare matchbox-scan] [--max-requests N] [--write] [--fresh]
//
// --compare reads the rows the database already holds for these metrics
// (one SELECT through wrangler, read only) and prints, per series, how
// many days the SQL would insert and whether the overlapping days agree.
// State written before token.total_supply and the account scan were added
// is refused: run once with --fresh.
//
// The SQL only inserts rows that are absent (source backfill:daily-history,
// partial 0): a day any writer already has is left alone, and applying the
// file twice changes nothing. It bumps scan_status.data_version when it
// inserted a row, as the live writers do.

const { values, common } = parseCommon({
  from: { type: "string" },
  to: { type: "string" },
  "mezo-rpc": { type: "string" },
  compare: { type: "string" },
})
const mezoRpc = values["mezo-rpc"] ?? "https://rpc-internal.mezo.org"
const day = z.iso.date()
const today = dayOf(nowSeconds())
// Multicall3, which the live readers use, is on Mezo from this day.
const from = day.parse(values.from ?? "2025-05-19")
const to = day.parse(values.to ?? dayOf(nowSeconds() - 86_400))

const pacer = new Pacer(150)

const stateSchema = z.object({
  version: z.literal(2),
  next: z.string(),
  /** {day: {"metric|dimension": raw value}} */
  days: z.record(z.string(), z.record(z.string(), z.string())),
  /** Closing block per day, for checking. */
  blocks: z.record(z.string(), z.number().int()),
  /** Days whose reads failed; retried first on the next run. */
  failed: z.record(z.string(), z.string()),
  /** Market ids from CreateMarket logs. */
  markets: z.array(z.string()),
  /** Morpho account → start block of the log window it was first seen in. */
  accounts: z.record(z.string(), z.number().int()),
  /** Last block the Morpho log scan has read. */
  scannedTo: z.string(),
  low: z.number().int(),
  lowTs: z.number().int(),
})
type State = z.infer<typeof stateSchema>

const store = new StateFile<State>(
  path.join(common.out, "daily-history"),
  stateSchema,
  () => ({
    version: 2 as const,
    next: from,
    days: {},
    blocks: {},
    failed: {},
    markets: [],
    accounts: {},
    scannedTo: (MORPHO_BLUE_DEPLOY_BLOCK - 1n).toString(),
    low: 1,
    lowTs: 0,
  }),
)
const state = (() => {
  try {
    return store.load(common.fresh)
  } catch (error) {
    throw new Error(
      `${store.file} is from an earlier version of this script: run with --fresh (${String(error).slice(0, 120)})`,
    )
  }
})()
// Failed days outside --from and --to are given up: before Multicall3 was
// deployed on Mezo (early May 2025) the live readers cannot read at all.
for (const dayKey of Object.keys(state.failed)) {
  if (dayKey < from || dayKey > to) delete state.failed[dayKey]
}

// A viem client whose every request goes through the Pacer, with the live
// client's Multicall3 batching (createMezoClient).
const client = createPublicClient({
  chain: mezoMainnet,
  transport: custom({
    request: ({ method, params }) =>
      rpcCall(pacer, mezoRpc, method, Array.isArray(params) ? params : []),
  }),
  batch: { multicall: { batchSize: 1024 * 16, wait: 0 } },
}) as PublicClient
const reader = {
  ...createLiveChainReader(client, logger.child({ task: "reads" })),
  totalSupply: createClosingChainReader(client).totalSupply,
}
const timestampOf = (block: number) => blockTimestamp(pacer, mezoRpc, block)

const headBlock = Number(await client.getBlockNumber())
const headTs = await timestampOf(headBlock)
if (state.lowTs === 0) state.lowTs = await timestampOf(state.low)
const started = Date.now()

// Markets and accounts: one log scan up to the head, a window at a time so
// each account's first window is known, saved every 50 windows.
while (
  BigInt(state.scannedTo) < BigInt(headBlock) &&
  pacer.requests < common.maxRequests
) {
  for (
    let index = 0;
    index < 50 && BigInt(state.scannedTo) < BigInt(headBlock);
    index += 1
  ) {
    const start = BigInt(state.scannedTo) + 1n
    const scan = await discoverMorphoAccounts(
      client,
      start,
      BigInt(headBlock),
      1,
    )
    for (const account of scan.accounts) {
      state.accounts[account] ??= Number(start)
    }
    state.markets = [
      ...new Set([
        ...state.markets,
        ...scan.markets.map((market) => market.marketId.toLowerCase()),
      ]),
    ].sort()
    state.scannedTo = scan.scannedTo.toString()
  }
  store.save(state)
}
const marketsDone = BigInt(state.scannedTo) >= BigInt(headBlock)
const marketIds = marketIdsOf(state.markets)

/** Reads one day; true when its points were stored. */
async function readDay(dayKey: string): Promise<boolean> {
  try {
    const bound = closeBound(dayKey)
    // A retried day may lie below the running lower bound.
    const bounds =
      state.lowTs < bound
        ? { low: state.low, lowTs: state.lowTs }
        : { low: 1, lowTs: await timestampOf(1) }
    // An upper bound near the answer: blocks are at least 2 s apart, so
    // this candidate is usually past the bound (checked; else the head).
    // With the head as the bound the secant steps creep on old days.
    const candidate = Math.min(
      headBlock,
      bounds.low + Math.ceil((bound - bounds.lowTs) / 2) + 1,
    )
    const candidateTs = await timestampOf(candidate)
    const high =
      candidateTs >= bound
        ? { high: candidate, highTs: candidateTs }
        : { high: headBlock, highTs: headTs }
    const block = await lastBlockBefore(timestampOf, bound, {
      ...bounds,
      ...high,
    })
    const blockTs = await timestampOf(block)
    const points = await readClosePoints(
      reader,
      marketIds,
      accountsAt(state.accounts, block),
      block,
    )
    const missing = missingSupplies(
      Object.entries(state.days)
        .filter(([earlier]) => earlier < dayKey)
        .map(([, bucket]) => bucket),
      points,
    )
    if (missing.length > 0) {
      throw new Error(`totalSupply() failed for ${missing.join(", ")}`)
    }
    const bucket: Record<string, string> = {}
    for (const point of points) {
      bucket[`${point.metric}|${point.dimension}`] = point.value.toString()
    }
    state.days[dayKey] = bucket
    state.blocks[dayKey] = block
    if (blockTs > state.lowTs) {
      state.low = block
      state.lowTs = blockTs
    }
    delete state.failed[dayKey]
    return true
  } catch (error) {
    state.failed[dayKey] = String(error).slice(0, 200)
    return false
  }
}

if (marketsDone) {
  // Failed days first, once each.
  for (const dayKey of Object.keys(state.failed).sort()) {
    if (pacer.requests >= common.maxRequests) break
    await readDay(dayKey)
    store.save(state)
  }
  while (
    state.next <= to &&
    state.next < today &&
    pacer.requests < common.maxRequests
  ) {
    await readDay(state.next)
    state.next = nextDay(state.next)
    store.save(state)
  }
}

const daysDone = Object.keys(state.days).sort()
logger.info({
  message: !marketsDone
    ? "Stopped at the request budget while scanning Morpho logs"
    : state.next > to || state.next >= today
      ? "Daily history complete"
      : "Stopped at the request budget",
  metrics: historyMetrics,
  markets: marketIds,
  accounts: Object.keys(state.accounts).length,
  days: daysDone.length,
  first: daysDone[0] ?? null,
  last: daysDone.at(-1) ?? null,
  requests: pacer.requests,
  elapsedSeconds: Math.round((Date.now() - started) / 1000),
  failed: state.failed,
  sample: daysDone.slice(-1).map((key) => ({
    day: key,
    block: state.blocks[key],
    ...state.days[key],
  })),
})
for (const summary of summarizeDays(state.days)) {
  logger.info({ message: "Series", ...summary })
}
if (values.compare !== undefined) {
  const present = presentDailyRows(values.compare, historyMetrics)
  for (const comparison of compareWithPresent(state.days, present)) {
    logger.info({
      message: "Compared with present rows",
      database: values.compare,
      ...comparison,
    })
  }
}
if (common.write) {
  if (Object.keys(state.failed).length > 0) {
    throw new Error("Days failed; run again to retry them before --write")
  }
  const byDay = new Map(
    Object.entries(state.days).map(([dayKey, bucket]) => [
      dayKey,
      Object.entries(bucket).map(([key, value]) => {
        const [metric = "", dimension = ""] = key.split("|")
        return { metric, dimension, value: BigInt(value) }
      }),
    ]),
  )
  const statements = historyStatements(byDay, nowSeconds())
  // One file, so the data_version bump sees every insert of the file.
  const files = writeSqlFiles(
    path.join(common.out, "daily-history"),
    "daily-history",
    statements,
    Number.MAX_SAFE_INTEGER,
  )
  logger.info({ message: "SQL written", files })
}
