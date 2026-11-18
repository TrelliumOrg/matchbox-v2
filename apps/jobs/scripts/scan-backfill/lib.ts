import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { parseArgs } from "node:util"
import { createLogger } from "@matchbox/logger"
import { z } from "zod"
import {
  type DailyPoint,
  dailyRows,
  dailySpec,
} from "../../src/scan/aggregates"
import {
  inlineStatement,
  type SqlStatement,
  sqlLiteral,
  upsertStatements,
} from "../../src/scan/statements"
import { parseJson } from "../../src/scan/transform"

// Shared by the one-time history backfills. Every script:
// - is a dry run unless --write is passed: it reads its source, prints what
//   it would write and writes no SQL;
// - keeps its progress in <out>/<script>/state.json after every page, so an
//   interrupted run resumes where it stopped (--fresh starts over);
// - stops after --max-requests requests (default: a small sample), and
//   paces itself under the source's rate limit;
// - with --write, emits numbered SQL files a human applies with
//   `wrangler d1 execute matchbox-scan --remote --file <file>`. Nothing here
//   writes to a database.

export const logger = createLogger()

export const commonOptions = {
  write: { type: "boolean", default: false },
  fresh: { type: "boolean", default: false },
  out: { type: "string", default: path.join(import.meta.dirname, "out") },
  "max-requests": { type: "string", default: "50" },
} as const

export type CommonArgs = {
  write: boolean
  fresh: boolean
  out: string
  maxRequests: number
}

export function parseCommon<
  Options extends Record<string, { type: "string" | "boolean" }>,
>(extra: Options) {
  const { values } = parseArgs({
    options: { ...commonOptions, ...extra },
    allowPositionals: false,
  })
  const common = z
    .object({
      write: z.boolean(),
      fresh: z.boolean(),
      out: z.string(),
      "max-requests": z.string().regex(/^[0-9]+$/),
    })
    .parse(values)
  return {
    values,
    common: {
      write: common.write,
      fresh: common.fresh,
      out: common.out,
      maxRequests: Number.parseInt(common["max-requests"], 10),
    } satisfies CommonArgs,
  }
}

/** JSON state on disk, validated on load, written atomically. */
export class StateFile<State> {
  readonly file: string
  constructor(
    dir: string,
    private readonly schema: z.ZodType<State>,
    private readonly initial: () => State,
  ) {
    mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, "state.json")
  }
  load(fresh: boolean): State {
    if (fresh || !existsSync(this.file)) return this.initial()
    return parseJson(this.schema, readFileSync(this.file, "utf8"))
  }
  save(state: State): void {
    const temporary = `${this.file}.tmp`
    writeFileSync(temporary, JSON.stringify(state))
    renameSync(temporary, this.file)
  }
}

/**
 * Paces requests: at most one per `minIntervalMs`, and a pause until the
 * window resets when the server says few requests remain (Blockscout's
 * x-ratelimit-remaining and x-ratelimit-reset, in milliseconds) or answers
 * 429.
 */
export class Pacer {
  private last = 0
  requests = 0
  constructor(
    private readonly minIntervalMs: number,
    private readonly reserve = 10,
  ) {}
  private static wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
  async fetch(
    url: string,
    init: RequestInit = {},
    attempts = 5,
  ): Promise<Response> {
    for (let attempt = 1; ; attempt += 1) {
      const gap = this.last + this.minIntervalMs - Date.now()
      if (gap > 0) await Pacer.wait(gap)
      this.last = Date.now()
      this.requests += 1
      let response: Response
      try {
        response = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(30_000),
        })
      } catch (error) {
        if (attempt >= attempts) throw error
        await Pacer.wait(1_000 * 2 ** attempt)
        continue
      }
      const remaining = Number.parseInt(
        response.headers.get("x-ratelimit-remaining") ?? "",
        10,
      )
      const reset = Number.parseInt(
        response.headers.get("x-ratelimit-reset") ?? "",
        10,
      )
      if (response.status === 429 || response.status >= 500) {
        if (attempt >= attempts) return response
        const pause = Number.isFinite(reset)
          ? reset + 500
          : 1_000 * 2 ** attempt
        logger.warn({
          message: "Backing off",
          status: response.status,
          pauseMs: pause,
        })
        await Pacer.wait(pause)
        continue
      }
      if (Number.isFinite(remaining) && remaining <= this.reserve) {
        await Pacer.wait((Number.isFinite(reset) ? reset : 60_000) + 500)
      }
      return response
    }
  }
}

/** One JSON-RPC request (or a batch) with retries through a Pacer. */
export async function jsonRpc<Schema extends z.ZodType>(
  pacer: Pacer,
  url: string,
  body: unknown,
  schema: Schema,
): Promise<z.output<Schema>> {
  const response = await pacer.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`RPC ${url} answered ${response.status}`)
  return schema.parse(await response.json())
}

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/)

