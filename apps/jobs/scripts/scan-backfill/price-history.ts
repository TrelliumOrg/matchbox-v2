import path from "node:path"
import { mezoMainnet } from "@matchbox/api/chain/client"
import { createPublicClient, custom, type PublicClient } from "viem"
import { base } from "viem/chains"
import { z } from "zod"
import { priceDailySpec } from "../../src/scan/closing"
import { servedBatch, upsertStatements } from "../../src/scan/statements"
import { dayOf, nextDay } from "../../src/scan/transform"
import {
  blockTimestamp,
  compareWithPresent,
  lastBlockBefore,
  logger,
  nowSeconds,
  Pacer,
  parseCommon,
  rpcCall,
  StateFile,
  selectRemote,
  summarizeDays,
  writeSqlFiles,
} from "./lib"
import {
  missingPrices,
  priceCloseBound,
  priceHistorySource,
  priceRowsOf,
} from "./price-rows"
import { baseBlockBefore, btcUsdAt, mezoUsdAt } from "./prices-at"

// (g) Daily closing prices of BTC and MEZO (price_daily), which the live
// price job only started writing on 11 Nov 2026. The live job writes the
// day's close at 23:59 and again at 00:00 UTC with the newest price
// (runPriceClose), so a day's close is the price at the head at 00:00:00
// of the next day: the last Mezo block at or before it for BTC (the Skip
// BTC/USD oracle, latestRoundData), and the last Base block at or before
// it for MEZO (the Aerodrome MEZO/MUSD pool's slot0), with the live
// reader's own checks (prices-at.ts). A price that cannot be read is left
// out with its reason; nothing is interpolated.
//
//   pnpm --filter @matchbox/jobs exec tsx scripts/scan-backfill/price-history.ts \
//     [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--mezo-rpc <url>] [--base-rpc <url>] \
//     [--compare matchbox-scan] [--max-requests N] [--write] [--fresh]
//
// The SQL only inserts rows that are absent (source backfill:price-history):
// a day the live job already closed is left alone, and applying the file
// twice changes nothing. It bumps scan_status.data_version when it inserted
// a row. The Base RPC must serve archive state (mainnet.base.org does).

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
const today = dayOf(nowSeconds())
const from = day.parse(values.from ?? "2025-05-19")
const to = day.parse(values.to ?? dayOf(nowSeconds() - 86_400))

const pacer = new Pacer(150)

const stateSchema = z.object({
  next: z.string(),
  /** {day: {"btc"|"mezo": usd decimal}} */
  days: z.record(z.string(), z.record(z.string(), z.string())),
  /** {day: {"btc"|"mezo": why there is no price}}, for the report. */
  unavailable: z.record(z.string(), z.record(z.string(), z.string())),
  /** Mezo and Base closing blocks per day, for checking. */
  blocks: z.record(
    z.string(),
    z.object({ mezo: z.number(), base: z.number() }),
  ),
  /** Days whose reads failed; retried first on the next run. */
  failed: z.record(z.string(), z.string()),
  low: z.number().int(),
  lowTs: z.number().int(),
})
type State = z.infer<typeof stateSchema>

const store = new StateFile<State>(
  path.join(common.out, "price-history"),
  stateSchema,
  () => ({
    next: from,
    days: {},
    unavailable: {},
    blocks: {},
    failed: {},
    low: 1,
    lowTs: 0,
  }),
)
const state = store.load(common.fresh)
for (const dayKey of Object.keys(state.failed)) {
  if (dayKey < from || dayKey > to) delete state.failed[dayKey]
}

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

const headBlock = Number(await mezo.getBlockNumber())
const headTs = await mezoTs(headBlock)
const baseHead = Number(await baseClient.getBlockNumber())
const baseHeadTs = await baseTs(baseHead)
if (state.lowTs === 0) state.lowTs = await mezoTs(state.low)
const started = Date.now()

/** Reads one day; true when it was stored. */
async function readDay(dayKey: string): Promise<boolean> {
  try {
    const bound = priceCloseBound(dayKey)
    const bounds =
      state.lowTs < bound
        ? { low: state.low, lowTs: state.lowTs }
        : { low: 1, lowTs: await mezoTs(1) }
    const block = await lastBlockBefore(mezoTs, bound, {
      ...bounds,
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
    const prices: Record<string, string> = {}
    const reasons: Record<string, string> = {}
    if (btc.price === null) reasons.btc = btc.reason
    else prices.btc = btc.price.usd
    if (mezoPrice.price === null) reasons.mezo = mezoPrice.reason
    else prices.mezo = mezoPrice.price.usd
    // A refused answer (stale round, no liquidity) is no price that day,
    // as live; a failed read of a source that answered before is retried.
    const refused = new Set<string>()
    if (btc.rejected) refused.add("btc")
    if (mezoPrice.rejected) refused.add("mezo")
    const missing = missingPrices(
      Object.entries(state.days)
        .filter(([earlier]) => earlier < dayKey)
        .map(([, bucket]) => bucket),
      prices,
    ).filter((token) => !refused.has(token))
    if (missing.length > 0) {
      throw new Error(
        missing.map((token) => `${token}: ${reasons[token]}`).join("; "),
      )
    }
    state.days[dayKey] = prices
    if (Object.keys(reasons).length > 0) state.unavailable[dayKey] = reasons
    else delete state.unavailable[dayKey]
    state.blocks[dayKey] = { mezo: block, base: baseBlock }
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

const daysDone = Object.keys(state.days).sort()
const unavailableDays = Object.keys(state.unavailable).sort()
logger.info({
  message:
    state.next > to || state.next >= today
      ? "Price history complete"
      : "Stopped at the request budget",
  days: daysDone.length,
  first: daysDone[0] ?? null,
  last: daysDone.at(-1) ?? null,
  requests: pacer.requests,
  elapsedSeconds: Math.round((Date.now() - started) / 1000),
  failed: state.failed,
  unavailableDays: unavailableDays.length,
  firstUnavailable: unavailableDays
    .slice(0, 1)
    .map((key) => ({ day: key, ...state.unavailable[key] })),
  lastUnavailable: unavailableDays
    .slice(-1)
    .map((key) => ({ day: key, ...state.unavailable[key] })),
  sample: daysDone.slice(-1).map((key) => ({
    day: key,
    mezoBlock: state.blocks[key]?.mezo,
    baseBlock: state.blocks[key]?.base,
    ...state.days[key],
  })),
})
for (const summary of summarizeDays(state.days)) {
  logger.info({ message: "Series", ...summary })
}
if (values.compare !== undefined) {
  const present = selectRemote(
    values.compare,
    "SELECT token, day, price, source FROM price_daily",
    z.object({
      token: z.string(),
      day: z.string(),
      price: z.string(),
      source: z.string(),
    }),
  ).map((row) => ({
    series: row.token,
    day: row.day,
    value: row.price,
    source: row.source,
  }))
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
  const files = writeSqlFiles(
    path.join(common.out, "price-history"),
    "price-history",
    servedBatch(
      upsertStatements(
        { ...priceDailySpec, update: [] },
        priceRowsOf(state.days, priceHistorySource, nowSeconds()),
      ),
    ),
    Number.MAX_SAFE_INTEGER,
  )
  logger.info({ message: "SQL written", files })
}
