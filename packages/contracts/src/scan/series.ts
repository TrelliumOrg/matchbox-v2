import { z } from "zod"

// The one registry of series in matchbox-scan's `daily` table. The jobs
// Worker writes exactly these metrics (apps/jobs/src/scan and
// scripts/scan-backfill); /internal/scan validates `metric` and `dimension`
// against it at request time and describes each series from it. A metric
// not listed is a 400, never an empty chart. One metric per concept: two
// sources with different definitions get different names and are never
// spliced into one series. `scanMetricNotes` says what each one measures,
// where it comes from and from when.

/** What `dimension` holds for a metric; `total` means only ''. */
export const scanDimensionKindSchema = z.enum([
  "total",
  "pool-token",
  "pool",
  "token",
  "escrow",
  "market",
  "voter-source",
  /** "<token>:<destination>", destination 'ethereum' or 'bitcoin'. */
  "token-destination",
  /**
   * A validator's operator address (lower case), as blocks name the miner;
   * '' is the total across validators (no row is written for it).
   */
  "validator",
])

export type ScanDimensionKind = z.infer<typeof scanDimensionKindSchema>

export const scanMetricDefinitionSchema = z.object({
  dimension: scanDimensionKindSchema,
  /** `amount`: a base-unit integer; `count`: a plain count. */
  unit: z.enum(["amount", "count"]),
  /**
   * Decimals of an amount: a number, or `token` when they are the
   * dimension's token's (the client looks them up); null for counts.
   */
  decimals: z
    .union([z.number().int().min(0).max(36), z.literal("token")])
    .nullable(),
  /** `flow`: the day's movement; `level`: the closing value of the day. */
  kind: z.enum(["flow", "level"]),
  signed: z.boolean(),
  /**
   * False for series filled only by a one-time backfill: the response then
   * says the series ends on its last day (`endsOn`).
   */
  liveWriter: z.boolean(),
})

export type ScanMetricDefinition = z.infer<typeof scanMetricDefinitionSchema>

type Unit = ScanMetricDefinition["unit"]
type Kind = ScanMetricDefinition["kind"]

function metric(
  dimension: ScanDimensionKind,
  kind: Kind,
  options: {
    unit?: Unit
    decimals?: ScanMetricDefinition["decimals"]
    signed?: boolean
    liveWriter?: boolean
  } = {},
): ScanMetricDefinition {
  const unit = options.unit ?? "amount"
  return {
    dimension,
    unit,
    decimals:
      options.decimals === undefined
        ? unit === "count"
          ? null
          : 18
        : options.decimals,
    kind,
    signed: options.signed ?? false,
    liveWriter: options.liveWriter ?? true,
  }
}

const backfill = { liveWriter: false } as const
const perToken = { decimals: "token" } as const

