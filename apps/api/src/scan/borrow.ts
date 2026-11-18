import {
  type ScanBorrowEventItem,
  type ScanEnclaveEventItem,
  type ScanLiquidationItem,
  type ScanMorphoPosition,
  type ScanTrove,
  scanBorrowEventsMax,
} from "@matchbox/contracts/scan"
import { PlatformError } from "@matchbox/server"
import type { Hono } from "hono"
import { z } from "zod"
import { callerOf } from "../blockscout/endpoint"
import type { ApiContext, ApiEnv } from "../context"
import {
  type MarketRow,
  marketView,
  morphoPositionView,
  type PositionRow,
  type TrovePrice,
  type TroveRow,
  trovePriceOf,
  troveView,
} from "./borrow-math"
import {
  addressParam,
  page,
  pageParams,
  pathParam,
  queryOf,
  type ScanContext,
} from "./context"
import { CursorCodec, keyPart } from "./cursor"
import {
  enclaveItem,
  morphoEventItem,
  RowShapeError,
  troveEventItem,
} from "./items"
import { knownMarketDecimals, marketDecimalsOf } from "./market-decimals"
import { maxKey, scanQueries } from "./queries"

// /internal/scan/borrow: live Borrow state from READ_DB (the */5 live
// snapshot), with health computed at read time from the current BTC price,
// and history from matchbox-scan's event tables.

const integerText = z.string().regex(/^(0|[1-9][0-9]*)$/)

export const marketRowSchema: z.ZodType<MarketRow> = z.object({
  market_id: z.string().regex(/^0x[0-9a-f]{64}$/),
  loan_token: z.string(),
  collateral_token: z.string(),
  oracle: z.string(),
  irm: z.string(),
  lltv_raw: integerText,
  total_supply_assets_raw: integerText,
  total_supply_shares_raw: integerText,
  total_borrow_assets_raw: integerText,
  total_borrow_shares_raw: integerText,
  fee_raw: integerText,
  borrow_rate_raw: integerText.nullable(),
  oracle_price_raw: integerText.nullable(),
  block: z.number().int(),
  updated_at: z.number().int(),
})

export const positionRowSchema: z.ZodType<PositionRow> = z.object({
  market_id: z.string().regex(/^0x[0-9a-f]{64}$/),
  account: z.string(),
  supply_shares_raw: integerText,
  borrow_shares_raw: integerText,
  collateral_raw: integerText,
  block: z.number().int(),
  updated_at: z.number().int(),
})

export const troveRowSchema: z.ZodType<TroveRow> = z.object({
  owner: z.string(),
  status: z.string(),
  coll_raw: integerText,
  principal_raw: integerText,
  interest_raw: integerText,
  interest_rate: z.number().int(),
  block: z.number().int(),
  updated_at: z.number().int(),
})

const stabilityRowSchema = z.object({
  total_musd_deposits_raw: integerText,
  total_collateral_raw: integerText,
  block: z.number().int(),
  updated_at: z.number().int(),
})

export function rowOf<T>(schema: z.ZodType<T>, raw: unknown, table: string): T {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new RowShapeError(table)
  return parsed.data
}

const marketIdParam = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value.toLowerCase())

const positionIdParam = z.string().regex(/^[0-9a-zA-Z:_-]{1,100}$/)

const blockLogKey = z.tuple([keyPart.block, keyPart.logIndex])

export const borrowCodecs = {
  positions: new CursorCodec("positions", z.tuple([keyPart.address])),
  troves: new CursorCodec("troves", z.tuple([keyPart.address])),
  marketEvents: new CursorCodec("market-events", blockLogKey),
  positionEvents: new CursorCodec("position-events", blockLogKey),
  troveEvents: new CursorCodec("trove-events", blockLogKey),
  liquidations: new CursorCodec("liquidations", blockLogKey),
  redemptions: new CursorCodec("redemptions", blockLogKey),
  enclave: new CursorCodec(
    "enclave",
    z.tuple([keyPart.block, keyPart.logIndex, keyPart.tokenId]),
  ),
} as const

