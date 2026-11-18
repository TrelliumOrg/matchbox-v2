import { activityExtraSchema } from "@matchbox/contracts/scan"
import { EPOCH_SECONDS, EPOCH_ZERO_START, epochStartOf } from "@matchbox/domain"
import { z } from "zod"
import {
  type JsonRow,
  runBatch,
  type SqlStatement,
  servedBatch,
  sortKey,
  type UpsertSpec,
  upsertStatements,
} from "./statements"
import { dayStart, emissionEpochOf, parseJson } from "./transform"

// Aggregates computed from the scan database itself, for the epochs and
// days the copy marked dirty: epoch_totals, gauge_epoch and the `daily`
// metrics that come from copied rows. Each recompute reads the epoch's or
// day's rows and rewrites only values that changed, so it is idempotent.
// Sums are bigint (weights and amounts exceed 2^63); SQL only counts.

const integer = z.string().regex(/^-?[0-9]+$/)

/**
 * An epoch's vote transactions: a range on activity_action (action_type,
 * timestamp), not every BOOST_VOTE row ever.
 */
export const epochVoteTxSql = `SELECT count(DISTINCT tx_hash) AS n FROM activity
       WHERE action_type = 'BOOST_VOTE' AND timestamp >= ?1 AND timestamp < ?2`

function add(map: Map<string, bigint>, key: string, value: bigint) {
  map.set(key, (map.get(key) ?? 0n) + value)
}

function toObject(map: ReadonlyMap<string, bigint>): string {
  return JSON.stringify(
    Object.fromEntries(
      [...map.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, value.toString()]),
    ),
  )
}

async function all<Schema extends z.ZodType>(
  db: D1Database,
  schema: Schema,
  sql: string,
  ...params: (string | number)[]
): Promise<z.output<Schema>[]> {
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all()
  return z.array(schema).parse(result.results)
}

// ---- epochs -----------------------------------------------------------

export const gaugeEpochSpec: UpsertSpec = {
  table: "gauge_epoch",
  columns: [
    "epoch_start",
    "gauge",
    "source",
    "pool",
    "vote_weight",
    "weight_key",
    "voters",
    "incentives",
    "fees",
    "rank",
    "killed",
    "updated_at",
  ],
  key: ["gauge", "epoch_start"],
  update: [
    "source",
    "pool",
    "vote_weight",
    "weight_key",
    "voters",
    "incentives",
    "fees",
    "rank",
    "killed",
    "updated_at",
  ],
}

export const epochTotalsSpec: UpsertSpec = {
  table: "epoch_totals",
  columns: [
    "epoch_start",
    "emission",
    "rebase",
    "gauge_rewards",
    "total_supply",
    "vote_transactions",
    "voters",
    "vote_weight",
    "gauges",
    "incentives",
    "fees",
    "top_gauge",
    "killed_weight",
    "updated_at",
  ],
  key: ["epoch_start"],
  update: [
    "emission",
    "rebase",
    "gauge_rewards",
    "total_supply",
    "vote_transactions",
    "voters",
    "vote_weight",
    "gauges",
    "incentives",
    "fees",
    "top_gauge",
    "killed_weight",
    "updated_at",
  ],
}

const voteRowSchema = z.object({
  gauge: z.string(),
  escrow: z.string(),
  token_id: z.string(),
  source: z.string(),
  pool: z.string().nullable(),
  weight: integer,
})

const depositRowSchema = z.object({
  gauge: z.string(),
  voter_source: z.string(),
  pool: z.string().nullable(),
  reward_type: z.string(),
  token: z.string(),
  amount: integer,
})

const emissionRowSchema = z.object({
  epoch_start: z.number().int(),
  extra: z.string(),
})

type GaugeTotals = {
  source: string
  pool: string | null
  weight: bigint
  voters: Set<string>
  incentives: Map<string, bigint>
  fees: Map<string, bigint>
}

