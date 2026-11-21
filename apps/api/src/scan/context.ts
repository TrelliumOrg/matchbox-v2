import type { Gauge } from "@matchbox/contracts/market"
import type { Prices } from "@matchbox/contracts/read-models"
import {
  type ScanAggregateMeta,
  type ScanLiveSnapshot,
  type ScanStatusRow,
  scanPageSize,
  scanStatusRowSchema,
} from "@matchbox/contracts/scan"
import type { Logger } from "@matchbox/logger"
import { PlatformError, type RateLimitClient } from "@matchbox/server"
import { z } from "zod"
import type { ChainClock } from "../blockscout/head"
import type { BlockscoutProxy } from "../blockscout/proxy"
import type { ApiContext } from "../context"
import { withinDeadline } from "../read-models/live-claimable"
import type { CursorCodec } from "./cursor"
import { firstOf, RowShapeError, rowKeyOf, rowsOf } from "./items"
import { type ScanChainReaders, ScanLive } from "./live-locks"
import { type KnownGauges, knownGauges, noGauges } from "./live-tx"
import type { MezoIdResolver } from "./mezo-ids"
import { maxKey, type ScanQuery, scanQueries } from "./queries"
import { ScanResponder } from "./serve"

// What every /internal/scan handler shares: the databases, the responder
// (cache and rate limit), data versions for cache keys, and paging.

export type ScanRouteDeps = {
  /** matchbox-scan; null answers 503 on every SCAN_DB route. */
  scanDb: D1Database | null
  /** READ_DB: live Borrow state and Pro's gauge documents. */
  readDb: D1Database | null
  network: "mezo"
  cache: Cache | null
  rateLimits: RateLimitClient | null
  readPrices: () => Promise<Prices | null>
  /**
   * MARKET_DB, for the cross-chain gauges' labels and the owner's
   * destinations; absent leaves pools without their gauge link.
   */
  marketDb?: D1Database | null
  /** The Blockscout proxy, for composed documents; null degrades them. */
  proxy: BlockscoutProxy | null
  clock: () => Promise<ChainClock>
  /** Mezo's accounts API, for `/mezo-ids`; absent answers 503 there. */
  mezoIds?: MezoIdResolver | null
  /**
   * Locks from Mezo RPC, laid over the lock route's stored row and the
   * address document's stored locks (live-locks.ts), on a client of their
   * own. Absent: the stored rows are served as they are.
   */
  chain?: ScanChainReaders | null
  /**
   * This epoch's gauges from the market snapshot, for decoding a live
   * transaction's reward claims and pool votes (live-tx.ts). Absent: those
   * logs show undecoded until the copy has them.
   */
  gauges?: (() => Promise<readonly Gauge[]>) | null
  logger: Logger
  /** Epoch milliseconds. */
  now?: () => number
}

/** How long a data version is reused in an isolate before re-reading. */
const versionMemoMs = 5_000

/** How long the snapshot's gauges are reused for decoding. */
const gaugesMemoMs = 600_000
/**
 * How long a failed snapshot read is remembered: during an outage, live
 * documents decode without gauges rather than each asking again.
 */
const gaugesFailedMs = 30_000
/** One snapshot read past this counts as failed. */
const gaugesReadMs = 2_000

export class ScanContext {
  readonly responder: ScanResponder
  /** Chain reads, each remembered for its minute (live-locks.ts). */
  readonly live: ScanLive
  private run: { at: number; version: Promise<RunVersion> } | null = null
  private gauges: { until: number; known: Promise<KnownGauges> } | null = null

  constructor(readonly deps: ScanRouteDeps) {
    this.responder = new ScanResponder({
      cache: deps.cache,
      rateLimits: deps.rateLimits,
    })
    this.live = new ScanLive({
      readers: deps.chain ?? null,
      cache: deps.cache,
      rateLimits: deps.rateLimits,
      now: () => this.nowMs(),
      logger: deps.logger,
    })
  }

  nowMs(): number {
    return this.deps.now?.() ?? Date.now()
  }