/** Current BTC price in USD as a decimal string, or null. */
async function btcUsd(scan: ScanContext): Promise<string | null> {
  try {
    return (await scan.deps.readPrices())?.btc?.usd ?? null
  } catch {
    return null
  }
}

async function markets(
  scan: ScanContext,
): Promise<{ rows: MarketRow[]; skipped: number }> {
  const rows = await scan.rows(scanQueries.markets, [scan.deps.network])
  return scan.mapRows(rows, (row) =>
    rowOf(marketRowSchema, row, "morpho_markets"),
  )
}

async function market(scan: ScanContext, id: string): Promise<MarketRow> {
  const row = await scan.first(scanQueries.market, [scan.deps.network, id])
  if (row === null) throw new PlatformError("not_found")
  return rowOf(marketRowSchema, row, "morpho_markets")
}

/** MUSD's PriceFeed price from the live snapshot's stability_pool row. */
async function trovePrice(scan: ScanContext): Promise<TrovePrice | null> {
  const row = await scan.first(scanQueries.stabilityPool, [scan.deps.network])
  return trovePriceOf(row)
}

/** An owner's Morpho positions and trove, priced now. */
export async function ownerPositions(
  scan: ScanContext,
  owner: string,
): Promise<{
  morpho: ScanMorphoPosition[]
  trove: ScanTrove | null
  price: string | null
}> {
  const [positionRows, marketRows, troveRow, price, feed] = await Promise.all([
    scan.rows(scanQueries.positionsByAccount, [scan.deps.network, owner]),
    markets(scan),
    scan.first(scanQueries.trove, [scan.deps.network, owner]),
    btcUsd(scan),
    trovePrice(scan),
  ])
  const byId = new Map(marketRows.rows.map((row) => [row.market_id, row]))
  const morpho = scan
    .mapRows(positionRows, (raw) =>
      rowOf(positionRowSchema, raw, "morpho_positions"),
    )
    .rows.flatMap((position) => {
      const owning = byId.get(position.market_id)
      return owning === undefined ? [] : [morphoPositionView(position, owning)]
    })
  const trove =
    troveRow === null
      ? null
      : troveView(rowOf(troveRowSchema, troveRow, "troves"), feed)
  return {
    morpho,
    trove: trove !== null && trove.status === "active" ? trove : null,
    price,
  }
}

/** The latest event of each Enclave position a borrower touched. */
export async function enclavePositions(
  scan: ScanContext,
  borrower: string,
): Promise<{ position_id: string; latest: ScanEnclaveEventItem }[]> {
  const rows = await scan.rows(scanQueries.enclaveByBorrower, [
    borrower,
    maxKey,
    maxKey,
    "",
    100,
  ])
  const latest = new Map<string, ScanEnclaveEventItem>()
  for (const event of scan.mapRows(rows, enclaveItem).rows) {
    if (event.position_id !== null && !latest.has(event.position_id)) {
      latest.set(event.position_id, event)
    }
  }
  return [...latest].map(([position_id, event]) => ({
    position_id,
    latest: event,
  }))
}

/**
 * A market with its tokens' decimals: on chain (morpho_known_markets),
 * else the registry, else null. Amounts stay raw either way.
 */
function withDecimals(
  row: MarketRow,
  known: Awaited<ReturnType<typeof knownMarketDecimals>>,
) {
  const decimals = marketDecimalsOf(known, row)
  return {
    ...marketView(row),
    loan_decimals: decimals.loan,
    collateral_decimals: decimals.collateral,
  }
}

/** Enclave rows read per statement, and statements at most. */
const enclaveEventPage = 100
const enclaveEventPages = 5

/** An Enclave row's event, read from the stored row before its schema. */
type EventKey = {
  txHash: string
  blockNumber: number
  logIndex: number
  timestamp: number
}

function eventKey(raw: unknown): EventKey | null {
  if (typeof raw !== "object" || raw === null) return null
  const { tx_hash, block_number, log_index, timestamp } = raw as Record<
    string,
    unknown
  >
  return typeof tx_hash === "string" &&
    typeof block_number === "number" &&
    typeof log_index === "number" &&
    typeof timestamp === "number"
    ? {
        txHash: tx_hash,
        blockNumber: block_number,
        logIndex: log_index,
        timestamp,
      }
    : null
}