/** Every series `daily` holds. */
export const scanMetrics: Readonly<Record<string, ScanMetricDefinition>> = {
  // Copy step: computed from copied warehouse rows, per UTC day.
  "dex.swaps": metric("pool", "flow", { unit: "count" }),
  "votes.transactions": metric("voter-source", "flow", { unit: "count" }),
  "incentives.deposited": metric("token", "flow", perToken),
  "fees.voters": metric("token", "flow", perToken),
  "emissions.minted": metric("total", "flow"),
  "emissions.rebase": metric("total", "flow"),
  "emissions.gauge_rewards": metric("total", "flow"),
  "locks.deposited": metric("escrow", "flow"),
  "locks.withdrawn": metric("escrow", "flow"),
  "locks.net": metric("escrow", "flow", { signed: true }),
  "locks.created": metric("escrow", "flow", { unit: "count" }),
  "musd.debt_change": metric("total", "flow", { signed: true }),
  "musd.coll_change": metric("total", "flow", { signed: true }),
  "morpho.supply_change": metric("market", "flow", {
    signed: true,
    decimals: "token",
  }),
  "morpho.borrow_change": metric("market", "flow", {
    signed: true,
    decimals: "token",
  }),
  "morpho.collateral_change": metric("market", "flow", {
    signed: true,
    decimals: "token",
  }),
  "savings.deposited": metric("total", "flow"),
  "savings.withdrawn": metric("total", "flow"),
  "savings.net": metric("total", "flow", { signed: true }),
  "savings.yield_claimed": metric("total", "flow"),
  "musd.borrowed": metric("total", "flow"),
  "musd.repaid": metric("total", "flow"),
  "musd.redeemed": metric("total", "flow"),
  "musd.liquidated": metric("total", "flow"),
  // Live snapshot: the day's closing value.
  "pool.balance": metric("pool-token", "level", perToken),
  "token.total_supply": metric("token", "level", perToken),
  "musd.trove_debt": metric("total", "level"),
  "musd.trove_coll": metric("total", "level"),
  "musd.stability_pool": metric("total", "level"),
  "morpho.total_supply": metric("market", "level", perToken),
  "morpho.total_borrow": metric("market", "level", perToken),
  "morpho.total_collateral": metric("market", "level", perToken),
  "escrow.supply": metric("escrow", "level"),
  "pool.token_balance": metric("token", "level", perToken),
  // Once a day: Blockscout (through the API) and Mezo's subgraphs.
  "chain.transactions": metric("total", "flow", { unit: "count" }),
  "chain.transactions_total": metric("total", "level", { unit: "count" }),
  "chain.addresses_total": metric("total", "level", { unit: "count" }),
  "token.holders": metric("token", "level", { unit: "count" }),
  "token.transfers_total": metric("token", "level", { unit: "count" }),
  "chain.blocks_proposed": metric("validator", "flow", { unit: "count" }),
  "chain.blocks": metric("total", "flow", { unit: "count" }),
  "chain.block_height": metric("total", "level", { unit: "count" }),
  "chain.block_height_time": metric("total", "level", { unit: "count" }),
  "chain.blocks_proposed_total": metric("validator", "level", {
    unit: "count",
  }),
  "dex.volume_in": metric("pool-token", "flow", perToken),
  "dex.fees": metric("pool-token", "flow", perToken),
  "dex.token_volume_in": metric("token", "flow", perToken),
  "fees.chain_vebtc": metric("total", "flow"),
  "emissions.rebase_distributed": metric("total", "flow"),
  "bridge.in": metric("token", "flow", perToken),
  "bridge.in_count": metric("token", "flow", { unit: "count" }),
  "bridge.out": metric("token-destination", "flow", perToken),
  "bridge.out_count": metric("token-destination", "flow", { unit: "count" }),
  // One-time backfills only: each ends on its last backfilled day.
  "chain.active_addresses": metric("total", "flow", {
    unit: "count",
    ...backfill,
  }),
  "chain.new_addresses": metric("total", "flow", {
    unit: "count",
    ...backfill,
  }),
  "chain.addresses_cumulative": metric("total", "level", {
    unit: "count",
    ...backfill,
  }),
  "token.transfers": metric("token", "flow", { unit: "count", ...backfill }),
  "token.transfer_volume": metric("token", "flow", {
    ...perToken,
    ...backfill,
  }),
  "token.minted": metric("token", "flow", { ...perToken, ...backfill }),
  "token.burned": metric("token", "flow", { ...perToken, ...backfill }),
  "token.holders_replayed": metric("token", "level", {
    unit: "count",
    ...backfill,
  }),
}

/** What a metric measures, its source, and the first day it can have. */
export type ScanMetricNote = {
  definition: string
  source: string
  /** YYYY-MM-DD, or the event that starts the series. */
  firstDay: string
}

const copy = "jobs copy step (warehouse rows)"
const live =
  "jobs live snapshot, read at the snapshot block on the :00, :30 and day-closing runs; the run that supplied the close is scan_cursors close:<day> ('HH:MM block N')"
const counters =
  "Blockscout counters via the API proxy, read up to 3 h after midnight UTC as the previous day's close; the read time is scan_cursors counters:<day>"
const once = "backfill script only; no live writer"

function note(
  definition: string,
  source: string,
  firstDay: string,
): ScanMetricNote {
  return { definition, source, firstDay }
}