  /**
   * The reward contracts and pools of this epoch's gauges, remembered for
   * ten minutes; none when the snapshot cannot be read in `gaugesReadMs`,
   * remembered for `gaugesFailedMs`.
   */
  knownGauges(): Promise<KnownGauges> {
    const read = this.deps.gauges
    if (read === undefined || read === null) return Promise.resolve(noGauges)
    const now = this.nowMs()
    if (this.gauges === null || now >= this.gauges.until) {
      const known = withinDeadline(read(), gaugesReadMs).then(knownGauges)
      const entry = { until: now + gaugesMemoMs, known }
      this.gauges = entry
      known.catch((error: unknown) => {
        this.deps.logger.warn({ message: "Snapshot gauges unread", error })
        if (this.gauges === entry) {
          this.gauges = {
            until: this.nowMs() + gaugesFailedMs,
            known: Promise.resolve(noGauges),
          }
        }
      })
    }
    return this.gauges.known.catch(() => noGauges)
  }

  nowSeconds(): number {
    return Math.floor(this.nowMs() / 1000)
  }

  scan(): D1Database {
    if (this.deps.scanDb === null) throw new PlatformError("service_disabled")
    return this.deps.scanDb
  }

  read(): D1Database {
    if (this.deps.readDb === null) throw new PlatformError("service_disabled")
    return this.deps.readDb
  }

  db(query: ScanQuery): D1Database {
    return query.db === "scan" ? this.scan() : this.read()
  }

  rows(query: ScanQuery, binds: readonly unknown[]): Promise<unknown[]> {
    return rowsOf(this.db(query), query, binds)
  }

  /**
   * One statement per set of binds, in a single D1 batch (one round
   * trip): each set's first row, or null.
   */
  async firstEach(
    query: ScanQuery,
    bindSets: readonly (readonly unknown[])[],
  ): Promise<(unknown | null)[]> {
    if (bindSets.length === 0) return []
    const db = this.db(query)
    const results = await db.batch(
      bindSets.map((binds) => db.prepare(query.sql).bind(...binds)),
    )
    return results.map((result) => result.results[0] ?? null)
  }

  first(query: ScanQuery, binds: readonly unknown[]): Promise<unknown | null> {
    return firstOf(this.db(query), query, binds)
  }

  /**
   * Where Scan's data stands, remembered for five seconds: from the jobs
   * Worker's `scan_status` row, or from the newest `ok` scan_runs row when
   * the row is absent. Every `run` cache key carries `id`: the last
   * successful copy (`last_ok_at`, never `last_run_at`, which a skipped
   * run moves without changing data) plus the three flags responses
   * report, and `data_version` where the column exists, so entries retire
   * when data or those flags change.
   */
  runVersion(): Promise<RunVersion> {
    const now = this.nowMs()
    if (this.run === null || now - this.run.at >= versionMemoMs) {
      this.run = { at: now, version: this.readRun() }
      this.run.version.catch(() => {
        this.run = null
      })
    }
    return this.run.version
  }

  /**
   * The cache-key version for aggregate answers (epoch_totals, gauge_epoch,
   * lock_votes, daily and its partial flags): the run version plus
   * `scan_status.data_version`, which the jobs Worker bumps in the batch
   * of any write that changed a served row (scan-migrations 0003). The
   * Worker also writes aggregates on a skipped copy run, which leaves
   * `last_ok_at` (and so the run version) where it was. Without that
   * column (before 0003) it falls back to `scan_status.updated_at`, which
   * every run moves.
   */
  async aggregateVersion(): Promise<string> {
    const run = await this.runVersion()
    // run.id already carries data_version where it exists.
    return run.dataVersion === null
      ? `${run.id}-u${run.status?.updated_at ?? 0}`
      : run.id
  }

  /**
   * How far behind the head the live snapshot is (scanLiveSnapshotSchema):
   * the block every live run writes on the stability_pool row
   * (musd_btc_price_block, since jobs 5785d87) against the BlockHub head.
   * One primary-key read and the shared clock, remembered for 5 s.
   */
  liveSnapshot(): Promise<ScanLiveSnapshot> {
    const now = this.nowMs()
    if (this.snapshot === null || now - this.snapshot.at >= versionMemoMs) {
      const value = this.readLiveSnapshot()
      this.snapshot = { at: now, value }
      // A head the clock could not read in time (a hub just woken) is not
      // remembered: the next answer asks again.
      value.then((snapshot) => {
        if (snapshot.head === null && this.snapshot?.value === value) {
          this.snapshot = null
        }
      })
    }
    return this.snapshot.value
  }

