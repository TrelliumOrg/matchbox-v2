import type { CoinGeckoConfig } from "@matchbox/api/market/coingecko"
import type { Logger } from "@matchbox/logger"
import {
  cursorStatement,
  runBatch,
  type SqlStatement,
  upsertStatements,
} from "../scan/statements"
import { dayOf, dayStart } from "../scan/transform"
import {
  bridgeDailyRows,
  bridgeDaysBack,
  readBridgeFlows,
  routeTotalRows,
  wormholescanAssets,
} from "./bridge"
import { type MusdPriceResult, runMusdPrice } from "./musd-price"
import { fetchPoolInputs, poolRows } from "./pools"
import type { CrossChainClients } from "./rpc"
import type { Fetcher, KeyedCoinGecko } from "./sources"
import {
  bridgeDailySpec,
  bridgeRouteTotalsSpec,
  poolDailySpec,
  tokenSupplySpec,
} from "./specs"
import { readAllSupply, supplyRows } from "./supply"

// The cross-chain jobs, from the existing crons (no new trigger):
// - every minute, after the price job: MUSD's venue quotes and headline;
// - from the 5-minute live trigger, once an hour per part: supply by chain,
//   the pool snapshot, and bridge flows. Each part has a marker in
//   scan_cursors (`crosschain:{part}` = the UTC hour it last completed),
//   written in the same batch as its rows, so a failed part is retried on
//   the next 5-minute run and a completed one waits for the next hour.
// - The pool snapshot's period is longer with a Demo key (every 2 hours:
//   README "CoinGecko call budget"); its marker is the period's first hour.
//   Only the period's first run may spend keyed CoinGecko calls, so a
//   retry every 5 minutes never multiplies them.

export type CrossChainPart = "supply" | "pools" | "bridge"

export function hourKey(nowSeconds: number): string {
  return new Date(Math.floor(nowSeconds / 3_600) * 3_600_000)
    .toISOString()
    .slice(0, 13)
}

export type PoolSchedule = {
  /** CoinGecko with a key, when the budget allows keyed pool reads. */
  keyed: KeyedCoinGecko | null
  /** Hours between pool snapshots: the keyed interval, else 1. */
  everyHours: number
}

export const keylessPools: PoolSchedule = { keyed: null, everyHours: 1 }

/**
 * Keyed calls are spent only in a period's first 5 minutes: the first
 * 5-minute run. Later retries in the period read keyless.
 */
export const keyedWindowSeconds = 300

/** The start of the pool period `nowSeconds` falls in. */
export function periodStart(nowSeconds: number, everyHours: number): number {
  const length = Math.max(1, Math.floor(everyHours)) * 3_600
  return Math.floor(nowSeconds / length) * length
}

/** A part's marker value: the hour, or the pool period's first hour. */
export function partKey(
  part: CrossChainPart,
  nowSeconds: number,
  pools: PoolSchedule,
): string {
  return hourKey(
    part === "pools" ? periodStart(nowSeconds, pools.everyHours) : nowSeconds,
  )
}

/** The keyed config this run may use for pool depth, or null. */
export function keyedPoolsThisRun(
  pools: PoolSchedule,
  nowSeconds: number,
): KeyedCoinGecko | null {
  if (pools.keyed === null) return null
  const into = nowSeconds - periodStart(nowSeconds, pools.everyHours)
  return into < keyedWindowSeconds ? pools.keyed : null
}

async function partDone(
  db: D1Database,
  part: CrossChainPart,
  hour: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT value FROM scan_cursors WHERE name = ?1")
    .bind(`crosschain:${part}`)
    .first<{ value: string }>()
  return row?.value === hour
}

export type HourlyDeps = {
  db: D1Database
  clients: CrossChainClients
  fetcher: Fetcher
  nowSeconds: number
  logger: Logger
  /** The pool snapshot's period and keyed source; keyless hourly if unset. */
  pools?: PoolSchedule
  /** Run every part regardless of its marker (the dry run). */
  force?: boolean
}

export type HourlyPlan = {
  part: CrossChainPart
  /** The statements one run would write, cursor included when complete. */
  statements: SqlStatement[]
  complete: boolean
  summary: Record<string, unknown>
}

/**
 * Reads one part and returns its statements; writes nothing. `poolsKeyed`
 * is the keyed CoinGecko config this run may spend on pool depth.
 */
