import path from "node:path"
import { z } from "zod"
import {
  earnPoolsDaySchema,
  earnPoolsPoints,
  earnPoolsUrl,
} from "../../src/scan/earn-pools"
import { dayOf } from "../../src/scan/transform"
import {
  bump,
  dailyStatements,
  daysSchema,
  jsonRpc,
  logger,
  nowSeconds,
  Pacer,
  parseCommon,
  pointsOf,
  StateFile,
  writeSqlFiles,
} from "./lib"

// (c) History from Mezo's public Goldsky subgraphs (project
// project_cm6ks2x8um4aj01uj8nwg1f6r, 50 requests per 10 seconds shared with
// Mezo's own dapp). At most one request a second. They prune old state, so
// everything is replayed from events in time order, never read at an old
// block. A partial run is still correct for every day it finished: only
// days before the last row's day are written.
//
//   pnpm --filter @matchbox/jobs exec tsx scripts/scan-backfill/subgraphs.ts \
//     --series dex|fees|musd|btc|bridge-in|bridge-out \
//     [--max-requests N] [--write] [--fresh]
//
// - dex: earn-pools-mezo/v1 daily aggregations, basic and CL pools:
//   dex.volume_in and dex.fees per pool:token (the metrics the Worker
//   writes each day after).
// - fees: earn-locks-mezo/v2 DistributedRewards. veBTC rows are the chain
//   fees passed to veBTC holders (fees.chain_vebtc); veMEZO rows the MEZO
//   rebase (emissions.rebase_distributed).
// - musd: wormhole-token-bridge-mezo/v1, every MUSD Transfer, and btc:
//   btc-as-erc20-mezo/v1, every BTC Transfer, replayed: token.transfers,
//   token.transfer_volume, token.minted, token.burned and
//   token.holders_replayed (addresses with a positive balance at day end).
//   Replayed supply is not published: token.total_supply comes from
//   totalSupply() (archive-reads); --verify checks the replay against it at
//   the last fully read block (every 25 pages and at the end) and stops on
//   a mismatch.
//   BTC is Mezo's native gas token: gas, native sends and precompile moves
//   emit no Transfer, so a Transfer replay cannot give BTC's holders,
//   supply or transfers. `--series btc` therefore publishes nothing; it
//   remains only to measure (BTC's series are token.total_supply from
//   archive-reads and token.holders from Blockscout).
// - bridge-in: mezo-bridge-mainnet/v1 (Ethereum) AssetsLocked, bridge.in per
//   Ethereum token; bridge-out: mezo-bridge-out-mezo/v1 AssetsUnlocked,
//   bridge.out per token and destination (ethereum, bitcoin). Neither
//   contract emits a fee, so there is no bridge fee series.

const goldsky =
  "https://api.goldsky.com/api/public/project_cm6ks2x8um4aj01uj8nwg1f6r/subgraphs"
const { values, common } = parseCommon({
  series: { type: "string" },
  verify: { type: "boolean" },
  rpc: { type: "string" },
})
const verify = values.verify === true
const rpc = values.rpc ?? "https://rpc-internal.mezo.org"
const series = z
  .enum(["dex", "fees", "musd", "btc", "bridge-in", "bridge-out"])
  .parse(values.series)

const zero = "0x0000000000000000000000000000000000000000"
const vebtc = "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279"
const pageSize = 1000
const integer = z.string().regex(/^[0-9]+$/)

const stateSchema = z.object({
  /** Time-order keyset: last row's timestamp (seconds, or micros) and id. */
  after: z.string(),
  afterId: z.string(),
  complete: z.boolean(),
  requests: z.number().int(),
  rows: z.number().int(),
  days: daysSchema,
  /** Transfer replay: balances, supply, and the day being accumulated. */
  balances: z.record(z.string(), z.string()),
  supply: z.string(),
  openDay: z.string().nullable(),
  /** The block being replayed, and supply at the end of the one before. */
  openBlock: z.number().int().nullable().default(null),
  closedBlock: z.number().int().nullable().default(null),
  closedSupply: z.string().default("0"),
  pages: z.number().int().default(0),
})

type State = z.infer<typeof stateSchema>

const store = new StateFile<State>(
  path.join(common.out, `subgraph-${series}`),
  stateSchema,
  () => ({
    after: "0",
    afterId: "",
    complete: false,
    requests: 0,
    rows: 0,
    days: {},
    balances: {},
    supply: "0",
    openDay: null,
    openBlock: null,
    closedBlock: null,
    closedSupply: "0",
    pages: 0,
  }),
)
const state = store.load(common.fresh)
const pacer = new Pacer(1_100)