  private snapshot: { at: number; value: Promise<ScanLiveSnapshot> } | null =
    null

  private async readLiveSnapshot(): Promise<ScanLiveSnapshot> {
    const [row, clock] = await Promise.all([
      this.deps.readDb === null
        ? Promise.resolve(null)
        : this.first(scanQueries.stabilityPool, [this.deps.network]).catch(
            () => null,
          ),
      this.deps.clock().catch(() => ({ height: null, lastActive: null })),
    ])
    const parsed = snapshotBlockSchema.safeParse(row)
    const block = parsed.success
      ? (parsed.data.musd_btc_price_block ?? null)
      : null
    const head = clock.height
    const behind =
      block === null || head === null ? null : Math.max(0, head - block)
    return {
      block,
      head,
      behind_blocks: behind,
      stale: behind === null ? null : behind > liveSnapshotMaxBehind,
      max_behind_blocks: liveSnapshotMaxBehind,
    }
  }

  /**
   * A Pro read-model document's etag and write time (READ_DB), remembered
   * for five seconds per document like the run version, so the directory
   * routes and name search do not read it on every request.
   */
  readModelVersion(
    kind: "gauges" | "gauge-profile",
    key: string,
  ): Promise<{ etag: string; updated_at: number } | null> {
    const id = `${kind}/${key}`
    const now = this.nowMs()
    const held = this.documentVersions.get(id)
    if (held !== undefined && now - held.at < versionMemoMs) return held.version
    const version = this.first(scanQueries.readModelVersion, [
      this.deps.network,
      kind,
      key,
    ]).then((row) => {
      const parsed = documentVersionSchema.safeParse(row)
      return parsed.success ? parsed.data : null
    })
    this.documentVersions.set(id, { at: now, version })
    version.catch(() => this.documentVersions.delete(id))
    // A handful of documents are read this way; keep the map small anyway.
    if (this.documentVersions.size > 256) {
      const oldest = this.documentVersions.keys().next().value
      if (oldest !== undefined) this.documentVersions.delete(oldest)
    }
    return version
  }

  private readonly documentVersions = new Map<
    string,
    {
      at: number
      version: Promise<{ etag: string; updated_at: number } | null>
    }
  >()

  /**
   * Epochs ('epoch') or days ('day') whose aggregates the jobs Worker has
   * yet to recompute (scan_dirty), read again with each new run version.
   * scan_status counts them; only scan_dirty says which ones.
   */
  async dirty(kind: "epoch" | "day"): Promise<ReadonlySet<string>> {
    const run = await this.runVersion()
    const memo = this.dirtyMemo.get(kind)
    if (memo !== undefined && memo.run === run.id) return memo.keys
    const rows = await this.rows(scanQueries.dirtyKeys, [kind])
    const keys = new Set(rows.map((row) => dirtyRowSchema.parse(row).key))
    this.dirtyMemo.set(kind, { run: run.id, keys })
    return keys
  }

  private readonly dirtyMemo = new Map<
    string,
    { run: string; keys: ReadonlySet<string> }
  >()

  private async readRun(): Promise<RunVersion> {
    const status = await this.readStatus()
    if (status !== null) {
      const halted = haltedTablesOf(status)
      const delayed = status.consecutive_failures > 0 || halted !== null
      const refillPending = status.refill_required === 1
      const stale = delayed || refillPending
      const flags = `${stale ? 1 : 0}${status.aggregates_complete}${status.history_filled}`
      return {
        // With data_version (scan-migrations 0003) any served change
        // retires every run entry, not only an ok copy run.
        id: `s${status.last_ok_at ?? 0}.${flags}${status.dataVersion === null ? "" : `.v${status.dataVersion}`}`,
        finishedAt: status.last_ok_at,
        aggregatesComplete: status.aggregates_complete === 1,
        historyFilled: status.history_filled === 1,
        stale,
        delayed,
        refillPending,
        status,
        dataVersion: status.dataVersion,
        halted,
      }
    }
    const row = await this.first(scanQueries.lastRun, ["scan-copy"])
    const parsed = runRowSchema.safeParse(row)
    return {
      id: parsed.success ? `r${parsed.data.id}` : "r0",
      finishedAt: parsed.success ? parsed.data.finished_at : null,
      aggregatesComplete: null,
      historyFilled: null,
      stale: false,
      delayed: false,
      refillPending: false,
      status: null,
      dataVersion: null,
      halted: null,
    }
  }