/** Rows to write for one epoch, from its votes, deposits and emission. */
export async function epochStatements(
  db: D1Database,
  epoch: number,
  nowSeconds: number,
): Promise<SqlStatement[]> {
  const [votes, deposits, voteTxs, emissions, lifecycle] = await Promise.all([
    all(
      db,
      voteRowSchema,
      `SELECT gauge, escrow, token_id, source, pool, weight FROM lock_votes
       WHERE epoch_start = ?1`,
      epoch,
    ),
    all(
      db,
      depositRowSchema,
      `SELECT gauge, voter_source, pool, reward_type, token, amount
       FROM incentive_deposits WHERE epoch_start = ?1`,
      epoch,
    ),
    all(
      db,
      z.object({ n: z.number().int() }),
      epochVoteTxSql,
      epoch,
      epoch + EPOCH_SECONDS,
    ),
    all(
      db,
      emissionRowSchema,
      `SELECT epoch_start, extra FROM activity
       WHERE action_type = 'EPOCH_PROCESSED'
         AND epoch_start BETWEEN ?1 AND ?2
       ORDER BY block_number, log_index`,
      epoch - EPOCH_SECONDS,
      epoch + EPOCH_SECONDS,
    ),
    all(
      db,
      z.object({ gauge: z.string(), action_type: z.string() }),
      `SELECT gauge, action_type FROM activity
       WHERE action_type IN ('GAUGE_KILLED', 'GAUGE_REVIVED')
         AND gauge IS NOT NULL AND timestamp < ?1
       ORDER BY timestamp, block_number, log_index`,
      epoch + EPOCH_SECONDS,
    ),
  ])
  // A gauge is killed for the epoch when its last kill or revive before the
  // epoch's end was a kill. The voters stop new votes on it and send its
  // emissions back to the minter; its existing weight stays in their
  // totalWeight, so it stays in vote_weight here too.
  const lifecycleState = new Map<string, boolean>()
  for (const row of lifecycle) {
    lifecycleState.set(row.gauge, row.action_type === "GAUGE_KILLED")
  }
  const killed = new Set(
    [...lifecycleState.entries()].flatMap(([gauge, dead]) =>
      dead ? [gauge] : [],
    ),
  )

  const gauges = new Map<string, GaugeTotals>()
  function gaugeOf(gauge: string, source: string, pool: string | null) {
    const existing = gauges.get(gauge)
    if (existing !== undefined) {
      existing.pool = existing.pool ?? pool
      return existing
    }
    const created: GaugeTotals = {
      source,
      pool,
      weight: 0n,
      voters: new Set(),
      incentives: new Map(),
      fees: new Map(),
    }
    gauges.set(gauge, created)
    return created
  }
  const voters = new Set<string>()
  const weightBySource = new Map<string, bigint>()
  for (const vote of votes) {
    const totals = gaugeOf(vote.gauge, vote.source, vote.pool)
    const weight = BigInt(vote.weight)
    totals.weight += weight
    totals.voters.add(`${vote.escrow}:${vote.token_id}`)
    voters.add(`${vote.escrow}:${vote.token_id}`)
    add(weightBySource, vote.source, weight)
  }
  const incentives = new Map<string, bigint>()
  const fees = new Map<string, bigint>()
  for (const deposit of deposits) {
    const totals = gaugeOf(deposit.gauge, deposit.voter_source, deposit.pool)
    const amount = BigInt(deposit.amount)
    if (deposit.reward_type === "Bribe") {
      add(totals.incentives, deposit.token, amount)
      add(incentives, deposit.token, amount)
    } else if (deposit.reward_type === "Fee") {
      add(totals.fees, deposit.token, amount)
      add(fees, deposit.token, amount)
    }
  }

  // Rank live gauges by weight within each voter source; ties by address.
  // Killed gauges are unranked and never the top gauge.
  const ranks = new Map<string, number>()
  const topGauge = new Map<string, string>()
  const killedWeight = new Map<string, bigint>()
  const bySource = new Map<string, [string, GaugeTotals][]>()
  for (const entry of gauges.entries()) {
    if (killed.has(entry[0])) {
      add(killedWeight, entry[1].source, entry[1].weight)
      continue
    }
    if (entry[1].weight === 0n) continue
    const list = bySource.get(entry[1].source) ?? []
    list.push(entry)
    bySource.set(entry[1].source, list)
  }
  for (const [source, list] of bySource) {
    list.sort(([gaugeA, a], [gaugeB, b]) =>
      a.weight === b.weight
        ? gaugeA.localeCompare(gaugeB)
        : a.weight > b.weight
          ? -1
          : 1,
    )
    list.forEach(([gauge], index) => {
      ranks.set(gauge, index + 1)
    })
    const first = list[0]
    if (first !== undefined) topGauge.set(source, first[0])
  }

  const gaugeRows: JsonRow[] = [...gauges.entries()].map(([gauge, totals]) => ({
    epoch_start: epoch,
    gauge,
    source: totals.source,
    pool: totals.pool,
    vote_weight: totals.weight.toString(),
    weight_key: sortKey(totals.weight.toString()),
    voters: totals.voters.size,
    incentives: toObject(totals.incentives),
    fees: toObject(totals.fees),
    rank: ranks.get(gauge) ?? null,
    killed: killed.has(gauge) ? 1 : 0,
    updated_at: nowSeconds,
  }))

  const emission = emissions.find(
    (row) => emissionEpochOf(row) === epoch,
  )?.extra
  const minted =
    emission === undefined ? null : parseJson(activityExtraSchema, emission)
  function field(name: string): string | null {
    const value = minted?.[name]
    return typeof value === "string" ? value : null
  }

  const totalsRow: JsonRow = {
    epoch_start: epoch,
    emission: field("emission"),
    rebase: field("rebase"),
    gauge_rewards: field("rewards"),
    total_supply: field("total_supply"),
    vote_transactions: voteTxs[0]?.n ?? 0,
    voters: voters.size,
    vote_weight: toObject(weightBySource),
    gauges: ranks.size,
    incentives: toObject(incentives),
    fees: toObject(fees),
    top_gauge: JSON.stringify(
      Object.fromEntries([...topGauge.entries()].sort()),
    ),
    killed_weight: toObject(killedWeight),
    updated_at: nowSeconds,
  }

  return [
    ...upsertStatements(gaugeEpochSpec, gaugeRows),
    {
      // Gauges that lost every vote and deposit in this epoch.
      sql: `DELETE FROM gauge_epoch WHERE epoch_start = ?1
AND gauge NOT IN (SELECT value FROM json_each(?2))`,
      params: [epoch, JSON.stringify([...gauges.keys()])],
    },
    ...upsertStatements(epochTotalsSpec, [totalsRow]),
  ]
}