/**
 * How to read a `level` series. A level has a row only for days its source
 * was read: a day with no row is unknown, never zero, and the writers do
 * not carry the last value forward. Carrying it forward (or showing the
 * gap) is the reader's job, and the reader should say which it did.
 */
export const scanLevelGaps =
  "A level series has no row for a day its source was not read; the gap is unknown, not zero. The reader carries the last value forward or shows the gap; the writers never fill it."

/** Definitions of every metric in `scanMetrics`. */
export const scanMetricNotes: Readonly<Record<string, ScanMetricNote>> = {
  "dex.swaps": note(
    "Swaps on a basic pool that day (CL swaps are not in the warehouse)",
    copy,
    "warehouse start",
  ),
  "votes.transactions": note(
    "Distinct vote transactions per voter that day",
    copy,
    "warehouse start",
  ),
  "incentives.deposited": note(
    "Incentive (Bribe) deposits made that day, whatever epoch they fund",
    copy,
    "warehouse start",
  ),
  "fees.voters": note(
    "Fees passed to voters (Fee deposits) made that day",
    copy,
    "warehouse start",
  ),
  "emissions.minted": note(
    "MEZO emitted in that day's EpochProcessed",
    copy,
    "first EpochProcessed",
  ),
  "emissions.rebase": note(
    "MEZO rebase in that day's EpochProcessed",
    copy,
    "first EpochProcessed",
  ),
  "emissions.gauge_rewards": note(
    "MEZO for gauges in that day's EpochProcessed",
    copy,
    "first EpochProcessed",
  ),
  "locks.deposited": note(
    "Amount locked (created or increased) that day",
    copy,
    "block 7,740,000 (escrow history start)",
  ),
  "locks.withdrawn": note(
    "Amount withdrawn from locks that day",
    copy,
    "block 7,740,000",
  ),
  "locks.net": note(
    "Deposited minus withdrawn; on vebtc, net BTC locked",
    copy,
    "block 7,740,000",
  ),
  "locks.created": note("Locks created that day", copy, "block 7,740,000"),
  "musd.debt_change": note(
    "Sum of trove debt changes that day",
    copy,
    "block 178,630",
  ),
  "musd.coll_change": note(
    "Sum of trove collateral changes that day, BTC",
    copy,
    "block 178,630",
  ),
  "morpho.supply_change": note(
    "Supplied minus withdrawn, plus interest, minus bad debt (loan token)",
    copy,
    "block 9,206,917",
  ),
  "morpho.borrow_change": note(
    "Borrowed minus repaid and liquidated, plus interest, minus bad debt",
    copy,
    "block 9,206,917",
  ),
  "morpho.collateral_change": note(
    "Collateral supplied minus withdrawn and seized (collateral token)",
    copy,
    "block 9,206,917",
  ),
  "savings.deposited": note(
    "MUSD deposited in the savings vault that day",
    copy,
    "warehouse start",
  ),
  "savings.withdrawn": note(
    "MUSD withdrawn from the savings vault that day",
    copy,
    "warehouse start",
  ),
  "savings.net": note("Deposited minus withdrawn", copy, "warehouse start"),
  "savings.yield_claimed": note(
    "Savings vault yield claimed that day",
    copy,
    "warehouse start",
  ),
  "musd.borrowed": note(
    "Trove debt added by borrowers that day (loans opened, borrowed against and refinanced): MUSD minted, borrowing fees and each opened loan's 200 MUSD gas compensation included",
    copy,
    "block 178,630",
  ),
  "musd.repaid": note(
    "Trove debt borrowers paid back that day (repayments and closed loans, a closed loan's 200 MUSD gas compensation included)",
    copy,
    "block 178,630",
  ),
  "musd.redeemed": note(
    "Trove debt cancelled by redemptions that day",
    copy,
    "block 178,630",
  ),
  "musd.liquidated": note(
    "Liquidated troves' recorded debt that day: pending redistribution gains left out, and debt the Stability Pool absorbed and debt redistributed to other troves alike",
    copy,
    "block 178,630",
  ),
  "pool.balance": note(
    "The pool's balanceOf each token at the close, basic and CL pools",
    `${live}; backfill: archive-reads`,
    "backfill start",
  ),
  "token.total_supply": note(
    "totalSupply() at the close (BTC: its native supply on Mezo)",
    `${live}; backfill: archive-reads`,
    "backfill start",
  ),
  "pool.token_balance": note(
    "pool.balance summed over every basic and CL pool, per token, at the close",
    `${live}; backfill: market-rollups (from pool.balance rows)`,
    "backfill start",
  ),
  "musd.trove_debt": note(
    "Open troves' principal plus interest at the close",
    live,
    "first live day",
  ),
  "musd.trove_coll": note(
    "Open troves' collateral at the close, BTC",
    live,
    "first live day",
  ),
  "musd.stability_pool": note(
    "MUSD in the Stability Pool at the close",
    live,
    "first live day",
  ),
  "morpho.total_supply": note(
    "Market total supply assets at the close",
    live,
    "first live day",
  ),
  "morpho.total_borrow": note(
    "Market total borrow assets at the close",
    live,
    "first live day",
  ),
  "morpho.total_collateral": note(
    "Sum of the market's positions' collateral at the close",
    live,
    "first live day",
  ),
  "escrow.supply": note("Escrow supply() at the close", live, "first live day"),
  "chain.transactions": note(
    "Validated transactions that UTC day",
    "Blockscout's 30-day chart via the API, re-read daily; backfill: blockscout-transactions",
    "chain start (backfill)",
  ),
  "chain.transactions_total": note(
    "Blockscout's total transactions at the close",
    counters,
    "first live day",
  ),
  "chain.addresses_total": note(
    "Blockscout's total addresses at the close (every address it has seen)",
    counters,
    "first live day",
  ),
  "token.holders": note(
    "Blockscout's holder count at the close",
    counters,
    "first live day",
  ),
  "token.transfers_total": note(
    "Blockscout's transfer count at the close",
    counters,
    "first live day",
  ),
  "chain.blocks_proposed": note(
    "Blocks the validator proposed between two daily reads of its Blockscout counter (read 00:00 to 03:00 UTC, so a day's edges are off by up to three hours); no row for a first read, a missed day or a counter that went down",
    counters,
    "the second live day",
  ),
  "chain.blocks": note(
    "Blocks produced between two daily reads of Blockscout's newest block height (read 00:00 to 03:00 UTC, the same read the validators' counts follow): the denominator of each validator's share; no row for a first read, a missed day or a height that went down",
    counters,
    "the second live day",
  ),
  "chain.block_height": note(
    "Blockscout's newest block height at the daily read",
    counters,
    "first live day",
  ),
  "chain.block_height_time": note(
    "The unix time of that newest block, for block time over the real span between two reads",
    counters,
    "first live day",
  ),
  "chain.blocks_proposed_total": note(
    "Blockscout's validations_count for the validator at the read: every block it has proposed",
    counters,
    "first live day",
  ),
  "dex.volume_in": note(
    "Input side of each swap (each swap counted once), basic and CL pools",
    "earn-pools-mezo subgraph, daily; backfill: subgraphs --series dex",
    "2025-05-28",
  ),
  "dex.fees": note(
    "Fees the pool charged (basic: Fees events; CL: swap and flash fees)",
    "earn-pools-mezo subgraph, daily; backfill: subgraphs --series dex",
    "2025-05-28",
  ),
  "dex.token_volume_in": note(
    "dex.volume_in summed over every basic and CL pool, per token",
    "earn-pools-mezo subgraph, daily; backfill: market-rollups (from dex.volume_in rows) or subgraphs --series dex",
    "2025-05-28",
  ),
  "fees.chain_vebtc": note(
    "BTC chain fees distributed to veBTC holders",
    "earn-locks-mezo subgraph, daily; backfill: subgraphs --series fees",
    "2025-12-11",
  ),
  "emissions.rebase_distributed": note(
    "MEZO rebase distributed to veMEZO holders",
    "earn-locks-mezo subgraph, daily; backfill: subgraphs --series fees",
    "2025-12-11",
  ),
  "bridge.in": note(
    "Assets locked on Ethereum for Mezo, per Ethereum token",
    "mezo-bridge-mainnet subgraph, daily; backfill: subgraphs --series bridge-in",
    "2025-05-06",
  ),
  "bridge.in_count": note(
    "Bridge deposits that day",
    "mezo-bridge-mainnet subgraph, daily; backfill",
    "2025-05-06",
  ),
  "bridge.out": note(
    "Assets unlocked out of Mezo, per token and destination",
    "mezo-bridge-out-mezo subgraph, daily; backfill: subgraphs --series bridge-out",
    "2025-09-15",
  ),
  "bridge.out_count": note(
    "Bridge withdrawals that day",
    "mezo-bridge-out-mezo subgraph, daily; backfill",
    "2025-09-15",
  ),
  "chain.active_addresses": note(
    "Distinct from, to and created addresses of that day's transactions",
    `${once} (blockscout-transactions)`,
    "chain start",
  ),
  "chain.new_addresses": note(
    "Addresses first seen as a transaction party that day",
    `${once} (blockscout-transactions)`,
    "chain start",
  ),
  "chain.addresses_cumulative": note(
    "Addresses seen as a transaction party up to the close",
    `${once} (blockscout-transactions)`,
    "chain start",
  ),
  "token.transfers": note(
    "Transfer events that day (not BTC: native sends emit none)",
    `${once} (subgraphs, erc20-logs)`,
    "token start",
  ),
  "token.transfer_volume": note(
    "Sum of Transfer values that day",
    `${once} (subgraphs, erc20-logs)`,
    "token start",
  ),
  "token.minted": note(
    "Transfers from the zero address that day",
    `${once} (subgraphs, erc20-logs)`,
    "token start",
  ),
  "token.burned": note(
    "Transfers to the zero address that day",
    `${once} (subgraphs, erc20-logs)`,
    "token start",
  ),
  "token.holders_replayed": note(
    "Addresses with a positive replayed balance at the close (not BTC)",
    `${once} (subgraphs, erc20-logs)`,
    "token start",
  ),
}