  /**
   * The status row, or null before migration 0002 (no such table) or the
   * first run (no row): only then does the API fall back to scan_runs. Any
   * other failure, a D1 error or a row that fails its schema, throws: the
   * run version is then unknown, so nothing keyed on it is answered or
   * stored, rather than falling back to a version that looks fresh.
   */
  private async readStatus(): Promise<
    (ScanStatusRow & { dataVersion: number | null }) | null
  > {
    let row: unknown
    try {
      row = await this.first(scanQueries.status, [])
    } catch (error) {
      if (isNoSuchTable(error, "scan_status")) {
        this.deps.logger.debug({ message: "No scan_status table yet" })
        return null
      }
      this.deps.logger.error({ message: "scan_status unreadable", error })
      throw error
    }
    if (row === null) return null
    const parsed = scanStatusRowSchema.safeParse(row)
    if (!parsed.success) {
      this.deps.logger.error({ message: "scan_status failed its schema" })
      throw new PlatformError("internal_error")
    }
    const version = dataVersionSchema.safeParse(row)
    return {
      ...parsed.data,
      dataVersion: version.success ? version.data.data_version : null,
    }
  }

  /**
   * The `meta` every aggregate and series response carries; `skipped`
   * counts rows of this response that failed their schema and were left
   * out.
   */
  async aggregateMeta(
    complete: boolean,
    skipped = 0,
  ): Promise<ScanAggregateMeta> {
    const run = await this.runVersion()
    return {
      complete: complete && run.finishedAt !== null && skipped === 0,
      asOf: run.finishedAt,
      aggregatesComplete: run.aggregatesComplete,
      historyFilled: run.historyFilled,
      stale: run.delayed,
      refillPending: run.refillPending,
      skipped,
    }
  }

  /**
   * Maps rows one by one. A row that fails its schema (RowShapeError) is
   * left out and logged with its table and primary key, so one bad stored
   * row costs that row, not the list; any other error still throws.
   */
  mapRows<Row>(
    raws: readonly unknown[],
    row: (raw: unknown) => Row,
  ): { rows: Row[]; skipped: number } {
    const rows: Row[] = []
    let skipped = 0
    for (const raw of raws) {
      try {
        rows.push(row(raw))
      } catch (error) {
        if (!(error instanceof RowShapeError)) throw error
        skipped += 1
        this.deps.logger.error({
          message: "Scan row failed its schema; skipped",
          table: error.table,
          key: rowKeyOf(error.table, raw),
        })
      }
    }
    return { rows, skipped }
  }

  /**
   * The live snapshot's slot: it writes READ_DB's Borrow tables every five
   * minutes on the five-minute cron; a minute of slack lets the run finish.
   */
  liveVersion(): string {
    return `l${Math.floor((this.nowSeconds() - 60) / 300)}`
  }
}

export type RunVersion = {
  /** Cache-key token (see runVersion). */
  id: string
  /** `last_ok_at`: when a copy run last changed the data. */
  finishedAt: number | null
  /** Null when there is no status row to say. */
  aggregatesComplete: boolean | null
  historyFilled: boolean | null
  /**
   * `delayed` or `refillPending`: nothing read under it is final (sealed or
   * kept), as data may still lag or change.
   */
  stale: boolean
  /** Copy runs failing, or a table halted: data lags the chain. */
  delayed: boolean
  /** A re-fill is required: figures may disagree until it is done. */
  refillPending: boolean
  status: ScanStatusRow | null
  /** `scan_status.data_version`, where the column exists. */
  dataVersion: number | null
  /**
   * Tables the copy has stopped (`scan_status.halted_tables`): their rows
   * stop moving, so the data is stale while any is set. Null when none,
   * or without a status row.
   */
  halted: string[] | null
}