async function graphql<Schema extends z.ZodType>(
  url: string,
  query: string,
  schema: Schema,
): Promise<z.output<Schema>> {
  const response = await pacer.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  })
  if (!response.ok) throw new Error(`Goldsky answered ${response.status}`)
  const body = z
    .object({ data: z.unknown().optional(), errors: z.unknown().optional() })
    .parse(await response.json())
  if (body.errors !== undefined) {
    throw new Error(
      `Goldsky errors: ${JSON.stringify(body.errors).slice(0, 300)}`,
    )
  }
  return schema.parse(body.data)
}

type Row = { id: string; time: string }

/**
 * The next page in (time, id) order: rows at or after the cursor's time,
 * minus those at that exact time already seen (graph-node breaks ties by
 * id).
 */
async function nextPage<Item extends Row>(
  fetchPage: (after: string) => Promise<Item[]>,
): Promise<Item[]> {
  const page = await fetchPage(state.after)
  const fresh = page.filter(
    (row) =>
      BigInt(row.time) > BigInt(state.after) ||
      (row.time === state.after && row.id > state.afterId),
  )
  if (page.length === pageSize && fresh.length === 0) {
    throw new Error(`More than ${pageSize} rows share time ${state.after}`)
  }
  const last = fresh.at(-1)
  if (last !== undefined) {
    state.after = last.time
    state.afterId = last.id
  }
  state.rows += fresh.length
  state.complete = page.length < pageSize
  return fresh
}

function secondsOf(time: string, micros: boolean): number {
  return Number.parseInt(micros ? time.slice(0, -6) || "0" : time, 10)
}

// ---- transfers (musd, btc) ---------------------------------------------

function move(address: string, delta: bigint) {
  if (address === zero) return
  const next = BigInt(state.balances[address] ?? "0") + delta
  if (next === 0n) delete state.balances[address]
  else state.balances[address] = next.toString()
}

/** Sets a day's level (a level is overwritten, never added up). */
function setLevel(
  day: string,
  metric: string,
  dimension: string,
  value: bigint,
) {
  const bucket = state.days[day] ?? {}
  state.days[day] = bucket
  bucket[`${metric}|${dimension}`] = value.toString()
}

/** Holders at a day's end: addresses with a positive replayed balance. */
function closeDay(day: string, token: string) {
  let holders = 0n
  for (const balance of Object.values(state.balances)) {
    if (BigInt(balance) > 0n) holders += 1n
  }
  setLevel(day, "token.holders_replayed", token, holders)
}

async function transfers(name: string, token: string) {
  const rows = await nextPage(async (after) => {
    const data = await graphql(
      `${goldsky}/${name}/v1/gn`,
      `{ transfers(first: ${pageSize}, orderBy: timestamp_, orderDirection: asc,
          where: { timestamp__gte: "${after}" }) {
          id from to value timestamp_ block_number } }`,
      z.object({
        transfers: z.array(
          z.object({
            id: z.string(),
            from: z.string(),
            to: z.string(),
            value: integer,
            timestamp_: integer,
            block_number: integer,
          }),
        ),
      }),
    )
    return data.transfers.map((row) => ({ ...row, time: row.timestamp_ }))
  })
  for (const row of rows) {
    const block = Number.parseInt(row.block_number, 10)
    // Supply as of the end of the previous block, for --verify.
    if (state.openBlock !== null && block > state.openBlock) {
      state.closedBlock = state.openBlock
      state.closedSupply = state.supply
    }
    state.openBlock = block
    const day = dayOf(secondsOf(row.time, false))
    if (state.openDay !== null && day !== state.openDay) {
      closeDay(state.openDay, token)
    }
    state.openDay = day
    const value = BigInt(row.value)
    const from = row.from.toLowerCase()
    const to = row.to.toLowerCase()
    bump(state.days, day, "token.transfers", token, 1n)
    bump(state.days, day, "token.transfer_volume", token, value)
    if (from === zero) {
      bump(state.days, day, "token.minted", token, value)
      state.supply = (BigInt(state.supply) + value).toString()
    }
    if (to === zero) {
      bump(state.days, day, "token.burned", token, value)
      state.supply = (BigInt(state.supply) - value).toString()
    }
    move(from, -value)
    move(to, value)
  }
  // The open day is closed (and published) only once a later day starts,
  // so a day still being read is never written as finished.
}

