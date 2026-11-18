import {
  statsSchema,
  tokenCountersSchema,
  transactionsChartSchema,
} from "@matchbox/contracts/blockscout"
import type { Logger } from "@matchbox/logger"
import { z } from "zod"
import { type DailyPoint, dailyRows, dailySpec } from "./aggregates"
import type { FetchLike } from "./earn-pools"
import type { ApiBinding } from "./env"
import {
  cursorStatement,
  runBatch,
  type SqlStatement,
  servedBatch,
  upsertStatements,
} from "./statements"
import { readSubgraphDays, subgraphSources } from "./subgraph-daily"
import { dayOf, dayStart, nextDay, parseJson, poolSpec } from "./transform"

// Once-a-day series, from the existing 5-minute live trigger (no new
// cron). Each source has its own marker in scan_cursors, written in the
// same batch as its values and only when its reads succeeded, so a failed
// or lagging source is retried on a later run and never marked done:
//
// - counters (`daily:counters`): yesterday's closing Blockscout counters
//   (total transactions and addresses, holders and transfers per token),
//   through the API Worker's proxy over the API binding. Levels, read in
//   the first three hours of the UTC day only; a day whose read never
//   succeeds in that window has no value (it is not estimated).
// - chart (`daily:chart`): chain.transactions per day from Blockscout's
//   exact 30-day chart, re-read until it covers yesterday, rewriting any of
//   the 30 days that changed, so a missed run is filled on the next one.
// - subgraphs (`daily:dex`, `daily:fees`, `daily:bridge-in`,
//   `daily:bridge-out`): every day after the marker up to yesterday that
//   the subgraph has indexed to the end of (up to 14 a run).
// A source that failed is not retried for 30 minutes.

export const counterWindowHours = 3
/** Seconds before a failed source is tried again. */
export const retryAfterSeconds = 30 * 60
/** Subgraph days caught up per source per run. */
export const subgraphDaysPerRun = 14

/** Tokens whose holder and transfer counters are kept each day. */
export const counterTokens = [
  "0x7b7c000000000000000000000000000000000000", // BTC
  "0x7b7c000000000000000000000000000000000001", // MEZO
  "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186", // MUSD
  "0x04671c72aab5ac02a03c1098314b1bb6b560c197", // mUSDC
  "0xeb5a5d39de4ea42c2aa6a57eca2894376683bb8e", // mUSDT
  "0xa10ad2570ea7b93d19fdae6bd7189ff4929bc747", // mSolvBTC
  "0x6a7cd8e1384d49f502b4a4ce9ac9eb320835c5d7", // mcbBTC
  "0xe2232789d4cf5bb1ffada1a105cc59b18d639318", // mbhBTC
] as const

/** Blocks proposed per validator that day (a difference of two reads). */
export const proposedMetric = "chain.blocks_proposed"
/** Blockscout's cumulative validations_count at the read. */
export const proposedTotalMetric = "chain.blocks_proposed_total"
const validatorsMarker = "daily:validators"
/** JSON list of block miners seen in the daily read of recent blocks. */
const validatorsSeenCursor = "daily:validators:seen"
/** The day whose recent-blocks read was done (once a day). */
const validatorsDiscoveredCursor = "daily:validators:discovered"

const validatorCountersSchema = z.object({
  validations_count: z
    .union([z.string().regex(/^[0-9]+$/), z.number().int().nonnegative()])
    .nullable(),
})

const blocksSchema = z.object({
  items: z.array(
    z.object({
      height: z.number().int().nonnegative(),
      miner: z.object({ hash: z.string() }).nullable(),
      /** ISO time; absent from an older proxy answer. */
      timestamp: z.string().nullable().optional(),
    }),
  ),
})

/** Blockscout's newest block height at the daily read (a level). */
export const blockHeightMetric = "chain.block_height"
/** Blocks produced between two daily reads: the share denominator. */
export const blocksMetric = "chain.blocks"
/**
 * The unix time of the head block at the daily read: with the heights,
 * block time over the real span between two reads (not a 24-hour day).
 */
export const blockHeightTimeMetric = "chain.block_height_time"

/** Origin binding calls use; the InternalApi entrypoint trusts any URL. */
const apiOrigin = "https://api.internal"

