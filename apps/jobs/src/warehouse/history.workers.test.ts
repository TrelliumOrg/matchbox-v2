import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import {
  addDays,
  claimPricesCursor,
  utcDay,
} from "@matchbox/api/read-models/claim-prices"
import { btcToken, mezoToken } from "@matchbox/api/read-models/money"
import { pricesKvKey } from "@matchbox/api/read-models/prices-kv"
import {
  historyStateStatement,
  incompleteHistories,
  readHistoryState,
} from "@matchbox/api/read-models/wallet-history"
import { readReadModel } from "@matchbox/api/read-store"
import { activityRowSchema } from "@matchbox/contracts/read-models"
import { EPOCH_SECONDS, epochIndexFor, epochStartOf } from "@matchbox/domain"
import { createLogger } from "@matchbox/logger"
import { beforeEach, describe, expect, it } from "vitest"
import recorded from "../../test/fixtures/warehouse.json"
import { resetStorage } from "../../test/reset"
import { emptyChainReader } from "../../test/warehouse-fixture"
import type { PriceHistoryFetch } from "./claim-prices"
import {
  type ActivityEventRow,
  createWarehouseReader,
  type WarehouseReader,
} from "./reader"
import { recordedQueryRunner, recordingSchema } from "./recorded"
import { runWarehouseSnapshot } from "./snapshot"

// A wallet with more claims than the snapshot reads for its document: its
// stored history grows forward on every run and back with the backfill.

const recording = recordingSchema.parse(recorded)
const logger = createLogger({ level: "error" })
const wallet = `0x${"5a".repeat(20)}`
const gauge = `0x${"6b".repeat(20)}`
const claims = 150
/** Two hours apart, the newest an hour before the snapshot. */
const spacing = 7_200

function claim(
  index: number,
  who = wallet,
  token = mezoToken,
): ActivityEventRow {
  const ts = recording.nowSeconds - 3_600 - index * spacing
  return {
    tx_hash: `0x${who.slice(2, 4)}${(index + 1).toString(16).padStart(62, "0")}`,
    log_index: "4",
    block_number: String(13_000_000 - index),
    timestamp: String(ts),
    action_type: "VOTE_FEE_CLAIMED",
    source: "BOOST_VOTER",
    actor: who,
    recipient: who,
    token_id: "9",
    amount: "1000000000000000000",
    duration: null,
    prev_duration: null,
    post_duration: null,
    prev_is_permanent: null,
    post_is_permanent: null,
    merge_source_token_id: null,
    merge_dest_token_id: null,
    token,
    gauge,
    weight: null,
    boostable_token_id: null,
    boost: null,
    epoch_start: null,
    contract_address: gauge,
  }
}

/** Newest first. */
const all = Array.from({ length: claims }, (_, index) => claim(index))

function compare(event: ActivityEventRow, ts: number, tx: string): number {
  const at = Number(event.timestamp)
  if (at !== ts) return at < ts ? -1 : 1
  return event.tx_hash === tx ? 0 : event.tx_hash < tx ? -1 : 1
}

const recordedReader = createWarehouseReader(recordedQueryRunner(recording))
let historyReads = 0

/** The warehouse holding these wallets' events, each newest first. */
function readerFor(
  byWallet: ReadonlyMap<string, readonly ActivityEventRow[]>,
): WarehouseReader {
  const of = (who: string) => byWallet.get(who) ?? []
  return {
    ...recordedReader,
    async changedWallets() {
      return []
    },
    async sweepWallets() {
      return [...byWallet.keys()]
    },
    async locksOf() {
      return []
    },
    async activeVotes() {
      return []
    },
    async activityOf(wallets, perWallet) {
      return wallets.flatMap((who) => of(who).slice(0, perWallet))
    },
    async walletHistory(requests) {
      historyReads += requests.length
      return requests.map((request) => {
        if (request.direction === "older") {
          return of(request.wallet)
            .filter(
              (event) => compare(event, request.from.ts, request.from.tx) < 0,
            )
            .slice(0, request.limit)
        }
        const until = request.until
        return of(request.wallet)
          .filter(
            (event) =>
              compare(event, request.from.ts, request.from.tx) > 0 &&
              (until === undefined || compare(event, until.ts, until.tx) < 0),
          )
          .reverse()
          .slice(0, request.limit)
      })
    },
  }
}

const reader = readerFor(new Map([[wallet, all]]))