/**
 * --verify: the replayed supply at the end of the last fully read block
 * must equal totalSupply() there, read from an archive RPC. A mismatch
 * stops the run: the replay (or its start) is wrong and nothing it
 * produced should be published.
 */
async function verifySupply(token: string) {
  if (state.closedBlock === null) return
  const result = await jsonRpc(
    pacer,
    rpc,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [
        { to: token, data: "0x18160ddd" },
        `0x${state.closedBlock.toString(16)}`,
      ],
    },
    z.object({ result: z.string().regex(/^0x[0-9a-fA-F]+$/) }),
  )
  const onChain = BigInt(result.result)
  const replayed = BigInt(state.closedSupply)
  if (onChain !== replayed) {
    throw new Error(
      `SUPPLY MISMATCH for ${token} at block ${state.closedBlock}: replayed ${replayed}, totalSupply ${onChain}`,
    )
  }
  logger.info({
    message: "Replayed supply matches totalSupply()",
    address: token,
    block: state.closedBlock,
    supply: onChain.toString(),
  })
}

// ---- timeseries (dex, fees) and bridges -------------------------------

async function dex() {
  const after = state.after
  const filter = `interval: day, first: ${pageSize}, orderBy: timestamp, orderDirection: asc, where: { timestamp_gt: "${after}" }`
  const pool = "pool { id token0 { id } token1 { id } }"
  const data = await graphql(
    earnPoolsUrl,
    `{
      poolVolumes(${filter}) { timestamp ${pool} totalVolume0 totalVolume1 }
      feesStats_collection(${filter}) { timestamp ${pool} totalFees0 totalFees1 }
      clpoolVolumes(${filter}) { timestamp ${pool} totalVolume0 totalVolume1 }
      clfeeStats_collection(${filter}) { timestamp ${pool} totalFees0 totalFees1 }
    }`,
    earnPoolsDaySchema.shape.data,
  )
  // A full collection may end mid-day: keep only days before the earliest
  // last timestamp of a full one, and resume from there.
  const lists = Object.values(data)
  const full = lists.filter((list) => list.length === pageSize)
  const limit =
    full.length === 0
      ? null
      : full
          .map((list) => BigInt(list.at(-1)?.timestamp ?? "0"))
          .reduce((a, b) => (a < b ? a : b))
  function keep(row: { timestamp: string }) {
    return limit === null || BigInt(row.timestamp) < limit
  }
  const trimmed = {
    poolVolumes: data.poolVolumes.filter(keep),
    feesStats_collection: data.feesStats_collection.filter(keep),
    clpoolVolumes: data.clpoolVolumes.filter(keep),
    clfeeStats_collection: data.clfeeStats_collection.filter(keep),
  }
  for (const [seconds, points] of earnPoolsPoints({ data: trimmed })) {
    for (const point of points) {
      bump(
        state.days,
        dayOf(seconds),
        point.metric,
        point.dimension,
        point.value,
      )
    }
  }
  state.rows += Object.values(trimmed).reduce((n, list) => n + list.length, 0)
  const newest = Object.values(trimmed)
    .flat()
    .map((row) => BigInt(row.timestamp))
    .reduce((a, b) => (a > b ? a : b), BigInt(after))
  state.after = limit === null ? newest.toString() : (limit - 1n).toString()
  state.complete = limit === null
}

async function fees() {
  const rows = await nextPage(async (after) => {
    const data = await graphql(
      `${goldsky}/earn-locks-mezo/v2/gn`,
      `{ distributedRewards_collection(first: ${pageSize}, orderBy: timestamp, orderDirection: asc, where: { timestamp_gte: "${after}" }) { id timestamp amount token } }`,
      z.object({
        distributedRewards_collection: z.array(
          z.object({
            id: z.string(),
            timestamp: integer,
            amount: integer,
            token: z.string(),
          }),
        ),
      }),
    )
    return data.distributedRewards_collection.map((row) => ({
      ...row,
      time: row.timestamp,
    }))
  })
  for (const row of rows) {
    const metric =
      row.token.toLowerCase() === vebtc
        ? "fees.chain_vebtc"
        : "emissions.rebase_distributed"
    bump(
      state.days,
      dayOf(secondsOf(row.time, true)),
      metric,
      "",
      BigInt(row.amount),
    )
  }
}