async function blockscout<Schema extends z.ZodType>(
  api: ApiBinding,
  path: string,
  schema: Schema,
): Promise<z.output<Schema>> {
  const response = await api.fetch(
    new Request(`${apiOrigin}/internal/blockscout/api/v2/${path}`, {
      headers: { accept: "application/json" },
    }),
  )
  if (!response.ok) {
    throw new Error(`Blockscout proxy answered ${response.status} for ${path}`)
  }
  return schema.parse(await response.json())
}

export type OnceDailyDeps = {
  db: D1Database
  api: ApiBinding | null
  fetcher: FetchLike
  nowSeconds: number
  logger: Logger
}

export type SourceResult =
  | { source: string; status: "done"; days: string[]; rows: number }
  | {
      source: string
      status: "waiting" | "failed" | "skipped"
      reason: string
    }

export type OnceDailyResult = { sources: SourceResult[]; rowsWritten: number }

const cursorsSchema = z.array(z.object({ name: z.string(), value: z.string() }))

async function dailyCursors(db: D1Database): Promise<Map<string, string>> {
  const result = await db
    .prepare("SELECT name, value FROM scan_cursors WHERE name LIKE 'daily:%'")
    .all()
  return new Map(
    cursorsSchema.parse(result.results).map((row) => [row.name, row.value]),
  )
}

function attemptKey(source: string): string {
  return `daily:attempt:${source}`
}