function run(
  backfill: number | null,
  options: {
    db?: D1Database
    warehouse?: WarehouseReader
    at?: number
    priceHistory?: PriceHistoryFetch
  } = {},
) {
  return runWarehouseSnapshot({
    ...(options.priceHistory === undefined
      ? {}
      : {
          priceHistory: {
            fetchHistory: options.priceHistory,
            limitedReach: true,
          },
        }),
    db: options.db ?? env.READ_DB,
    kv: env.PRICES,
    warehouse: options.warehouse ?? reader,
    chain: emptyChainReader,
    trigger: "chained",
    sweepWallets: 1,
    nowSeconds: options.at ?? recording.nowSeconds,
    logger,
    historyBackfillTxs: backfill,
  })
}

/**
 * READ_DB, but a statement whose SQL contains `failing` fails when it is
 * run, alone or in a batch, as D1 fails one. `hits` counts the failures.
 */
function failingDb(failing: string): { db: D1Database; hits: () => number } {
  let hits = 0
  const marked = new WeakSet<D1PreparedStatement>()
  const fail = () => {
    hits += 1
    return Promise.reject(new Error("D1_ERROR: Network connection lost."))
  }
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) => wrap(target.bind(...values))
        }
        if (["first", "all", "run", "raw"].includes(String(property))) {
          return fail
        }
        const value: unknown = Reflect.get(target, property)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    marked.add(wrapped)
    return wrapped
  }
  const db = new Proxy(env.READ_DB, {
    get(target, property) {
      if (property === "prepare") {
        return (sql: string) => {
          const statement = target.prepare(sql)
          return sql.includes(failing) ? wrap(statement) : statement
        }
      }
      if (property === "batch") {
        return (statements: D1PreparedStatement[]) =>
          statements.some((statement) => marked.has(statement))
            ? fail()
            : target.batch(statements)
      }
      const value: unknown = Reflect.get(target, property)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  return { db, hits: () => hits }
}

async function documentExists(kind: "wallet-overview" | "wallet-rewards") {
  return (await readReadModel(env.READ_DB, "mezo", kind, wallet)) !== null
}

async function storedRows(): Promise<number> {
  const row = await env.READ_DB.prepare(
    "SELECT count(*) AS n FROM wallet_activity_rows WHERE wallet = ?1",
  )
    .bind(wallet)
    .first<{ n: number }>()
  return row?.n ?? 0
}

beforeEach(async () => {
  await applyD1Migrations(env.READ_DB, env.TEST_MIGRATIONS)
  await resetStorage()
  await env.READ_DB.batch(
    ["wallet_activity_rows", "wallet_history_state", "token_price_daily"].map(
      (table) => env.READ_DB.prepare(`DELETE FROM ${table}`),
    ),
  )
  historyReads = 0
})

const historyStart = addDays(utcDay(recording.nowSeconds), -40)

/** MEZO at `usd` every day of the last 40, all of them checked. */
async function seedMezoPrices(usd: string): Promise<void> {
  const last = utcDay(recording.nowSeconds)
  const first = addDays(last, -40)
  const statements: D1PreparedStatement[] = []
  for (let day = first; day <= last; day = addDays(day, 1)) {
    statements.push(
      env.READ_DB.prepare(
        `INSERT OR REPLACE INTO token_price_daily
           (token, day, usd, source, priced_at, updated_at)
         VALUES ('mezo', ?1, ?2, 'coingecko', 0, 0)`,
      ).bind(day, usd),
    )
  }
  statements.push(
    env.READ_DB.prepare(
      `INSERT OR REPLACE INTO job_cursors (job, network, value, updated_at)
       VALUES (?1, 'mezo', ?2, 0)`,
    ).bind(
      claimPricesCursor("mezo"),
      JSON.stringify({ from: first, through: last }),
    ),
  )
  await env.READ_DB.batch(statements)
}

function pointOf(event: ActivityEventRow | undefined) {
  return { ts: Number(event?.timestamp), tx: event?.tx_hash ?? "" }
}

function claimEpoch(event: ActivityEventRow | undefined): number {
  const ts = Number(event?.timestamp)
  return epochIndexFor(epochStartOf(ts) - EPOCH_SECONDS)
}

describe("stored wallet history", () => {
  // Both daily histories caught up: Earned is not carried for want of
  // them (see "values when claimed").
  beforeEach(async () => {
    await seedMezoPrices("0.5")
    await env.READ_DB.prepare(
      `INSERT OR REPLACE INTO job_cursors (job, network, value, updated_at)
       VALUES (?1, 'mezo', ?2, 0)`,
    )
      .bind(
        claimPricesCursor("btc"),
        JSON.stringify({
          from: historyStart,
          through: utcDay(recording.nowSeconds),
        }),
      )
      .run()
  })

  it("stores the document's rows, then reads older ones back to the first", async () => {
    await run(null)
    // The read asks for one more than the document holds: the document
    // keeps 80, and the 81st shows older events exist.
    const activity = await readReadModel(
      env.READ_DB,
      "mezo",
      "wallet-activity",
      wallet,
    )
    expect(activity?.data.rows).toHaveLength(80)
    expect(await storedRows()).toBe(80)
    expect(historyReads).toBe(0)
    expect(await readHistoryState(env.READ_DB, "mezo", wallet)).toMatchObject({
      high: { ts: Number(all[0]?.timestamp) },
      low: { ts: Number(all[79]?.timestamp) },
      complete: false,
    })

    // The backfill: 50 transactions a run until a short read.
    await run(50)
    expect(await storedRows()).toBe(130)
    expect(
      (await readHistoryState(env.READ_DB, "mezo", wallet))?.complete,
    ).toBe(false)
    await run(50)
    expect(await storedRows()).toBe(claims)
    expect(await readHistoryState(env.READ_DB, "mezo", wallet)).toMatchObject({
      low: { ts: Number(all.at(-1)?.timestamp) },
      complete: true,
    })

    // Earned covers every claim now, not only the document's.
    const rewards = await readReadModel(
      env.READ_DB,
      "mezo",
      "wallet-rewards",
      wallet,
    )
    expect(rewards?.data.earned).toMatchObject({
      fromEpoch: claimEpoch(all.at(-1)),
      toEpoch: claimEpoch(all[0]),
    })
    expect(rewards?.data.history).toHaveLength(12)

    // A complete history is not read again.
    historyReads = 0
    await run(50)
    expect(historyReads).toBe(0)
    expect(await storedRows()).toBe(claims)
  })

  it("writes the documents and cursors when the history read fails", async () => {
    await run(null)
    // Another wallet's history waits for the backfill, behind this one.
    const other = `0x${"7c".repeat(20)}`
    await historyStateStatement(env.READ_DB, "mezo", other, {
      low: { ts: 1_000, tx: "0x1" },
      high: { ts: 2_000, tx: "0x2" },
      complete: false,
      updatedAt: recording.nowSeconds + 30,
    }).run()
    expect((await incompleteHistories(env.READ_DB, "mezo", 1))[0]?.wallet).toBe(
      wallet,
    )
    await env.READ_DB.batch([
      env.READ_DB.prepare(
        "DELETE FROM read_models WHERE kind = 'wallet-overview'",
      ),
      env.READ_DB.prepare("DELETE FROM job_cursors"),
    ])

    // Neon's statement timeout, on the backfill read.
    const timingOut: WarehouseReader = {
      ...reader,
      async walletHistory() {
        throw new Error("canceling statement due to statement timeout")
      },
    }
    const result = await run(50, {
      warehouse: timingOut,
      at: recording.nowSeconds + 60,
    })
    expect(result.status).toBe("ok")
    expect(await documentExists("wallet-overview")).toBe(true)
    const cursors = await env.READ_DB.prepare(
      "SELECT job FROM job_cursors WHERE job LIKE 'warehouse-%' ORDER BY job",
    ).all<{ job: string }>()
    expect(cursors.results.map((row) => row.job)).toEqual([
      "warehouse-block",
      "warehouse-history-backfill",
      "warehouse-sweep",
      "warehouse-sweep-size",
    ])
    // Nothing more is stored, and the wallet goes to the back of the line.
    expect(await storedRows()).toBe(80)
    expect(await readHistoryState(env.READ_DB, "mezo", wallet)).toMatchObject({
      low: { ts: Number(all[79]?.timestamp) },
      updatedAt: recording.nowSeconds + 60,
    })
    expect((await incompleteHistories(env.READ_DB, "mezo", 1))[0]?.wallet).toBe(
      other,
    )
  })

  it("keeps Earned when the stored claims cannot be read", async () => {
    await run(null)
    await run(100)
    const read = async () =>
      (await readReadModel(env.READ_DB, "mezo", "wallet-rewards", wallet))?.data
        .earned
    const whole = await read()
    expect(whole).toMatchObject({ fromEpoch: claimEpoch(all.at(-1)) })

    const result = await run(null, {
      db: failingDb("wallet_activity_rows_claims").db,
      at: recording.nowSeconds + 60,
    })
    expect(result.status).toBe("ok")
    // Not the document's claims alone, which begin later.
    expect(await read()).toEqual(whole)
  })
})

describe("a run with D1 failing on the history", () => {
  /** Removes the wallet's documents and the cursors, to see them written. */
  async function clearOutputs() {
    await env.READ_DB.batch([
      env.READ_DB.prepare(
        "DELETE FROM read_models WHERE kind LIKE 'wallet-%' AND doc_key = ?1",
      ).bind(wallet),
      env.READ_DB.prepare("DELETE FROM job_cursors"),
    ])
  }

  /** The run was ok, and wrote the wallet's documents and the cursors. */
  async function expectWritten(at: number) {
    const runs = await env.READ_DB.prepare(
      "SELECT status FROM snapshot_runs ORDER BY id DESC LIMIT 1",
    ).first<{ status: string }>()
    expect(runs?.status).toBe("ok")
    for (const kind of [
      "wallet-overview",
      "wallet-rewards",
      "wallet-activity",
    ] as const) {
      expect(
        await readReadModel(env.READ_DB, "mezo", kind, wallet),
      ).toMatchObject({ meta: { updatedAt: at } })
    }
    const cursors = await env.READ_DB.prepare(
      // The warehouse's own; the claim values' pass has its own cursor.
      "SELECT job, updated_at FROM job_cursors WHERE job LIKE 'warehouse-%' ORDER BY job",
    ).all<{ job: string; updated_at: number }>()
    expect(cursors.results).toEqual(
      [
        "warehouse-block",
        "warehouse-history-backfill",
        "warehouse-sweep",
        "warehouse-sweep-size",
      ].map((job) => ({ job, updated_at: at })),
    )
  }

  it.each([
    [
      "the history states read",
      "FROM wallet_history_state WHERE network = ?1 AND wallet IN",
    ],
    ["a history row insert", "INSERT INTO wallet_activity_rows"],
    ["the history state insert", "INSERT INTO wallet_history_state"],
    ["the stored claims read", "wallet_activity_rows_claims"],
  ])("writes the documents and cursors when %s fails", async (_step, sql) => {
    await run(null)
    await clearOutputs()
    const at = recording.nowSeconds + 60
    const failing = failingDb(sql)
    // The backfill is on, so the run stores rows and a state.
    const result = await run(50, { db: failing.db, at })
    expect(failing.hits()).toBeGreaterThan(0)
    expect(result.status).toBe("ok")
    await expectWritten(at)
  })

  it("writes the documents and cursors without the history tables", async () => {
    await env.READ_DB.batch(
      ["wallet_activity_rows", "wallet_history_state"].map((table) =>
        env.READ_DB.prepare(`DROP TABLE ${table}`),
      ),
    )
    try {
      const result = await run(50)
      expect(result.status).toBe("ok")
      await expectWritten(recording.nowSeconds)
    } finally {
      // Migrations are applied once: put the tables back for the others.
      const history = env.TEST_MIGRATIONS.find((migration) =>
        migration.name.startsWith("0007"),
      )
      await env.READ_DB.batch(
        (history?.queries ?? []).map((query) => env.READ_DB.prepare(query)),
      )
    }
  })
})

describe("Earned while a gap is open", () => {
  // The wallet's 400 claims. Its history was stored when it had made only
  // the oldest 100; since then it made 300 more, so its document (the
  // latest 80) no longer reaches what is stored: claims 80 to 299 are in
  // neither until the gap reads close it, 200 transactions a run at most.
  const long = Array.from({ length: 400 }, (_, index) => claim(index))
  const later = readerFor(new Map([[wallet, long]]))
  const at = (step: number) => recording.nowSeconds + 60 * step

  beforeEach(async () => {
    // Each claim is 1 MEZO, $0.50 every day: Earned is its claims' values
    // when claimed.
    await seedMezoPrices("0.5")
    await env.PRICES.put(
      pricesKvKey,
      JSON.stringify({
        btc: null,
        mezo: {
          usd: "0.5",
          change24h: null,
          source: "coingecko",
          updatedAt: recording.nowSeconds,
        },
      }),
    )
  })

  async function earned() {
    return (await readReadModel(env.READ_DB, "mezo", "wallet-rewards", wallet))
      ?.data.earned
  }

  /** Stores the oldest 100 claims whole; returns that Earned. */
  async function storeEarlier() {
    const earlier = readerFor(new Map([[wallet, long.slice(300)]]))
    await run(null, { warehouse: earlier })
    await run(100, { warehouse: earlier, at: at(1) })
    expect(await readHistoryState(env.READ_DB, "mezo", wallet)).toMatchObject({
      high: { ts: Number(long[300]?.timestamp) },
      complete: true,
    })
    // The 20 claims the backfill added are in epochs Earned covered
    // already: only its USD moves, and the document is still rewritten.
    const before = await earned()
    expect(before).toMatchObject({
      usd: "50.00",
      fromEpoch: claimEpoch(long.at(-1)),
      toEpoch: claimEpoch(long[300]),
    })
    return before
  }

  /** The Earned of every claim, once the gap is closed. */
  const whole = {
    usd: "200.00",
    fromEpoch: claimEpoch(long.at(-1)),
    toEpoch: claimEpoch(long[0]),
  }

  it("carries Earned through a full gap read, until the gap closes", async () => {
    const before = await storeEarlier()
    // 200 of the 220 missing transactions: still a gap.
    expect((await run(null, { warehouse: later, at: at(2) })).status).toBe("ok")
    expect(await earned()).toEqual(before)
    // The last 20: closed, and Earned counts every claim.
    await run(null, { warehouse: later, at: at(3) })
    expect(await earned()).toMatchObject(whole)
  })

  it("carries Earned while the gap read fails", async () => {
    const before = await storeEarlier()
    const failing: WarehouseReader = {
      ...later,
      async walletHistory() {
        throw new Error("canceling statement due to statement timeout")
      },
    }
    expect((await run(null, { warehouse: failing, at: at(2) })).status).toBe(
      "ok",
    )
    expect(await earned()).toEqual(before)
    await run(null, { warehouse: later, at: at(3) })
    await run(null, { warehouse: later, at: at(4) })
    expect(await earned()).toMatchObject(whole)
  })

  it("carries Earned while the run's budget leaves the wallet for later", async () => {
    const before = await storeEarlier()
    // Another wallet's gap waited longer and takes 280 of the run's 300.
    const other = `0x${"7c".repeat(20)}`
    const others = Array.from({ length: 400 }, (_, index) =>
      claim(index, other),
    )
    await historyStateStatement(env.READ_DB, "mezo", other, {
      low: pointOf(others[399]),
      high: pointOf(others[300]),
      complete: true,
      updatedAt: 0,
    }).run()
    const both = readerFor(
      new Map([
        [wallet, long],
        [other, others],
      ]),
    )
    expect((await run(null, { warehouse: both, at: at(2) })).status).toBe("ok")
    // Left for later: nothing of the gap is read or stored.
    expect(await readHistoryState(env.READ_DB, "mezo", wallet)).toMatchObject({
      high: { ts: Number(long[300]?.timestamp) },
    })
    expect(await earned()).toEqual(before)
    // It waited longest now, so it leads, and its gap closes over two runs.
    await run(null, { warehouse: later, at: at(3) })
    expect(await earned()).toEqual(before)
    await run(null, { warehouse: later, at: at(4) })
    expect(await earned()).toMatchObject(whole)
  })
})

describe("values when claimed", () => {
  async function storedValued(): Promise<{ claims: number; valued: number }> {
    const { results } = await env.READ_DB.prepare(
      "SELECT body FROM wallet_activity_rows WHERE wallet = ?1",
    )
      .bind(wallet)
      .all<{ body: string }>()
    const rows = results.map((row) =>
      activityRowSchema.parse(JSON.parse(row.body)),
    )
    return {
      claims: rows.filter((row) => row.type === "claim").length,
      valued: rows.filter(
        (row) => row.type === "claim" && row.atClaim !== undefined,
      ).length,
    }
  }

  async function earnedNow(who = wallet) {
    return (await readReadModel(env.READ_DB, "mezo", "wallet-rewards", who))
      ?.data.earned
  }

  it("never fails the run when the price history fails", async () => {
    let calls = 0
    const result = await run(null, {
      priceHistory: async () => {
        calls += 1
        throw new Error("CoinGecko HTTP 503")
      },
    })
    expect(calls).toBe(2)
    expect(result.status).toBe("ok")
    expect(await documentExists("wallet-overview")).toBe(true)
    // Nothing checked: every claim waits, none is $0.
    expect(await earnedNow()).toMatchObject({
      usd: "0.00",
      whenClaimed: { unpriced: 0, pending: 80 },
    })
    expect(await storedValued()).toEqual({ claims: 80, valued: 0 })
  })

  it("gives rows stored before their day was priced their value, within the run's budget", async () => {
    await run(null)
    expect(await storedValued()).toEqual({ claims: 80, valued: 0 })
    await seedMezoPrices("0.5")
    const result = await run(null, { at: recording.nowSeconds + 60 })
    expect(result.status).toBe("ok")
    expect(await storedValued()).toEqual({ claims: 80, valued: 80 })
    expect(await earnedNow()).toMatchObject({
      usd: "40.00",
      whenClaimed: { unpriced: 0, pending: 0 },
    })
    const activity = await readReadModel(
      env.READ_DB,
      "mezo",
      "wallet-activity",
      wallet,
    )
    const first = activity?.data.rows[0]
    expect(first?.type === "claim" && first.atClaim?.usd).toBe("0.50")
  })

  async function checkedThrough(token: "btc" | "mezo", through: string) {
    await env.READ_DB.prepare(
      `INSERT OR REPLACE INTO job_cursors (job, network, value, updated_at)
       VALUES (?1, 'mezo', ?2, 0)`,
    )
      .bind(
        claimPricesCursor(token),
        JSON.stringify({
          from: addDays(utcDay(recording.nowSeconds), -40),
          through,
        }),
      )
      .run()
  }

  it("carries Earned while a token's daily history is behind", async () => {
    const today = utcDay(recording.nowSeconds)
    await seedMezoPrices("0.5")
    await checkedThrough("btc", today)
    await run(null)
    const before = await earnedNow()
    expect(before).toMatchObject({
      usd: "40.00",
      whenClaimed: { unpriced: 0, pending: 0 },
    })
    // MEZO's history stalls 6 days back: its later claims wait for a call.
    const stalled = addDays(today, -6)
    await env.READ_DB.prepare("DELETE FROM token_price_daily WHERE day > ?1")
      .bind(stalled)
      .run()
    await checkedThrough("mezo", stalled)
    const result = await run(null, { at: recording.nowSeconds + 60 })
    expect(result.status).toBe("ok")
    expect(await earnedNow()).toEqual(before)
    // Its rows are still valued where they can be.
    const activity = await readReadModel(
      env.READ_DB,
      "mezo",
      "wallet-activity",
      wallet,
    )
    const valued = (activity?.data.rows ?? []).filter(
      (row) => row.type === "claim" && row.atClaim !== undefined,
    )
    expect(valued.length).toBeGreaterThan(0)

    // Never succeeded (a first call that failed): carried too.
    await env.READ_DB.prepare("DELETE FROM token_price_daily").run()
    await checkedThrough("mezo", addDays(today, -41))
    await run(null, { at: recording.nowSeconds + 120 })
    expect(await earnedNow()).toEqual(before)
  })

  /** `token` at `usd` every day from 40 days back to `through`, checked. */
  async function pricedThrough(
    token: "btc" | "mezo",
    usd: string,
    through: string,
  ) {
    const statements: D1PreparedStatement[] = []
    for (let day = historyStart; day <= through; day = addDays(day, 1)) {
      statements.push(
        env.READ_DB.prepare(
          `INSERT OR REPLACE INTO token_price_daily
             (token, day, usd, source, priced_at, updated_at)
           VALUES (?1, ?2, ?3, 'coingecko', 0, 0)`,
        ).bind(token, day, usd),
      )
    }
    await env.READ_DB.batch(statements)
    await checkedThrough(token, through)
  }

  /** The document's claims (its latest 80) after `day`: still pending. */
  function claimsAfter(events: readonly ActivityEventRow[], day: string) {
    return events
      .slice(0, 80)
      .filter((event) => utcDay(Number(event.timestamp)) > day).length
  }

  it("advances Earned as older claims settle, with a recent claim waiting", async () => {
    // Both histories a day behind the latest settled day (still caught
    // up), then on it: the claims after it wait for their day to settle,
    // not for a call, so nothing carries and Earned moves as days settle.
    const today = utcDay(recording.nowSeconds)
    await pricedThrough("mezo", "0.5", addDays(today, -4))
    await checkedThrough("btc", addDays(today, -4))
    await run(null)
    const before = await earnedNow()
    expect(before?.whenClaimed?.pending).toBe(
      claimsAfter(all, addDays(today, -4)),
    )
    expect(claimsAfter(all, addDays(today, -3))).toBeGreaterThan(0)

    await pricedThrough("mezo", "0.5", addDays(today, -3))
    await checkedThrough("btc", addDays(today, -3))
    await run(null, { at: recording.nowSeconds + 60 })
    const after = await earnedNow()
    expect(after?.whenClaimed?.pending).toBe(
      claimsAfter(all, addDays(today, -3)),
    )
    expect(after?.usd).not.toBe(before?.usd)
  })

  it("advances a BTC wallet's Earned while MEZO's history is behind", async () => {
    const btcWallet = `0x${"5b".repeat(20)}`
    const btcClaims = Array.from({ length: 100 }, (_, index) =>
      claim(index, btcWallet, btcToken),
    )
    const btcReader = readerFor(new Map([[btcWallet, btcClaims]]))
    const today = utcDay(recording.nowSeconds)
    // MEZO's history stalled 6 days back; BTC's is caught up.
    await checkedThrough("mezo", addDays(today, -6))
    await pricedThrough("btc", "70000", addDays(today, -4))
    await run(null, { warehouse: btcReader })
    const before = await earnedNow(btcWallet)
    expect(before?.whenClaimed?.pending).toBe(
      claimsAfter(btcClaims, addDays(today, -4)),
    )
    expect(claimsAfter(btcClaims, addDays(today, -3))).toBeGreaterThan(0)

    await pricedThrough("btc", "70000", addDays(today, -3))
    await run(null, {
      warehouse: btcReader,
      at: recording.nowSeconds + 60,
    })
    const after = await earnedNow(btcWallet)
    expect(after?.whenClaimed?.pending).toBe(
      claimsAfter(btcClaims, addDays(today, -3)),
    )
    expect(after?.usd).not.toBe(before?.usd)
  })

  it("keeps the claims' values, and the documents, when the daily prices cannot be read", async () => {
    await seedMezoPrices("0.5")
    await checkedThrough("btc", utcDay(recording.nowSeconds))
    await run(null)
    const documents = async () => ({
      activity: await readReadModel(
        env.READ_DB,
        "mezo",
        "wallet-activity",
        wallet,
      ),
      rewards: await readReadModel(
        env.READ_DB,
        "mezo",
        "wallet-rewards",
        wallet,
      ),
      overview: await readReadModel(
        env.READ_DB,
        "mezo",
        "wallet-overview",
        wallet,
      ),
    })
    const before = await documents()
    const first = before.activity?.data.rows[0]
    expect(first?.type === "claim" && first.atClaim?.usd).toBe("0.50")
    expect(await storedValued()).toEqual({ claims: 80, valued: 80 })

    const failing = failingDb("token_price_daily")
    const result = await run(null, {
      db: failing.db,
      at: recording.nowSeconds + 60,
    })
    expect(failing.hits()).toBeGreaterThan(0)
    expect(result.status).toBe("ok")
    // Nothing else changed: no document is rewritten for want of prices.
    const after = await documents()
    expect(after.activity?.data).toEqual(before.activity?.data)
    expect(after.activity?.etag).toBe(before.activity?.etag)
    expect(after.rewards?.etag).toBe(before.rewards?.etag)
    expect(after.overview?.data.recentActivity).toEqual(
      before.overview?.data.recentActivity,
    )
    expect(await storedValued()).toEqual({ claims: 80, valued: 80 })
  })

  it("carries Earned when the daily prices cannot be read", async () => {
    await seedMezoPrices("0.5")
    await run(null)
    const before = await earnedNow()
    expect(before).toMatchObject({ usd: "40.00" })
    const failing = failingDb("token_price_daily")
    const result = await run(null, {
      db: failing.db,
      at: recording.nowSeconds + 60,
    })
    expect(failing.hits()).toBeGreaterThan(0)
    expect(result.status).toBe("ok")
    expect(await earnedNow()).toEqual(before)
  })
})
