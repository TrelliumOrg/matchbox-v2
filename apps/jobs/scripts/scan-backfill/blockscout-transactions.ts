import path from "node:path"
import { z } from "zod"
import { dayOf } from "../../src/scan/transform"
import {
  bump,
  dailyStatements,
  daysSchema,
  logger,
  nowSeconds,
  Pacer,
  parseCommon,
  pointsOf,
  StateFile,
  writeSqlFiles,
} from "./lib"

// (b) Chain-wide daily transactions, active addresses, new addresses and
// cumulative addresses, by paging every validated transaction once from
// Blockscout, newest first (about 1.14M transactions, 50 a page, about
// 23,000 pages). Blockscout allows 300 requests per window per IP; the
// pacer keeps to 4 a second and waits out the window when
// x-ratelimit-remaining runs low. BLOCKSCOUT_API_KEY, when set, is sent as
// `apikey`.
//
//   pnpm --filter @matchbox/jobs exec tsx scripts/scan-backfill/blockscout-transactions.ts \
//     [--max-requests 23500] [--write] [--fresh]
//
// Active addresses are a transaction's `from` and `to` (and created
// contract). New and cumulative addresses need the whole history, so they
// are only written once paging reaches the first transaction; Blockscout's
// own total_addresses also counts addresses that only ever received tokens
// or internal transfers, so it runs higher than this series.

const base = "https://api.explorer.mezo.org/api/v2/transactions"

const { common } = parseCommon({})
const apiKey = process.env.BLOCKSCOUT_API_KEY ?? null

const address = z
  .object({ hash: z.string() })
  .nullable()
  .transform((value) => (value === null ? null : value.hash.toLowerCase()))

/** Blockscout's keyset cursor, passed back as query parameters. */
const cursorSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.null()]))
  .nullable()

const pageSchema = z.object({
  items: z.array(
    z.object({
      hash: z.string(),
      timestamp: z.string(),
      from: address,
      to: address,
      created_contract: address.optional(),
    }),
  ),
  next_page_params: cursorSchema,
})

const stateSchema = z.object({
  cursor: cursorSchema,
  /** The day paging started on (partial, never written). */
  startDay: z.string().nullable(),
  oldestDay: z.string().nullable(),
  complete: z.boolean(),
  pages: z.number().int(),
  transactions: z.number().int(),
  days: daysSchema,
  /** Addresses active per day. */
  active: z.record(z.string(), z.array(z.string())),
  /** Each address's earliest day seen so far (paging runs backwards). */
  firstSeen: z.record(z.string(), z.string()),
})

type State = z.infer<typeof stateSchema>

const store = new StateFile<State>(
  path.join(common.out, "blockscout-transactions"),
  stateSchema,
  () => ({
    cursor: null,
    startDay: null,
    oldestDay: null,
    complete: false,
    pages: 0,
    transactions: 0,
    days: {},
    active: {},
    firstSeen: {},
  }),
)
const state = store.load(common.fresh)
const pacer = new Pacer(250)
const started = Date.now()

while (!state.complete && pacer.requests < common.maxRequests) {
  const params = new URLSearchParams({ filter: "validated" })
  if (state.cursor !== null) {
    for (const [key, value] of Object.entries(state.cursor)) {
      if (value !== null) params.set(key, String(value))
    }
  }
  if (apiKey !== null) params.set("apikey", apiKey)
  const response = await pacer.fetch(`${base}?${params}`)
  if (!response.ok) throw new Error(`Blockscout answered ${response.status}`)
  const page = pageSchema.parse(await response.json())
  for (const item of page.items) {
    const day = dayOf(Math.floor(Date.parse(item.timestamp) / 1000))
    state.startDay = state.startDay ?? day
    state.oldestDay = day
    bump(state.days, day, "chain.transactions", "", 1n)
    const active = new Set(state.active[day] ?? [])
    for (const party of [item.from, item.to, item.created_contract ?? null]) {
      if (party === null) continue
      active.add(party)
      state.firstSeen[party] = day
    }
    state.active[day] = [...active]
  }
  state.pages += 1
  state.transactions += page.items.length
  state.cursor = page.next_page_params
  state.complete = page.next_page_params === null
  // Saved with its cursor every 20 pages: a resume re-reads at most 20.
  if (state.pages % 20 === 0 || state.complete) store.save(state)
  if (state.pages % 50 === 0) {
    logger.info({
      message: "Paging",
      pages: state.pages,
      transactions: state.transactions,
      oldestDay: state.oldestDay,
      requestsPerSecond: (
        pacer.requests /
        ((Date.now() - started) / 1000)
      ).toFixed(2),
    })
  }
}

// Days fully covered: after the oldest (possibly partial) day, before the
// day paging started on. With the whole history, the oldest is complete.
const covered = Object.keys(state.days)
  .filter(
    (day) =>
      day !== state.startDay &&
      (state.complete || (state.oldestDay !== null && day > state.oldestDay)),
  )
  .sort()
for (const day of covered) {
  bump(
    state.days,
    day,
    "chain.active_addresses",
    "",
    BigInt(state.active[day]?.length ?? 0),
  )
}
const output: typeof state.days = Object.fromEntries(
  covered.map((day) => [day, state.days[day] ?? {}]),
)
if (state.complete) {
  const newByDay = new Map<string, number>()
  for (const day of Object.values(state.firstSeen)) {
    newByDay.set(day, (newByDay.get(day) ?? 0) + 1)
  }
  let cumulative = 0n
  for (const day of covered) {
    const fresh = BigInt(newByDay.get(day) ?? 0)
    cumulative += fresh
    bump(output, day, "chain.new_addresses", "", fresh)
    bump(output, day, "chain.addresses_cumulative", "", cumulative)
  }
}

const elapsed = (Date.now() - started) / 1000
const rate = pacer.requests / Math.max(elapsed, 1)
logger.info({
  message: state.complete
    ? "Paged the whole history"
    : "Stopped at the request budget",
  pages: state.pages,
  transactions: state.transactions,
  oldestDay: state.oldestDay,
  coveredDays: covered.length,
  requests: pacer.requests,
  elapsedSeconds: Math.round(elapsed),
  requestsPerSecond: rate.toFixed(2),
  estimatedFullRunPages: 23_000,
  estimatedFullRunMinutes: Math.round(23_000 / rate / 60),
  sample: covered.slice(-3).map((day) => ({ day, ...output[day] })),
})
if (common.write) {
  const files = writeSqlFiles(
    path.join(common.out, "blockscout-transactions"),
    "daily",
    dailyStatements(pointsOf(output), "backfill:blockscout", nowSeconds()),
  )
  logger.info({ message: "SQL written", files })
}