// ---- days -------------------------------------------------------------

/**
 * A row from a backfill (source 'backfill:...') never replaces one a live
 * writer wrote; a live row replaces a backfilled one.
 */
export const backfillGuard = (table: string) =>
  `NOT (excluded.source LIKE 'backfill:%' AND ${table}.source NOT LIKE 'backfill:%')`

export const dailySpec: UpsertSpec = {
  table: "daily",
  columns: [
    "metric",
    "dimension",
    "day",
    "value",
    "source",
    "partial",
    "updated_at",
  ],
  key: ["metric", "dimension", "day"],
  update: ["value", "source", "partial", "updated_at"],
  guard: backfillGuard("daily"),
}

export type DailyPoint = { metric: string; dimension: string; value: bigint }

export function dailyRows(
  points: readonly DailyPoint[],
  dayKey: string,
  source: string,
  nowSeconds: number,
  partial = false,
): JsonRow[] {
  return points.map((point) => ({
    metric: point.metric,
    dimension: point.dimension,
    day: dayKey,
    value: point.value.toString(),
    source,
    partial: partial ? 1 : 0,
    updated_at: nowSeconds,
  }))
}

class Points {
  readonly values = new Map<string, DailyPoint>()
  add(metric: string, dimension: string, value: bigint) {
    const key = `${metric}\u0000${dimension}`
    const existing = this.values.get(key)
    if (existing === undefined) {
      this.values.set(key, { metric, dimension, value })
    } else {
      existing.value += value
    }
  }
  list(): DailyPoint[] {
    return [...this.values.values()]
  }
}

const swapRowSchema = z.object({ pool: z.string() })
const amountRowSchema = z.object({
  action_type: z.string(),
  contract_address: z.string(),
  source: z.string(),
  amount: integer.nullable(),
  extra: z.string(),
})

const lockFlows = ["LOCK_CREATED", "LOCK_AMOUNT_INCREASED", "LOCK_WITHDRAWN"]
const savingsFlows = [
  "SAVINGS_DEPOSIT",
  "SAVINGS_WITHDRAW",
  "SAVINGS_YIELD_CLAIMED",
]

/** Signed change per Morpho action: supply, borrow and collateral. */
/** The escrow dimension of lock series: 'vebtc' or 'vemezo'. */
const escrowNames: Record<string, string> = {
  "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279": "vebtc",
  "0xb90fdad3dfd180458d62cc6acedc983d78e20122": "vemezo",
}

/**
 * Signed change per Morpho action, as Morpho Blue applies it: a
 * liquidation repays `assets` of debt and seizes collateral, and its bad
 * debt (badDebtAssets) is written off both total borrow and total supply.
 */