/**
 * `halted_tables` as table names, null when the column is NULL, empty or
 * absent. Defensive about its form: any other value counts as halted
 * (JSON {table: reason} gives the names; [names] is read too; anything
 * unreadable is halted with no names), so a change in how the jobs Worker
 * stores it can only make the data look stale, never fresh.
 */
export function haltedTablesOf(row: unknown): string[] | null {
  const value =
    typeof row === "object" && row !== null
      ? (row as { halted_tables?: unknown }).halted_tables
      : undefined
  if (value === null || value === undefined || value === "") return null
  if (typeof value !== "string") return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.filter((name): name is string => typeof name === "string")
    }
    if (typeof parsed === "object" && parsed !== null) {
      return Object.keys(parsed).sort()
    }
  } catch {
    // Unreadable: halted, names unknown.
  }
  return []
}

/** D1's error for a table that does not exist (before its migration). */
function isNoSuchTable(error: unknown, table: string): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return text.includes(`no such table: ${table}`)
}

/**
 * Blocks the live snapshot may trail the head: it runs every 5 minutes,
 * about 79 blocks at 3.8 s, so two missed runs (and some slack) pass
 * before it is called stale.
 */
export const liveSnapshotMaxBehind = 240

const snapshotBlockSchema = z.object({
  musd_btc_price_block: z.number().int().nonnegative().nullable().optional(),
})

const documentVersionSchema = z.object({
  etag: z.string(),
  updated_at: z.number(),
})

const dataVersionSchema = z.object({
  data_version: z.number().int().nonnegative(),
})

const dirtyRowSchema = z.object({ key: z.string() })

const runRowSchema = z.object({
  id: z.number().int(),
  finished_at: z.number().int().nullable(),
})

// ---------------------------------------------------------------------------
// Query parameters

/**
 * The query string as one value per name; a repeated name or one outside
 * `allowed` is a 400.
 */
export function queryOf<Shape extends z.ZodRawShape>(
  c: ApiContext,
  shape: Shape,
): z.infer<z.ZodObject<Shape>> {
  const url = new URL(c.req.url)
  const single: Record<string, string> = {}
  for (const name of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(name)
    if (values.length !== 1 || !(name in shape)) {
      throw new PlatformError("invalid_request")
    }
    single[name] = values[0] ?? ""
  }
  const parsed = z.object(shape).strict().safeParse(single)
  if (!parsed.success) throw new PlatformError("invalid_request")
  return parsed.data
}

export const pageParams = {
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(scanPageSize.max)
    .default(scanPageSize.default),
}

export const addressParam = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value.toLowerCase())

export const hashParam = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value.toLowerCase())

export const epochParam = z.coerce
  .number()
  .int()
  .min(0)
  .max(4_102_444_800)
  .refine((value) => value % 604_800 === 0, "Not an epoch start")

export const tokenIdParam = z.string().regex(/^(0|[1-9][0-9]{0,77})$/)

/** A path parameter, or 404 when it is malformed. */
export function pathParam<T>(
  c: ApiContext,
  name: string,
  schema: z.ZodType<T>,
): T {
  const parsed = schema.safeParse(c.req.param(name))
  if (!parsed.success) throw new PlatformError("not_found")
  return parsed.data
}

// ---------------------------------------------------------------------------
// Paging

export type Page<Item> = {
  data: Item[]
  nextCursor: string | null
  /** Rows read for this page that failed their schema and were left out. */
  meta: { skipped: number }
}

/**
 * The cursor after a page's window: the key of its last row, good or bad.
 * A bad row's key is read from its raw columns (`rawRow` shapes them like
 * a parsed row for `keyOf`) and checked against the list's key shape, so
 * bad rows at a page's end, even a whole page of them, are stepped over
 * once rather than re-read or leaving the rest unreachable. Only when a
 * bad row's key columns are themselves unreadable does it fall back to
 * the last good row (or end the list, logged).
 */