const sameEvent = (a: EventKey | null, b: EventKey | null): boolean =>
  a !== null &&
  b !== null &&
  a.txHash === b.txHash &&
  a.blockNumber === b.blockNumber &&
  a.logIndex === b.logIndex

/**
 * The newest `limit` Enclave events, one item per event. An event that
 * pledges several veBTC is a row per lock, its amount on one of them:
 * the rows are merged, keeping a non-null amount. A page that ends inside
 * an event is read again from that event's first row, so no event is cut
 * and the answer is never short while older rows exist. Rows are grouped
 * and paged by their stored keys, and mapped only once kept, so a row
 * that fails its schema is counted once and never ends the scan.
 */
async function latestEnclaveEvents(
  scan: ScanContext,
  limit: number,
): Promise<{ events: ScanEnclaveEventItem[]; skipped: number }> {
  const events: ScanEnclaveEventItem[] = []
  let skipped = 0
  let key: readonly number[] = [maxKey, maxKey, maxKey]
  for (let page = 0; page < enclaveEventPages; page += 1) {
    const raws = await scan.rows(scanQueries.enclaveEventsByTime, [
      ...key,
      enclaveEventPage,
    ])
    const groups: { key: EventKey | null; raws: unknown[] }[] = []
    for (const raw of raws) {
      const rowKey = eventKey(raw)
      const last = groups.at(-1)
      if (last !== undefined && sameEvent(last.key, rowKey)) {
        last.raws.push(raw)
      } else {
        groups.push({ key: rowKey, raws: [raw] })
      }
    }
    const full = raws.length === enclaveEventPage
    // The last event may go on past this page: read it again next time,
    // unless it is the only one (then it is kept as read).
    const tail = full && groups.length > 1 ? groups.pop() : undefined
    for (const group of groups) {
      if (events.length === limit) break
      const mapped = scan.mapRows(group.raws, enclaveItem)
      skipped += mapped.skipped
      const [first] = mapped.rows
      if (first === undefined) continue
      const withAmount = mapped.rows.find((row) => row.amount !== null) ?? first
      events.push({ ...first, amount: withAmount.amount })
    }
    if (events.length === limit || !full) break
    // From the cut event's first row (inclusive), or past the last event.
    // A row whose keys cannot be read cannot be paged past: stop there.
    const next = tail === undefined ? groups.at(-1)?.key : tail.key
    if (next === null || next === undefined) break
    key =
      tail === undefined
        ? [next.timestamp, next.blockNumber, next.logIndex - 1]
        : [next.timestamp, next.blockNumber, next.logIndex]
  }
  return { events, skipped }
}