async function bridge(inbound: boolean) {
  const entity = inbound ? "assetsLockeds" : "assetsUnlockeds"
  const name = inbound ? "mezo-bridge-mainnet" : "mezo-bridge-out-mezo"
  const rows = await nextPage(async (after) => {
    const data = await graphql(
      `${goldsky}/${name}/v1/gn`,
      `{ ${entity}(first: ${pageSize}, orderBy: timestamp_, orderDirection: asc, where: { timestamp__gte: "${after}" }) { id amount token timestamp_ ${inbound ? "" : "chain"} } }`,
      z.record(
        z.string(),
        z.array(
          z.object({
            id: z.string(),
            amount: integer,
            token: z.string(),
            timestamp_: integer,
            chain: z.string().optional(),
          }),
        ),
      ),
    )
    return (data[entity] ?? []).map((row) => ({ ...row, time: row.timestamp_ }))
  })
  for (const row of rows) {
    const day = dayOf(secondsOf(row.time, false))
    const token = row.token.toLowerCase()
    const dimension = inbound
      ? token
      : `${token}:${row.chain === "1" ? "bitcoin" : "ethereum"}`
    const metric = inbound ? "bridge.in" : "bridge.out"
    bump(state.days, day, metric, dimension, BigInt(row.amount))
    bump(state.days, day, `${metric}_count`, dimension, 1n)
  }
}

const tokens = {
  musd: [
    "wormhole-token-bridge-mezo",
    "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
  ],
  btc: ["btc-as-erc20-mezo", "0x7b7c000000000000000000000000000000000000"],
} as const

const started = Date.now()
while (!state.complete && pacer.requests < common.maxRequests) {
  switch (series) {
    case "dex":
      await dex()
      break
    case "fees":
      await fees()
      break
    case "musd":
    case "btc":
      await transfers(tokens[series][0], tokens[series][1])
      state.pages += 1
      if (verify && (state.pages % 25 === 0 || state.complete)) {
        await verifySupply(tokens[series][1])
      }
      break
    case "bridge-in":
    case "bridge-out":
      await bridge(series === "bridge-in")
      break
  }
  state.requests += 1
  store.save(state)
}

// Finished days: those before the day of the newest row read (that day may
// continue on the next page), and never past the day the subgraph is still
// indexing (a complete read of a lagging subgraph is not a finished day).
const micros = series === "dex" || series === "fees"
const subgraphName: Record<typeof series, string> = {
  dex: "earn-pools-mezo/v1",
  fees: "earn-locks-mezo/v2",
  musd: "wormhole-token-bridge-mezo/v1",
  btc: "btc-as-erc20-mezo/v1",
  "bridge-in": "mezo-bridge-mainnet/v1",
  "bridge-out": "mezo-bridge-out-mezo/v1",
}
const meta = await graphql(
  `${goldsky}/${subgraphName[series]}/gn`,
  "{ _meta { block { timestamp } } }",
  z.object({ _meta: z.object({ block: z.object({ timestamp: z.number() }) }) }),
)
const indexedDay = dayOf(meta._meta.block.timestamp)
const readDay = state.complete
  ? dayOf(nowSeconds())
  : dayOf(secondsOf(state.after, micros))
const frontier = readDay < indexedDay ? readDay : indexedDay
const output = Object.fromEntries(
  Object.entries(state.days).filter(([day]) => day < frontier),
)
const days = Object.keys(output).sort()
const elapsed = (Date.now() - started) / 1000
const spanDays =
  days.length === 0
    ? 0
    : (Date.parse(frontier) - Date.parse(days[0] ?? frontier)) / 86_400_000
logger.info({
  message: state.complete ? "Series complete" : "Stopped at the request budget",
  series,
  requests: pacer.requests,
  totalRequests: state.requests,
  rows: state.rows,
  finishedDays: days.length,
  firstDay: days[0] ?? null,
  frontier,
  elapsedSeconds: Math.round(elapsed),
  rowsPerDayRead: spanDays > 0 ? Math.round(state.rows / spanDays) : null,
  sample: days.slice(-2).map((day) => ({ day, ...output[day] })),
})
if (common.write && series === "btc") {
  logger.warn({
    message:
      "BTC is the native gas token: a Transfer replay cannot give its holders, supply or transfers; nothing written",
  })
} else if (common.write) {
  const files = writeSqlFiles(
    path.join(common.out, `subgraph-${series}`),
    "daily",
    dailyStatements(
      pointsOf(output),
      `backfill:subgraph-${series}`,
      nowSeconds(),
    ),
  )
  logger.info({ message: "SQL written", files })
}