/** One JSON-RPC call's result; an RPC error throws. */
export async function rpcCall(
  pacer: Pacer,
  url: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const body = await jsonRpc(
    pacer,
    url,
    { jsonrpc: "2.0", id: 1, method, params },
    z.object({
      result: z.unknown().optional(),
      error: z.object({ message: z.string() }).optional(),
    }),
  )
  if (body.error !== undefined)
    throw new Error(`${method}: ${body.error.message}`)
  return body.result
}

/** A block's timestamp, in seconds. */
export async function blockTimestamp(
  pacer: Pacer,
  url: string,
  block: number,
): Promise<number> {
  const header = z
    .object({ timestamp: hex })
    .parse(
      await rpcCall(pacer, url, "eth_getBlockByNumber", [
        `0x${block.toString(16)}`,
        false,
      ]),
    )
  return Number(header.timestamp)
}

/** The highest block with a timestamp below `before`, by secant steps. */
export async function lastBlockBefore(
  timestampOf: (block: number) => Promise<number>,
  before: number,
  bounds: { low: number; lowTs: number; high: number; highTs: number },
): Promise<number> {
  let { low, lowTs, high, highTs } = bounds
  while (high - low > 1) {
    const guess = Math.min(
      high - 1,
      Math.max(
        low + 1,
        Math.floor(
          low + ((before - lowTs) * (high - low)) / Math.max(highTs - lowTs, 1),
        ),
      ),
    )
    const ts = await timestampOf(guess)
    if (ts < before) {
      low = guess
      lowTs = ts
    } else {
      high = guess
      highTs = ts
    }
    // Near the answer, bisect rather than oscillate: at most six reads,
    // where walking down from `high` took up to 63.
    if (high - low <= 64) {
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2)
        if ((await timestampOf(middle)) < before) low = middle
        else high = middle
      }
      return low
    }
  }
  return low
}

/** Statements as one SQL text, as a file would hold them. */
export function inlineStatementsOf(
  statements: readonly SqlStatement[],
): string {
  return statements.map(inlineStatement).join("")
}

/** Statements into numbered SQL files of at most `maxBytes` each. */
export function writeSqlFiles(
  dir: string,
  prefix: string,
  statements: readonly SqlStatement[],
  maxBytes = 5_000_000,
): string[] {
  mkdirSync(dir, { recursive: true })
  const files: string[] = []
  let buffer = ""
  function flush() {
    if (buffer.length === 0) return
    const file = path.join(
      dir,
      `${prefix}-${String(files.length + 1).padStart(4, "0")}.sql`,
    )
    writeFileSync(file, buffer)
    files.push(file)
    buffer = ""
  }
  for (const statement of statements) {
    const sql = inlineStatement(statement)
    if (buffer.length + sql.length > maxBytes) flush()
    buffer += sql
  }
  flush()
  return files
}

/** `daily` upserts for points grouped by day. */
export function dailyStatements(
  byDay: ReadonlyMap<string, readonly DailyPoint[]>,
  source: string,
  nowSeconds: number,
): SqlStatement[] {
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([day, points]) =>
      upsertStatements(dailySpec, dailyRows(points, day, source, nowSeconds)),
    )
}

/** Adds to a {day: {metric|dimension: value}} accumulator kept in state. */
export function bump(
  days: Record<string, Record<string, string>>,
  day: string,
  metric: string,
  dimension: string,
  value: bigint,
): void {
  const key = `${metric}|${dimension}`
  const bucket = days[day] ?? {}
  days[day] = bucket
  bucket[key] = (BigInt(bucket[key] ?? "0") + value).toString()
}

/** Accumulator back into points per day. */
export function pointsOf(
  days: Record<string, Record<string, string>>,
): Map<string, DailyPoint[]> {
  return new Map(
    Object.entries(days).map(([day, bucket]) => [
      day,
      Object.entries(bucket).map(([key, value]) => {
        const [metric = "", dimension = ""] = key.split("|")
        return { metric, dimension, value: BigInt(value) }
      }),
    ]),
  )
}

export const daysSchema = z.record(z.string(), z.record(z.string(), z.string()))

/** One series' backfill in a dry run: rows, range, first and last value. */
export type SeriesSummary = {
  series: string
  rows: number
  first: { day: string; value: string } | null
  last: { day: string; value: string } | null
}

/** Per series (`metric|dimension`), what the backfill holds. */
export function summarizeDays(
  days: Readonly<Record<string, Readonly<Record<string, string>>>>,
): SeriesSummary[] {
  const bySeries = new Map<string, { day: string; value: string }[]>()
  for (const day of Object.keys(days).sort()) {
    for (const [series, value] of Object.entries(days[day] ?? {})) {
      const list = bySeries.get(series) ?? []
      list.push({ day, value })
      bySeries.set(series, list)
    }
  }
  return [...bySeries.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([series, list]) => ({
      series,
      rows: list.length,
      first: list[0] ?? null,
      last: list.at(-1) ?? null,
    }))
}