export async function planPart(
  part: CrossChainPart,
  deps: Omit<HourlyDeps, "db" | "force"> & {
    poolsKeyed?: KeyedCoinGecko | null
  },
): Promise<HourlyPlan> {
  const day = dayOf(deps.nowSeconds)
  const cursor = cursorStatement(
    `crosschain:${part}`,
    partKey(part, deps.nowSeconds, deps.pools ?? keylessPools),
    deps.nowSeconds,
  )
  switch (part) {
    case "supply": {
      const { readings, failed } = await readAllSupply(deps.clients)
      if (failed.length > 0) {
        deps.logger.warn({ message: "Supply reads failed", failed })
      }
      const complete = failed.length === 0
      return {
        part,
        statements: [
          ...upsertStatements(
            tokenSupplySpec,
            supplyRows(readings, day, deps.nowSeconds),
          ),
          ...(complete ? [cursor] : []),
        ],
        complete,
        summary: {
          rows: readings.length,
          failed: failed.map((item) => `${item.asset}:${item.chain}`),
          readings: readings.map((reading) => ({
            asset: reading.asset,
            chain: reading.chain,
            totalSupply: reading.totalSupply.toString(),
            locked: reading.locked?.toString() ?? null,
            circulating: reading.circulating.toString(),
          })),
        },
      }
    }
    case "pools": {
      const inputs = await fetchPoolInputs(deps.fetcher, deps.logger, {
        keyed: deps.poolsKeyed ?? null,
      })
      const rows = poolRows(inputs, day, deps.nowSeconds)
      const complete = inputs.failed.size === 0
      const depth = Object.fromEntries(
        [...inputs.gecko].map(([chain, pools]) => [
          chain,
          pools.values().next().value?.source ?? "none listed",
        ]),
      )
      return {
        part,
        statements: [
          ...upsertStatements(poolDailySpec, rows),
          ...(complete ? [cursor] : []),
        ],
        complete,
        summary: {
          rows: rows.length,
          failed: [...inputs.failed],
          depth,
          pools: rows,
        },
      }
    }
    case "bridge": {
      const fromDay = dayOf(dayStart(day) - bridgeDaysBack * 86_400)
      const statements: SqlStatement[] = []
      const summary: Record<string, unknown> = {}
      for (const asset of wormholescanAssets) {
        const reading = await readBridgeFlows(deps.fetcher, asset, fromDay, day)
        statements.push(
          ...upsertStatements(
            bridgeRouteTotalsSpec,
            routeTotalRows(asset, reading.totals, day, deps.nowSeconds),
          ),
          ...upsertStatements(
            bridgeDailySpec,
            bridgeDailyRows(asset, reading.days, deps.nowSeconds),
          ),
        )
        summary[asset] = { routes: reading.totals, days: reading.days }
      }
      statements.push(cursor)
      return { part, statements, complete: true, summary }
    }
  }
}

/** The hourly parts not yet done this hour; each failure is isolated. */
export async function runCrossChainHourly(
  deps: HourlyDeps,
): Promise<Record<CrossChainPart, "done" | "skipped" | "partial" | "failed">> {
  const pools = deps.pools ?? keylessPools
  const outcome = {} as Record<
    CrossChainPart,
    "done" | "skipped" | "partial" | "failed"
  >
  for (const part of ["supply", "pools", "bridge"] as const) {
    const key = partKey(part, deps.nowSeconds, pools)
    if (deps.force !== true && (await partDone(deps.db, part, key))) {
      outcome[part] = "skipped"
      continue
    }
    try {
      const plan = await planPart(part, {
        ...deps,
        poolsKeyed:
          deps.force === true
            ? pools.keyed
            : keyedPoolsThisRun(pools, deps.nowSeconds),
      })
      await runBatch(deps.db, plan.statements)
      outcome[part] = plan.complete ? "done" : "partial"
    } catch (error) {
      outcome[part] = "failed"
      deps.logger.warn({
        message: "Cross-chain part failed",
        part,
        reason:
          error instanceof Error
            ? error.message.slice(0, 200)
            : "Unknown error",
      })
    }
  }
  return outcome
}

export type MinuteDeps = {
  db: D1Database
  clients: CrossChainClients
  coingecko: CoinGeckoConfig
  nowSeconds: number
  logger: Logger
}

export function runCrossChainMinute(
  deps: MinuteDeps,
): Promise<MusdPriceResult> {
  return runMusdPrice(deps)
}