function morphoChanges(
  action: string,
  assets: bigint,
  seized: bigint,
  badDebt: bigint,
): { supply: bigint; borrow: bigint; collateral: bigint } {
  switch (action) {
    case "SUPPLIED":
      return { supply: assets, borrow: 0n, collateral: 0n }
    case "WITHDRAWN":
      return { supply: -assets, borrow: 0n, collateral: 0n }
    case "BORROWED":
      return { supply: 0n, borrow: assets, collateral: 0n }
    case "REPAID":
      return { supply: 0n, borrow: -assets, collateral: 0n }
    case "COLLATERAL_SUPPLIED":
      return { supply: 0n, borrow: 0n, collateral: assets }
    case "COLLATERAL_WITHDRAWN":
      return { supply: 0n, borrow: 0n, collateral: -assets }
    case "LIQUIDATED":
      return {
        supply: -badDebt,
        borrow: -(assets + badDebt),
        collateral: -seized,
      }
    case "INTEREST_ACCRUED":
      return { supply: assets, borrow: assets, collateral: 0n }
    default:
      return { supply: 0n, borrow: 0n, collateral: 0n }
  }
}

/**
 * Which MUSD flow a trove event's debt change is, and its size (positive):
 * a borrower's increase is MUSD borrowed (minted: opened, borrowed more,
 * refinanced; fees and an opened loan's 200 MUSD gas compensation
 * included), a borrower's decrease repaid (repayments and closed loans,
 * the gas compensation burned on close included), and the TroveManager's
 * redemptions and liquidations their own flows. A liquidation counts the
 * trove's recorded debt (its pending redistribution gains are not in the
 * event's change), whether the Stability Pool absorbed it or it was
 * redistributed. Pending-reward events (redistributed debt) and events
 * with no known change are none of these: they stay in musd.debt_change
 * only.
 */
export function troveDebtFlow(event: {
  emitter: string
  action: string
  debt_change: string | null
}): { metric: string; amount: bigint } | null {
  if (event.debt_change === null) return null
  const change = BigInt(event.debt_change)
  if (change === 0n) return null
  if (event.emitter === "BORROWER_OPERATIONS") {
    return change > 0n
      ? { metric: "musd.borrowed", amount: change }
      : { metric: "musd.repaid", amount: -change }
  }
  if (event.emitter === "TROVE_MANAGER" && change < 0n) {
    if (event.action === "LOAN_REDEEMED") {
      return { metric: "musd.redeemed", amount: -change }
    }
    if (event.action === "LOAN_LIQUIDATED") {
      return { metric: "musd.liquidated", amount: -change }
    }
  }
  return null
}