/** A row already in the database, for the dry run's comparison. */
export type PresentRow = {
  series: string
  day: string
  value: string
  source: string
}

export type SeriesComparison = {
  series: string
  /** Rows the database already holds for the series, any source. */
  present: number
  presentFirst: string | null
  presentLast: string | null
  /** Backfilled days the database lacks: what the SQL would insert. */
  wouldInsert: number
  /** Days both hold: the backfill's value is not written for these. */
  overlap: number
  /** Overlapping days whose values agree exactly. */
  equal: number
  /** Up to five overlapping days whose values differ. */
  differences: {
    day: string
    backfill: string
    present: string
    source: string
  }[]
}

/**
 * The backfill against the rows already present: insert-if-absent keeps
 * every present row, so only absent days are inserted, and the overlap
 * checks the reconstruction against what the live writer recorded.
 */
export function compareWithPresent(
  days: Readonly<Record<string, Readonly<Record<string, string>>>>,
  present: readonly PresentRow[],
): SeriesComparison[] {
  const presentBySeries = new Map<string, Map<string, PresentRow>>()
  for (const row of present) {
    const byDay = presentBySeries.get(row.series) ?? new Map()
    byDay.set(row.day, row)
    presentBySeries.set(row.series, byDay)
  }
  const backfilled = new Map<string, Map<string, string>>()
  for (const [day, bucket] of Object.entries(days)) {
    for (const [series, value] of Object.entries(bucket)) {
      const byDay = backfilled.get(series) ?? new Map<string, string>()
      byDay.set(day, value)
      backfilled.set(series, byDay)
    }
  }
  const names = [
    ...new Set([...backfilled.keys(), ...presentBySeries.keys()]),
  ].sort()
  return names.map((series) => {
    const ours = backfilled.get(series) ?? new Map<string, string>()
    const theirs = presentBySeries.get(series) ?? new Map<string, PresentRow>()
    const presentDays = [...theirs.keys()].sort()
    let wouldInsert = 0
    let overlap = 0
    let equal = 0
    const differences: SeriesComparison["differences"] = []
    for (const [day, value] of [...ours.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const row = theirs.get(day)
      if (row === undefined) {
        wouldInsert += 1
        continue
      }
      overlap += 1
      if (row.value === value) equal += 1
      else if (differences.length < 5) {
        differences.push({
          day,
          backfill: value,
          present: row.value,
          source: row.source,
        })
      }
    }
    return {
      series,
      present: theirs.size,
      presentFirst: presentDays[0] ?? null,
      presentLast: presentDays.at(-1) ?? null,
      wouldInsert,
      overlap,
      equal,
      differences,
    }
  })
}

const readOnlySql = /^\s*SELECT\b[^;]*$/i

/**
 * Rows from a remote D1 database, READ ONLY: one SELECT through
 * `wrangler d1 execute <database> --remote --json --command`, with the
 * caller's Cloudflare login (CLOUDFLARE_ACCOUNT_ID picks the account when
 * the login has several). Anything but a single SELECT is refused before
 * wrangler runs.
 */
export function selectRemote<Schema extends z.ZodType>(
  database: string,
  sql: string,
  row: Schema,
): z.output<Schema>[] {
  if (!readOnlySql.test(sql)) {
    throw new Error("selectRemote runs a single SELECT only")
  }
  const wrangler = path.join(
    path.dirname(
      createRequire(import.meta.url).resolve("wrangler/package.json"),
    ),
    "bin",
    "wrangler.js",
  )
  const result = spawnSync(
    process.execPath,
    [
      wrangler,
      "d1",
      "execute",
      database,
      "--remote",
      "--json",
      "--command",
      sql,
    ],
    {
      cwd: path.resolve(import.meta.dirname, "../.."),
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    },
  )
  if (result.status !== 0) {
    throw new Error(
      `wrangler d1 execute ${database} failed: ${(result.stdout || result.stderr).slice(0, 600)}`,
    )
  }
  const body = parseJson(
    z.array(z.object({ results: z.array(z.unknown()) })),
    result.stdout,
  )
  return z.array(row).parse(body.flatMap((part) => part.results))
}

/** `daily` rows present for `metrics`, as series rows for the comparison. */
export function presentDailyRows(
  database: string,
  metrics: readonly string[],
): PresentRow[] {
  const list = metrics
    .map((metric) =>
      sqlLiteral(
        z
          .string()
          .regex(/^[a-z_.]+$/)
          .parse(metric),
      ),
    )
    .join(", ")
  return selectRemote(
    database,
    `SELECT metric, dimension, day, value, source FROM daily WHERE metric IN (${list})`,
    z.object({
      metric: z.string(),
      dimension: z.string(),
      day: z.string(),
      value: z.string(),
      source: z.string(),
    }),
  ).map((row) => ({
    series: `${row.metric}|${row.dimension}`,
    day: row.day,
    value: row.value,
    source: row.source,
  }))
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