/** The definition of a registered metric, or null. */
export function scanMetricDefinition(
  name: string,
): ScanMetricDefinition | null {
  return Object.hasOwn(scanMetrics, name) ? (scanMetrics[name] ?? null) : null
}

/**
 * Whether the copy step's day aggregates write the metric: only then does
 * a day still to recompute (scan_dirty) leave its value open to change.
 * Live closes, subgraph days, counters and backfills are not recomputed,
 * so a dirty day leaves them whole. An unnoted metric counts as one.
 */
export function scanMetricRecomputed(name: string): boolean {
  const note = Object.hasOwn(scanMetricNotes, name)
    ? scanMetricNotes[name]
    : undefined
  return note === undefined || note.source === copy
}

const address = /^0x[0-9a-f]{40}$/
const marketId = /^0x[0-9a-f]{64}$/

/** Whether `dimension` has the shape its metric's kind calls for. */
export function scanDimensionMatches(
  kind: ScanDimensionKind,
  dimension: string,
): boolean {
  switch (kind) {
    case "total":
      return dimension === ""
    case "pool-token": {
      const [pool, token, extra] = dimension.split(":")
      return (
        extra === undefined &&
        pool !== undefined &&
        token !== undefined &&
        address.test(pool) &&
        address.test(token)
      )
    }
    case "pool":
    case "token":
      return dimension === "" || address.test(dimension)
    case "escrow":
      return dimension === "vebtc" || dimension === "vemezo"
    case "market":
      return dimension === "" || marketId.test(dimension)
    case "voter-source":
      return /^[A-Z_]{1,40}$/.test(dimension) || dimension === ""
    // '' asks for the total across validators, as for pools and tokens.
    case "validator":
      return dimension === "" || address.test(dimension)
    case "token-destination": {
      const [token, destination, extra] = dimension.split(":")
      return (
        extra === undefined &&
        token !== undefined &&
        address.test(token) &&
        (destination === "ethereum" || destination === "bitcoin")
      )
    }
  }
}

/** Longest range one series request may cover. */
export const scanSeriesMaxDays = 732