/** Every copy-derived daily point for one UTC day. */
export async function dayPoints(
  db: D1Database,
  dayKey: string,
): Promise<DailyPoint[]> {
  const from = dayStart(dayKey)
  const to = from + 86_400
  const actions = [...lockFlows, ...savingsFlows, "EPOCH_PROCESSED"]
  const [swaps, voteTxs, flows, deposits, troves, morpho] = await Promise.all([
    all(
      db,
      swapRowSchema,
      `SELECT pool FROM activity
         WHERE action_type = 'SWAP' AND timestamp >= ?1 AND timestamp < ?2
           AND pool IS NOT NULL`,
      from,
      to,
    ),
    all(
      db,
      z.object({ source: z.string(), n: z.number().int() }),
      `SELECT source, count(DISTINCT tx_hash) AS n FROM activity
         WHERE action_type = 'BOOST_VOTE' AND timestamp >= ?1 AND timestamp < ?2
         GROUP BY source`,
      from,
      to,
    ),
    all(
      db,
      amountRowSchema,
      `SELECT action_type, contract_address, source, amount, extra
         FROM activity
         WHERE action_type IN (SELECT value FROM json_each(?3))
           AND timestamp >= ?1 AND timestamp < ?2`,
      from,
      to,
      JSON.stringify(actions),
    ),
    all(
      db,
      z.object({
        reward_type: z.string(),
        token: z.string(),
        amount: integer,
      }),
      `SELECT reward_type, token, amount FROM incentive_deposits
         WHERE timestamp >= ?1 AND timestamp < ?2`,
      from,
      to,
    ),
    all(
      db,
      z.object({
        emitter: z.string(),
        action: z.string(),
        debt_change: integer.nullable(),
        coll_change: integer.nullable(),
      }),
      `SELECT emitter, action, debt_change, coll_change FROM trove_events
         WHERE timestamp >= ?1 AND timestamp < ?2`,
      from,
      to,
    ),
    all(
      db,
      z.object({
        market_id: z.string(),
        action: z.string(),
        assets: integer.nullable(),
        seized_assets: integer.nullable(),
        bad_debt_assets: integer.nullable(),
      }),
      `SELECT market_id, action, assets, seized_assets, bad_debt_assets
         FROM morpho_events
         WHERE timestamp >= ?1 AND timestamp < ?2`,
      from,
      to,
    ),
  ])

  const points = new Points()
  // Swap counts per basic pool. DEX volume and fees are dex.volume_in and
  // dex.fees from Mezo's earn-pools subgraph (basic and CL pools), so no
  // second, gross volume series is derived here.
  for (const swap of swaps) points.add("dex.swaps", swap.pool, 1n)
  for (const row of voteTxs) {
    points.add("votes.transactions", row.source, BigInt(row.n))
  }
  for (const row of flows) {
    const amount = BigInt(row.amount ?? "0")
    // Lock flows are keyed by escrow name, as escrow.supply is.
    const escrow = escrowNames[row.contract_address] ?? row.contract_address
    switch (row.action_type) {
      case "LOCK_CREATED":
        points.add("locks.created", escrow, 1n)
        points.add("locks.deposited", escrow, amount)
        points.add("locks.net", escrow, amount)
        break
      case "LOCK_AMOUNT_INCREASED":
        points.add("locks.deposited", escrow, amount)
        points.add("locks.net", escrow, amount)
        break
      case "LOCK_WITHDRAWN":
        points.add("locks.withdrawn", escrow, amount)
        points.add("locks.net", escrow, -amount)
        break
      case "SAVINGS_DEPOSIT":
        points.add("savings.deposited", "", amount)
        points.add("savings.net", "", amount)
        break
      case "SAVINGS_WITHDRAW":
        points.add("savings.withdrawn", "", amount)
        points.add("savings.net", "", -amount)
        break
      case "SAVINGS_YIELD_CLAIMED":
        points.add("savings.yield_claimed", "", amount)
        break
      case "EPOCH_PROCESSED": {
        const extra = parseJson(activityExtraSchema, row.extra)
        for (const [name, metric] of [
          ["emission", "emissions.minted"],
          ["rebase", "emissions.rebase"],
          ["rewards", "emissions.gauge_rewards"],
        ] as const) {
          const value = extra[name]
          if (typeof value === "string") points.add(metric, "", BigInt(value))
        }
        break
      }
    }
  }
  for (const deposit of deposits) {
    if (deposit.reward_type !== "Bribe" && deposit.reward_type !== "Fee")
      continue
    points.add(
      deposit.reward_type === "Bribe" ? "incentives.deposited" : "fees.voters",
      deposit.token,
      BigInt(deposit.amount),
    )
  }
  for (const trove of troves) {
    points.add("musd.debt_change", "", BigInt(trove.debt_change ?? "0"))
    points.add("musd.coll_change", "", BigInt(trove.coll_change ?? "0"))
    const flow = troveDebtFlow(trove)
    if (flow !== null) points.add(flow.metric, "", flow.amount)
  }
  for (const event of morpho) {
    const change = morphoChanges(
      event.action,
      BigInt(event.assets ?? "0"),
      BigInt(event.seized_assets ?? "0"),
      BigInt(event.bad_debt_assets ?? "0"),
    )
    if (change.supply !== 0n) {
      points.add("morpho.supply_change", event.market_id, change.supply)
    }
    if (change.borrow !== 0n) {
      points.add("morpho.borrow_change", event.market_id, change.borrow)
    }
    if (change.collateral !== 0n) {
      points.add("morpho.collateral_change", event.market_id, change.collateral)
    }
  }
  return points.list()
}

export async function dayStatements(
  db: D1Database,
  dayKey: string,
  nowSeconds: number,
  copiedThrough: number | null,
): Promise<SqlStatement[]> {
  const points = await dayPoints(db, dayKey)
  // Partial until the copy has read past the day's end.
  const partial =
    copiedThrough === null || copiedThrough < dayStart(dayKey) + 86_400
  return upsertStatements(
    dailySpec,
    dailyRows(points, dayKey, "warehouse", nowSeconds, partial),
  )
}