export async function runOnceDaily(
  deps: OnceDailyDeps,
): Promise<OnceDailyResult> {
  const today = dayOf(deps.nowSeconds)
  const yesterday = dayOf(dayStart(today) - 86_400)
  const markers = await dailyCursors(deps.db)
  const results: SourceResult[] = []
  let rowsWritten = 0

  function due(source: string, marker: string): boolean {
    if ((markers.get(marker) ?? "") >= yesterday) return false
    const attempted = Number.parseInt(
      markers.get(attemptKey(source)) ?? "0",
      10,
    )
    return deps.nowSeconds - attempted >= retryAfterSeconds
  }

  async function commit(
    source: string,
    marker: string | null,
    byDay: ReadonlyMap<string, readonly DailyPoint[]>,
    origin: string,
    extra: SqlStatement[] = [],
    notes: SqlStatement[] = [],
  ) {
    const served: SqlStatement[] = [...extra]
    for (const [day, points] of byDay) {
      served.push(
        ...upsertStatements(
          dailySpec,
          dailyRows(points, day, origin, deps.nowSeconds),
        ),
      )
    }
    const rest: SqlStatement[] = [...notes]
    const last = [...byDay.keys()].sort().at(-1)
    if (marker !== null && last !== undefined) {
      rest.push(cursorStatement(marker, last, deps.nowSeconds))
    }
    // Served rows bump data_version (only if one changed); markers do not.
    rowsWritten += await runBatch(deps.db, servedBatch(served, rest))
    results.push({
      source,
      status: "done",
      days: [...byDay.keys()].sort(),
      rows: [...byDay.values()].reduce((n, list) => n + list.length, 0),
    })
  }

  async function failed(source: string, error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    results.push({ source, status: "failed", reason })
    deps.logger.warn({
      message: "Daily source failed; retrying later",
      source,
      reason,
    })
    rowsWritten += await runBatch(deps.db, [
      cursorStatement(
        attemptKey(source),
        String(deps.nowSeconds),
        deps.nowSeconds,
      ),
    ])
  }

  // Counters: levels as of yesterday's close, in the first hours only.
  const inWindow =
    deps.nowSeconds - dayStart(today) < counterWindowHours * 3_600
  if (!inWindow) {
    if ((markers.get("daily:counters") ?? "") < yesterday) {
      results.push({
        source: "counters",
        status: "skipped",
        reason: "Outside the window",
      })
    }
  } else if (deps.api === null) {
    results.push({
      source: "counters",
      status: "skipped",
      reason: "No API binding",
    })
  } else if (due("counters", "daily:counters")) {
    try {
      const api = deps.api
      const [stats, ...tokens] = await Promise.all([
        blockscout(api, "stats", statsSchema),
        ...counterTokens.map((token) =>
          blockscout(api, `tokens/${token}/counters`, tokenCountersSchema),
        ),
      ])
      const points: DailyPoint[] = []
      if (stats.total_transactions !== null) {
        points.push({
          metric: "chain.transactions_total",
          dimension: "",
          value: BigInt(stats.total_transactions),
        })
      }
      if (stats.total_addresses !== null) {
        points.push({
          metric: "chain.addresses_total",
          dimension: "",
          value: BigInt(stats.total_addresses),
        })
      }
      tokens.forEach((counters, index) => {
        const token = counterTokens[index]
        if (token === undefined) return
        if (counters.token_holders_count !== null) {
          points.push({
            metric: "token.holders",
            dimension: token,
            value: BigInt(counters.token_holders_count),
          })
        }
        if (counters.transfers_count !== null) {
          points.push({
            metric: "token.transfers_total",
            dimension: token,
            value: BigInt(counters.transfers_count),
          })
        }
      })
      // Stored as yesterday's close; counters:<day> records when they were
      // actually read (up to three hours into today).
      await commit(
        "counters",
        "daily:counters",
        new Map([[yesterday, points]]),
        "blockscout",
        [],
        [
          cursorStatement(
            `counters:${yesterday}`,
            new Date(deps.nowSeconds * 1000).toISOString(),
            deps.nowSeconds,
          ),
        ],
      )
    } catch (error) {
      await failed("counters", error)
    }
  }

  // Validators: blocks proposed per validator, from Blockscout's
  // cumulative validations_count, read once a day in the counters window
  // and stored as yesterday's close (chain.blocks_proposed_total). The
  // day's count (chain.blocks_proposed) is the difference from the day
  // before's read, written only when that read exists and the counter did
  // not go down: a first read, a missed day or a reset leaves a gap rather
  // than the cumulative total, a spike or a negative (README).
  if (inWindow && deps.api !== null && due("validators", validatorsMarker)) {
    try {
      const api = deps.api
      const notes: SqlStatement[] = []
      // Miners newly seen in one read of recent blocks join the set.
      let seen = parseJson(
        z.array(z.string()).catch([]),
        markers.get(validatorsSeenCursor) ?? "[]",
      )
      // The head at this read, from the same recent-blocks read.
      let headRead: bigint | null = null
      let headTime: bigint | null = null
      if (markers.get(validatorsDiscoveredCursor) !== yesterday) {
        const blocks = await blockscout(api, "blocks?type=block", blocksSchema)
        const head = blocks.items.reduce<(typeof blocks.items)[number] | null>(
          (top, block) =>
            top === null || block.height > top.height ? block : top,
          null,
        )
        if (head !== null) {
          headRead = BigInt(head.height)
          const at = Date.parse(head.timestamp ?? "")
          if (Number.isFinite(at)) headTime = BigInt(Math.floor(at / 1000))
        }
        const miners = blocks.items.flatMap((block) =>
          block.miner === null ? [] : [block.miner.hash.toLowerCase()],
        )
        seen = [...new Set([...seen, ...miners])].sort()
        notes.push(
          cursorStatement(
            validatorsSeenCursor,
            JSON.stringify(seen),
            deps.nowSeconds,
          ),
          cursorStatement(
            validatorsDiscoveredCursor,
            yesterday,
            deps.nowSeconds,
          ),
        )
      }
      const labelled = z
        .array(z.object({ address: z.string() }))
        .parse(
          (
            await deps.db
              .prepare("SELECT address FROM labels WHERE kind = 'validator'")
              .all()
          ).results,
        )
        .map((row) => row.address.toLowerCase())
      const validators = [...new Set([...labelled, ...seen])]
        .filter((address) => /^0x[0-9a-f]{40}$/.test(address))
        .sort()
      const levels = async (day: string, metric = proposedTotalMetric) =>
        new Map(
          z
            .array(z.object({ dimension: z.string(), value: z.string() }))
            .parse(
              (
                await deps.db
                  .prepare(
                    `SELECT dimension, value FROM daily
                     WHERE metric = ?1 AND day = ?2`,
                  )
                  .bind(metric, day)
                  .all()
              ).results,
            )
            .map((row) => [row.dimension, BigInt(row.value)]),
        )
      const done = await levels(yesterday)
      const dayBefore = dayOf(dayStart(yesterday) - 86_400)
      const before = await levels(dayBefore)
      // One read per validator per day: a retry reads only those missing.
      const pending = validators.filter((address) => !done.has(address))
      const reads = await Promise.allSettled(
        pending.map((address) =>
          blockscout(
            api,
            `addresses/${address}/counters`,
            validatorCountersSchema,
          ),
        ),
      )
      const points: DailyPoint[] = []
      // The day's blocks, by the same rule as each validator's count: a
      // difference of two daily reads, nothing for a first read, a missed
      // day or a height that went down.
      if (headRead !== null) {
        points.push({
          metric: blockHeightMetric,
          dimension: "",
          value: headRead,
        })
        if (headTime !== null) {
          points.push({
            metric: blockHeightTimeMetric,
            dimension: "",
            value: headTime,
          })
        }
        const previous = (await levels(dayBefore, blockHeightMetric)).get("")
        if (previous !== undefined && headRead >= previous) {
          points.push({
            metric: blocksMetric,
            dimension: "",
            value: headRead - previous,
          })
        }
      }
      const failures: string[] = []
      reads.forEach((read, index) => {
        const address = pending[index]
        if (address === undefined) return
        if (
          read.status === "rejected" ||
          read.value.validations_count === null
        ) {
          failures.push(address)
          return
        }
        const total = BigInt(read.value.validations_count)
        points.push({
          metric: proposedTotalMetric,
          dimension: address,
          value: total,
        })
        const previous = before.get(address)
        if (previous === undefined) return
        if (total < previous) {
          deps.logger.warn({
            message:
              "Validator counter went down; no blocks_proposed for the day",
            validator: address,
            previous: previous.toString(),
            total: total.toString(),
          })
          return
        }
        points.push({
          metric: proposedMetric,
          dimension: address,
          value: total - previous,
        })
      })
      await commit(
        "validators",
        failures.length === 0 ? validatorsMarker : null,
        new Map([[yesterday, points]]),
        "blockscout",
        [],
        notes,
      )
      if (failures.length > 0) {
        await failed(
          "validators",
          new Error(
            `No counter for ${failures.length} validators: ${failures.join(", ")}`,
          ),
        )
      }
    } catch (error) {
      await failed("validators", error)
    }
  }

  // Chart: exact daily transaction counts for the last 30 days.
  if (deps.api !== null && due("chart", "daily:chart")) {
    try {
      const chart = await blockscout(
        deps.api,
        "stats/charts/transactions",
        transactionsChartSchema,
      )
      const byDay = new Map<string, DailyPoint[]>()
      for (const point of chart.chart_data) {
        const day = point.date.slice(0, 10)
        if (day >= today) continue
        byDay.set(day, [
          {
            metric: "chain.transactions",
            dimension: "",
            value: BigInt(point.transactions_count),
          },
        ])
      }
      // The marker moves only once the chart has yesterday.
      if (byDay.has(yesterday)) {
        await commit("chart", "daily:chart", byDay, "blockscout")
      } else {
        await commit("chart", null, byDay, "blockscout")
        results.push({
          source: "chart",
          status: "waiting",
          reason: "Chart lacks yesterday",
        })
      }
    } catch (error) {
      await failed("chart", error)
    }
  }

  // Subgraphs: whole days only, as far as each has indexed.
  for (const source of subgraphSources) {
    const marker = `daily:${source}`
    if (!due(source, marker)) continue
    const after = markers.get(marker)
    const first = after === undefined ? yesterday : nextDay(after)
    let last = first
    for (let n = 1; n < subgraphDaysPerRun && last < yesterday; n += 1) {
      last = nextDay(last)
    }
    try {
      const read = await readSubgraphDays(deps.fetcher, source, first, last)
      const accepted = new Map<string, DailyPoint[]>()
      for (
        let day = first;
        day <= last && day <= read.indexedThrough;
        day = nextDay(day)
      ) {
        accepted.set(day, read.days.get(day) ?? [])
      }
      const pools = upsertStatements(
        poolSpec,
        read.pools.map((pool) => ({
          ...pool,
          source: "earn-pools",
          updated_at: deps.nowSeconds,
        })),
      )
      if (accepted.size === 0) {
        results.push({
          source,
          status: "waiting",
          reason: `Subgraph indexed through ${read.indexedThrough}`,
        })
        rowsWritten += await runBatch(deps.db, pools)
        continue
      }
      await commit(
        source,
        marker,
        accepted,
        source === "dex" ? "earn-pools" : source,
        pools,
      )
    } catch (error) {
      await failed(source, error)
    }
  }

  const done = results.filter((result) => result.status === "done")
  if (done.length > 0) {
    deps.logger.info({
      message: "Daily series written",
      sources: done,
      rowsWritten,
    })
  }
  return { sources: results, rowsWritten }
}