export function registerScanBorrow(app: Hono<ApiEnv>, scan: ScanContext): void {
  /** Live state: keyed by the live snapshot's slot. */
  function live(
    c: ApiContext,
    render: () => Promise<unknown>,
    extraVersion = "",
  ): Promise<Response> {
    const url = new URL(c.req.url)
    return scan.responder.serve(c, {
      cacheClass: "live",
      resource: `${url.pathname}${url.search}`,
      version: `${scan.liveVersion()}${extraVersion}`,
      caller: callerOf(c),
      // Every live answer says how old the snapshot behind it is.
      render: async () => {
        const [body, snapshot] = await Promise.all([
          render(),
          scan.liveSnapshot(),
        ])
        return {
          body:
            typeof body === "object" && body !== null
              ? { ...body, snapshot }
              : body,
          // A head the clock missed (a hub just woken) is not kept for the
          // live slot: the next answer reads it again.
          store: !(snapshot.head === null && snapshot.block !== null),
        }
      },
    })
  }

  async function history(
    c: ApiContext,
    render: () => Promise<unknown>,
  ): Promise<Response> {
    const url = new URL(c.req.url)
    const run = await scan.runVersion()
    return scan.responder.serve(c, {
      cacheClass: "run",
      resource: `${url.pathname}${url.search}`,
      version: `r${run.id}`,
      caller: callerOf(c),
      render: async () => ({ body: await render() }),
    })
  }

  app.get("/internal/scan/borrow/markets", (c) => {
    queryOf(c, {})
    return live(c, async () => {
      const [found, known] = await Promise.all([
        markets(scan),
        knownMarketDecimals(scan),
      ])
      return {
        data: found.rows.map((row) => withDecimals(row, known)),
        meta: { skipped: found.skipped },
      }
    })
  })

  app.get("/internal/scan/borrow/markets/:market", (c) => {
    const id = pathParam(c, "market", marketIdParam)
    queryOf(c, {})
    return live(c, async () => {
      const [row, known] = await Promise.all([
        market(scan, id),
        knownMarketDecimals(scan),
      ])
      return { data: withDecimals(row, known) }
    })
  })

  app.get("/internal/scan/borrow/markets/:market/positions", (c) => {
    const id = pathParam(c, "market", marketIdParam)
    const params = queryOf(c, pageParams)
    return live(c, async () => {
      const owning = await market(scan, id)
      return page(scan, {
        query: scanQueries.positionsByMarket,
        codec: borrowCodecs.positions,
        cursor: params.cursor,
        limit: params.limit,
        binds: (key, limit) => [scan.deps.network, id, ...(key ?? [""]), limit],
        row: (raw) => rowOf(positionRowSchema, raw, "morpho_positions"),
        keyOf: (row) => [row.account.toLowerCase()] as const,
        item: (row) => morphoPositionView(row, owning),
      })
    })
  })

  app.get("/internal/scan/borrow/markets/:market/events", (c) => {
    const id = pathParam(c, "market", marketIdParam)
    const params = queryOf(c, pageParams)
    return history(c, () =>
      page(scan, {
        query: scanQueries.morphoEventsByMarket,
        codec: borrowCodecs.marketEvents,
        cursor: params.cursor,
        limit: params.limit,
        binds: (key, limit) => [id, ...(key ?? [maxKey, maxKey]), limit],
        row: morphoEventItem,
        keyOf: (row) => [row.block_number, row.log_index] as const,
        item: (row) => row,
      }),
    )
  })

  app.get(
    "/internal/scan/borrow/markets/:market/positions/:account/events",
    (c) => {
      const id = pathParam(c, "market", marketIdParam)
      const account = pathParam(c, "account", addressParam)
      const params = queryOf(c, pageParams)
      return history(c, () =>
        page(scan, {
          query: scanQueries.morphoEventsByPosition,
          codec: borrowCodecs.positionEvents,
          cursor: params.cursor,
          limit: params.limit,
          binds: (key, limit) => [
            account,
            id,
            ...(key ?? [maxKey, maxKey]),
            limit,
          ],
          row: morphoEventItem,
          keyOf: (row) => [row.block_number, row.log_index] as const,
          item: (row) => row,
        }),
      )
    },
  )

  app.get("/internal/scan/borrow/owners/:address", (c) => {
    const owner = pathParam(c, "address", addressParam)
    queryOf(c, {})
    return (async () => {
      const run = await scan.runVersion()
      return live(
        c,
        async () => {
          const [positions, enclave] = await Promise.all([
            ownerPositions(scan, owner),
            enclavePositions(scan, owner),
          ])
          return {
            data: {
              owner,
              morpho: positions.morpho,
              trove: positions.trove,
              enclave,
              btc_usd: positions.price,
            },
          }
        },
        `-r${run.id}`,
      )
    })()
  })

  app.get("/internal/scan/borrow/enclave/positions/:position/events", (c) => {
    const position = pathParam(c, "position", positionIdParam)
    const params = queryOf(c, pageParams)
    return history(c, () =>
      page(scan, {
        query: scanQueries.enclaveByPosition,
        codec: borrowCodecs.enclave,
        cursor: params.cursor,
        limit: params.limit,
        binds: (key, limit) => [
          position,
          ...(key ?? [maxKey, maxKey, ""]),
          limit,
        ],
        row: enclaveItem,
        keyOf: (row) =>
          [row.block_number, row.log_index, row.ve_btc_token_id] as const,
        item: (row) => row,
      }),
    )
  })

  app.get("/internal/scan/borrow/enclave/borrowers/:address/events", (c) => {
    const borrower = pathParam(c, "address", addressParam)
    const params = queryOf(c, pageParams)
    return history(c, () =>
      page(scan, {
        query: scanQueries.enclaveByBorrower,
        codec: borrowCodecs.enclave,
        cursor: params.cursor,
        limit: params.limit,
        binds: (key, limit) => [
          borrower,
          ...(key ?? [maxKey, maxKey, ""]),
          limit,
        ],
        row: enclaveItem,
        keyOf: (row) =>
          [row.block_number, row.log_index, row.ve_btc_token_id] as const,
        item: (row) => row,
      }),
    )
  })

  app.get("/internal/scan/borrow/troves", (c) => {
    const params = queryOf(c, pageParams)
    return live(c, async () => {
      const price = await trovePrice(scan)
      return page(scan, {
        query: scanQueries.openTroves,
        codec: borrowCodecs.troves,
        cursor: params.cursor,
        limit: params.limit,
        binds: (key, limit) => [scan.deps.network, ...(key ?? [""]), limit],
        row: (raw) => rowOf(troveRowSchema, raw, "troves"),
        keyOf: (row) => [row.owner.toLowerCase()] as const,
        item: (row) => troveView(row, price),
      })
    })
  })

  app.get("/internal/scan/borrow/troves/:owner", (c) => {
    const owner = pathParam(c, "owner", addressParam)
    queryOf(c, {})
    return live(c, async () => {
      const [row, price] = await Promise.all([
        scan.first(scanQueries.trove, [scan.deps.network, owner]),
        trovePrice(scan),
      ])
      if (row === null) throw new PlatformError("not_found")
      return { data: troveView(rowOf(troveRowSchema, row, "troves"), price) }
    })
  })

  app.get("/internal/scan/borrow/troves/:owner/events", (c) => {
    const owner = pathParam(c, "owner", addressParam)
    const params = queryOf(c, pageParams)
    return history(c, () =>
      page(scan, {
        query: scanQueries.troveEventsByBorrower,
        codec: borrowCodecs.troveEvents,
        cursor: params.cursor,
        limit: params.limit,
        binds: (key, limit) => [owner, ...(key ?? [maxKey, maxKey]), limit],
        row: troveEventItem,
        keyOf: (row) => [row.block_number, row.log_index] as const,
        item: (row) => row,
      }),
    )
  })

  function troveActionList(
    path: string,
    action: string,
    codec: typeof borrowCodecs.liquidations,
  ) {
    app.get(path, (c) => {
      const params = queryOf(c, pageParams)
      return history(c, () =>
        page(scan, {
          query: scanQueries.troveEventsByAction,
          codec,
          cursor: params.cursor,
          limit: params.limit,
          binds: (key, limit) => [action, ...(key ?? [maxKey, maxKey]), limit],
          row: troveEventItem,
          keyOf: (row) => [row.block_number, row.log_index] as const,
          item: (row) => row,
        }),
      )
    })
  }
  // Liquidations of troves and of Morpho positions, merged newest first:
  // one range scan of each action index with the same (block, log) key.
  app.get("/internal/scan/borrow/liquidations", (c) => {
    const params = queryOf(c, pageParams)
    return history(c, async () => {
      const key = borrowCodecs.liquidations.decode(params.cursor) ?? [
        maxKey,
        maxKey,
      ]
      const [troves, morpho] = await Promise.all([
        scan.rows(scanQueries.troveEventsByAction, [
          "LOAN_LIQUIDATED",
          ...key,
          params.limit + 1,
        ]),
        scan.rows(scanQueries.morphoEventsByAction, [
          "LIQUIDATED",
          ...key,
          params.limit + 1,
        ]),
      ])
      // Merged by each raw row's (block, log) key, bad rows included, so
      // the cursor steps over a bad row instead of stranding what follows.
      const codec = borrowCodecs.liquidations
      const keyed: {
        kind: "trove" | "morpho"
        raw: unknown
        key: readonly [number, number]
      }[] = []
      const unkeyed: { kind: "trove" | "morpho"; raw: unknown }[] = []
      for (const [kind, rows] of [
        ["trove", troves],
        ["morpho", morpho],
      ] as const) {
        for (const raw of rows) {
          const shaped = (raw ?? {}) as {
            block_number?: unknown
            log_index?: unknown
          }
          const rawKey = codec.keyOf([shaped.block_number, shaped.log_index])
          if (rawKey === null) unkeyed.push({ kind, raw })
          else keyed.push({ kind, raw, key: rawKey })
        }
      }
      keyed.sort(
        (left, right) =>
          right.key[0] - left.key[0] || right.key[1] - left.key[1],
      )
      const window = keyed.slice(0, params.limit)
      let skipped = 0
      const data: ScanLiquidationItem[] = []
      for (const entry of [...window, ...unkeyed]) {
        const mapped =
          entry.kind === "trove"
            ? scan
                .mapRows([entry.raw], troveEventItem)
                .rows.map((row) => ({ kind: "trove" as const, ...row }))
            : scan
                .mapRows([entry.raw], morphoEventItem)
                .rows.map((row) => ({ kind: "morpho" as const, ...row }))
        if (mapped.length === 0) skipped += 1
        // An unkeyed row is never good; it is only logged and counted.
        else if (window.includes(entry as (typeof window)[number])) {
          data.push(...mapped)
        }
      }
      const last = window.at(-1)
      const more =
        keyed.length > params.limit ||
        troves.length > params.limit ||
        morpho.length > params.limit
      return {
        data,
        nextCursor: more && last !== undefined ? codec.encode(last.key) : null,
        meta: { skipped },
      }
    })
  })
  // The latest borrower-facing events of every venue, merged newest
  // first: one range scan of each table's time index. No cursor: the
  // homepage's Latest borrowing reads the newest few.
  app.get("/internal/scan/borrow/events", (c) => {
    const params = queryOf(c, {
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(scanBorrowEventsMax)
        .default(10),
    })
    return history(c, async () => {
      const top = [maxKey, maxKey, maxKey]
      const [troveRaws, morphoRaws, enclaveRead] = await Promise.all([
        scan.rows(scanQueries.troveEventsByTime, [...top, params.limit]),
        scan.rows(scanQueries.morphoEventsByTime, [...top, params.limit]),
        latestEnclaveEvents(scan, params.limit),
      ])
      const troves = scan.mapRows(troveRaws, troveEventItem)
      const morpho = scan.mapRows(morphoRaws, morphoEventItem)
      const items: ScanBorrowEventItem[] = [
        ...troves.rows.map((row) => ({ kind: "trove" as const, ...row })),
        ...morpho.rows.map((row) => ({ kind: "morpho" as const, ...row })),
        ...enclaveRead.events.map((row) => ({
          kind: "enclave" as const,
          ...row,
        })),
      ]
      items.sort(
        (left, right) =>
          right.timestamp - left.timestamp ||
          right.block_number - left.block_number ||
          right.log_index - left.log_index,
      )
      return {
        data: items.slice(0, params.limit),
        meta: {
          skipped: troves.skipped + morpho.skipped + enclaveRead.skipped,
        },
      }
    })
  })
  troveActionList(
    "/internal/scan/borrow/redemptions",
    "LOAN_REDEEMED",
    borrowCodecs.redemptions,
  )

  app.get("/internal/scan/borrow/stability-pool", (c) => {
    queryOf(c, {})
    return live(c, async () => {
      const row = await scan.first(scanQueries.stabilityPool, [
        scan.deps.network,
      ])
      if (row === null) throw new PlatformError("not_found")
      const parsed = rowOf(stabilityRowSchema, row, "stability_pool")
      return {
        data: {
          total_musd_deposits: parsed.total_musd_deposits_raw,
          total_collateral: parsed.total_collateral_raw,
          block: parsed.block,
          updated_at: parsed.updated_at,
        },
      }
    })
  })
}