export type AggregateResult = {
  epochs: number
  days: number
  rowsWritten: number
  /** Dirty keys left for the next run (over the per-run budget). */
  remaining: number
  /** D1 calls made (a batch counts once against the invocation limit). */
  queries: number
}

/** D1 calls one key costs: its reads plus its write batch. */
const queriesPerKey = { epoch: 6, day: 7 } as const

/**
 * An epoch's rows, none before Epoch 0 (Thu 11 Dec 2025): votes cast the
 * week before it are marked dirty under that week, which is not an epoch,
 * so its marker is only cleared.
 */
function epochRows(
  db: D1Database,
  epoch: number,
  nowSeconds: number,
): Promise<SqlStatement[]> {
  if (epoch < EPOCH_ZERO_START) return Promise.resolve([])
  return epochStatements(db, epoch, nowSeconds)
}

type DirtyKey = { kind: "epoch" | "day"; key: string; generation: number }

/**
 * The order dirty keys are recomputed in: the current epoch and the current
 * day first (what readers see), then everything else newest first.
 */
export function aggregateOrder(
  keys: readonly DirtyKey[],
  nowSeconds: number,
): DirtyKey[] {
  const epoch = String(epochStartOf(nowSeconds))
  const today = new Date(nowSeconds * 1000).toISOString().slice(0, 10)
  function rank(item: DirtyKey): number {
    if (item.kind === "epoch" && item.key === epoch) return 0
    if (item.kind === "day" && item.key === today) return 1
    return 2
  }
  return [...keys].sort((a, b) => {
    const order = rank(a) - rank(b)
    if (order !== 0) return order
    // Newest first; epochs and days interleave by key order within a kind.
    return a.key < b.key ? 1 : a.key > b.key ? -1 : a.kind.localeCompare(b.kind)
  })
}

/**
 * Recomputes dirty epochs and days within a D1 call budget, each key in
 * its own batch together with clearing its marker. The marker is cleared
 * only if its generation is unchanged: a run that re-marked it meanwhile
 * (new rows for that epoch or day) leaves it for the next run. Then the
 * partial flags of days now complete are cleared.
 */
export async function runAggregates(
  db: D1Database,
  nowSeconds: number,
  options: { queryBudget?: number; copiedThrough?: number | null } = {},
): Promise<AggregateResult> {
  const budget = options.queryBudget ?? 200
  const copiedThrough = options.copiedThrough ?? null
  let queries = 1
  const dirty = aggregateOrder(
    await all(
      db,
      z.object({
        kind: z.enum(["epoch", "day"]),
        key: z.string(),
        generation: z.number().int(),
      }),
      "SELECT kind, key, generation FROM scan_dirty",
    ),
    nowSeconds,
  )
  let rowsWritten = 0
  let epochs = 0
  let days = 0
  let done = 0
  for (const item of dirty) {
    if (queries + queriesPerKey[item.kind] > budget) break
    const statements =
      item.kind === "epoch"
        ? await epochRows(db, Number.parseInt(item.key, 10), nowSeconds)
        : await dayStatements(db, item.key, nowSeconds, copiedThrough)
    // The served rows bump data_version (only if one changed); clearing
    // the marker does not.
    rowsWritten += await runBatch(
      db,
      servedBatch(statements, [
        {
          sql: "DELETE FROM scan_dirty WHERE kind = ?1 AND key = ?2 AND generation = ?3",
          params: [item.kind, item.key, item.generation],
        },
      ]),
    )
    queries += queriesPerKey[item.kind]
    done += 1
    if (item.kind === "epoch") epochs += 1
    else days += 1
  }
  // Rows of days that are now over (closing values) or fully copied
  // (copy-derived) stop being partial.
  const today = new Date(nowSeconds * 1000).toISOString().slice(0, 10)
  const copiedDay =
    copiedThrough === null
      ? null
      : new Date(copiedThrough * 1000).toISOString().slice(0, 10)
  rowsWritten += await runBatch(
    db,
    servedBatch([
      {
        sql: `UPDATE daily SET partial = 0
WHERE partial = 1 AND day < ?1 AND source <> 'warehouse'`,
        params: [today],
      },
      ...(copiedDay === null
        ? []
        : [
            {
              sql: `UPDATE daily SET partial = 0
WHERE partial = 1 AND day < ?1 AND source = 'warehouse'`,
              params: [copiedDay],
            },
          ]),
    ]),
  )
  queries += 1
  return {
    epochs,
    days,
    rowsWritten,
    remaining: dirty.length - done,
    queries,
  }
}