function nextKey<Row, Key extends readonly unknown[]>(
  scan: ScanContext,
  spec: {
    codec: CursorCodec<Key>
    row: (raw: unknown) => Row
    keyOf: (row: Row) => Readonly<Key>
    rawRow?: (raw: unknown) => Row
  },
  window: readonly unknown[],
  lastGood: Row | undefined,
): string | null {
  const last = window.at(-1)
  if (last === undefined) return null
  let key: Key | null = null
  try {
    key = spec.codec.keyOf(spec.keyOf(spec.row(last)))
  } catch {
    try {
      const shaped = spec.rawRow?.(last) ?? (last as Row)
      key = spec.codec.keyOf(spec.keyOf(shaped))
    } catch {
      key = null
    }
  }
  if (key === null && lastGood !== undefined) {
    key = spec.codec.keyOf(spec.keyOf(lastGood))
  }
  if (key === null) {
    scan.deps.logger.error({
      message: "Scan list cannot page past rows it cannot key",
      list: spec.codec.list,
    })
    return null
  }
  return spec.codec.encode(key)
}

/**
 * One keyset page: asks for `limit + 1` rows so the cursor is only offered
 * when another page exists. A bad row is skipped (mapRows) and counted in
 * `meta.skipped`; the cursor steps past it (nextKey).
 */
export async function page<Row, Item, Key extends readonly unknown[]>(
  scan: ScanContext,
  spec: {
    query: ScanQuery
    codec: CursorCodec<Key>
    cursor: string | undefined
    limit: number
    /** Binds for the key (the first page's sentinel when null). */
    binds: (key: Key | null, limit: number) => unknown[]
    row: (raw: unknown) => Row
    keyOf: (row: Row) => Readonly<Key>
    /** A raw row shaped for `keyOf`, when a parsed row nests its key. */
    rawRow?: (raw: unknown) => Row
    item: (row: Row) => Item
  },
): Promise<Page<Item>> {
  const key = spec.codec.decode(spec.cursor)
  const raw = await scan.rows(spec.query, spec.binds(key, spec.limit + 1))
  const more = raw.length > spec.limit
  const window = raw.slice(0, spec.limit)
  const { rows: kept, skipped } = scan.mapRows(window, spec.row)
  return {
    data: kept.map(spec.item),
    nextCursor: more ? nextKey(scan, spec, window, kept.at(-1)) : null,
    meta: { skipped },
  }
}

/**
 * A keyset page over several ranges read in turn (one ordering whose
 * parts are separate index ranges, such as timed locks then permanent
 * ones). The key's first element is the range it is in; a range reads
 * from the cursor's key, later ones from their start.
 */
export async function segmentedPage<
  Row,
  Item,
  Key extends readonly [number, ...unknown[]],
>(
  scan: ScanContext,
  spec: {
    codec: CursorCodec<Key>
    cursor: string | undefined
    limit: number
    segments: readonly {
      query: ScanQuery
      /** Binds after `key` in this range (the range's start when null). */
      binds: (key: Key | null, limit: number) => unknown[]
    }[]
    row: (raw: unknown) => Row
    keyOf: (row: Row) => Readonly<Key>
    item: (row: Row) => Item
  },
): Promise<Page<Item>> {
  const key = spec.codec.decode(spec.cursor)
  const first = key?.[0] ?? 0
  const raw: unknown[] = []
  for (let index = first; index < spec.segments.length; index += 1) {
    const segment = spec.segments[index]
    if (segment === undefined) break
    const wanted = spec.limit + 1 - raw.length
    raw.push(
      ...(await scan.rows(
        segment.query,
        segment.binds(index === first ? key : null, wanted),
      )),
    )
    if (raw.length > spec.limit) break
  }
  const more = raw.length > spec.limit
  const window = raw.slice(0, spec.limit)
  const { rows: kept, skipped } = scan.mapRows(window, spec.row)
  return {
    data: kept.map(spec.item),
    nextCursor: more ? nextKey(scan, spec, window, kept.at(-1)) : null,
    meta: { skipped },
  }
}

/** The newest-first sentinel for (block, log, rowid) keys. */
export const newestBlockKey = [maxKey, maxKey, 0] as const
