import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import type { ActivityRow } from "@matchbox/contracts/read-models"
import {
  demoBlock,
  demoGauges,
  demoNow,
  demoTokens,
} from "@matchbox/contracts/read-models/fixtures"
import { historyCsvColumns } from "@matchbox/contracts/read-models/history-csv"
import { EPOCH_SECONDS, EPOCH_ZERO_START } from "@matchbox/domain"
import {
  createMemoryRateLimitClient,
  errorHandler,
  notFoundHandler,
} from "@matchbox/server"
import { Hono } from "hono"
import { beforeEach, describe, expect, it } from "vitest"
import type { ApiEnv } from "../context"
import { claimPricesCursor, readClaimPrices, utcDay } from "./claim-prices"
import { type ExportSummary, historyCsvStream } from "./history-export"
import registerInternalProRoutes, { forgetLiveBuilds } from "./routes"
import { writeReadModels } from "./store"
import {
  type HistoryState,
  historyBackfillCursor,
  historyRowStatements,
  historyStateStatement,
} from "./wallet-history"

const wallet = `0x${"5a".repeat(20)}`
const lock = { escrow: "vemezo" as const, tokenId: "9" }

function hash(kind: number, index: number): string {
  return `0x${kind.toString(16).padStart(2, "0")}${(index + 1).toString(16).padStart(62, "0")}`
}

function ref(epoch: number) {
  const start = EPOCH_ZERO_START + epoch * EPOCH_SECONDS
  return { number: epoch, start, end: start + EPOCH_SECONDS }
}

function vote(index: number, timestamp: number): ActivityRow {
  return {
    type: "vote",
    id: `${hash(1, index)}-2`,
    txHash: hash(1, index),
    block: 1_000 + index,
    timestamp,
    status: "confirmed",
    actor: wallet,
    lock,
    epoch: ref(Math.floor((timestamp - EPOCH_ZERO_START) / EPOCH_SECONDS)),
    votes: "10",
    allocations: [{ gauge: demoGauges.kilnLabs, basisPoints: 10_000 }],
  }
}

function claim(index: number, timestamp: number): ActivityRow {
  return {
    type: "claim",
    id: `${hash(2, index)}-4`,
    txHash: hash(2, index),
    block: 900 + index,
    timestamp,
    status: "confirmed",
    actor: wallet,
    epoch: null,
    rewards: {
      usd: "0.50",
      tokens: [
        {
          token: demoTokens.mezo,
          amount: "2.000000000000000001",
          usd: "0.50",
        },
      ],
    },
    locks: [lock],
    gauges: [demoGauges.kilnLabs],
  }
}

/** `count` rows, newest first, every 20th a claim, 10 minutes apart. */
function history(count: number): ActivityRow[] {
  const newest = EPOCH_ZERO_START + 40 * EPOCH_SECONDS
  return Array.from({ length: count }, (_, index) =>
    index % 20 === 0
      ? claim(index, newest - index * 600)
      : vote(index, newest - index * 600),
  )
}

async function store(
  rows: readonly ActivityRow[],
  documentSize: number,
  state: HistoryState | null,
) {
  await writeReadModels(env.READ_DB, [
    {
      network: "mezo",
      kind: "wallet-activity",
      key: wallet,
      block: demoBlock,
      source: "warehouse",
      updatedAt: demoNow,
      data: {
        address: wallet,
        rows: rows.slice(0, documentSize),
        nextCursor: null,
      },
    },
  ])
  if (state === null) return
  const statements = await historyRowStatements(
    env.READ_DB,
    "mezo",
    wallet,
    rows,
    1,
  )
  for (let start = 0; start < statements.length; start += 500) {
    await env.READ_DB.batch(statements.slice(start, start + 500))
  }
  await historyStateStatement(env.READ_DB, "mezo", wallet, state).run()
}

function stateOf(
  rows: readonly ActivityRow[],
  complete: boolean,
): HistoryState {
  const newest = rows[0] as ActivityRow
  const oldest = rows.at(-1) as ActivityRow
  return {
    low: { ts: oldest.timestamp, tx: oldest.txHash },
    high: { ts: newest.timestamp, tx: newest.txHash },
    complete,
    updatedAt: 1,
  }
}

const limits = createMemoryRateLimitClient(() => demoNow * 1000)

function app(readDb: D1Database = env.READ_DB) {
  const hono = new Hono<ApiEnv>()
  hono.onError(errorHandler())
  hono.notFound(notFoundHandler)
  registerInternalProRoutes(hono, {
    readDb,
    readPrices: async () => null,
    cache: null,
    heads: null,
    network: "mezo",
    liveWallet: null,
    rateLimits: limits,
    nowSeconds: () => demoNow,
  })
  return hono
}

function csvLines(text: string): string[] {
  expect(text.endsWith("\r\n")).toBe(true)
  return text.slice(0, -2).split("\r\n")
}

beforeEach(async () => {
  await applyD1Migrations(env.READ_DB, env.TEST_MIGRATIONS)
  await env.READ_DB.batch(
    [
      "read_models",
      "wallet_activity_rows",
      "wallet_history_state",
      "job_cursors",
      "token_price_daily",
    ].map((table) => env.READ_DB.prepare(`DELETE FROM ${table}`)),
  )
  limits.reset()
  forgetLiveBuilds()
})

describe("history CSV route", () => {
  it("downloads the whole stored history, the document then the stored rows", async () => {
    const rows = history(300)
    await store(rows, 80, stateOf(rows, true))
    const response = await app().request(
      `/internal/pro/wallets/${wallet.toUpperCase().replace("0X", "0x")}/activity.csv`,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8")
    const date = new Date(demoNow * 1000).toISOString().slice(0, 10)
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="matchbox-0x5a5a-5a5a-activity-${date}.csv"`,
    )
    // UTF-8's byte order mark first, for Excel (text() takes it off).
    const bytes = new Uint8Array(await response.clone().arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const lines = csvLines(await response.text())
    expect(lines[0]).toBe(historyCsvColumns.join(","))
    // One line a row (one token each, or none), newest first, no note.
    expect(lines).toHaveLength(1 + 300)
    expect(lines.filter((line) => line.includes(",claim,"))).toHaveLength(15)
    expect(lines.at(-1)).toContain(rows.at(-1)?.txHash)
    // A claim stored before its day was priced says so.
    expect(lines[1]).toContain("2.000000000000000001,,,Not priced yet,")

    // The same history again: a 304 that reads no page.
    const again = await app().request(
      `/internal/pro/wallets/${wallet}/activity.csv`,
      { headers: { "If-None-Match": response.headers.get("etag") ?? "" } },
    )
    expect(again.status).toBe(304)
  })

  it("lists claims alone for Rewards, valued from the daily prices", async () => {
    const rows = history(300)
    await store(rows, 80, stateOf(rows, true))
    const days = [...new Set(rows.map((row) => utcDay(row.timestamp)))].sort()
    await env.READ_DB.batch([
      ...days.map((day) =>
        env.READ_DB.prepare(
          `INSERT INTO token_price_daily
             (token, day, usd, source, priced_at, updated_at)
           VALUES ('mezo', ?1, '0.25', 'coingecko', 0, 0)`,
        ).bind(day),
      ),
      env.READ_DB.prepare(
        `INSERT INTO job_cursors (job, network, value, updated_at)
         VALUES (?1, 'mezo', ?2, 0)`,
      ).bind(
        claimPricesCursor("mezo"),
        JSON.stringify({ from: days[0], through: days.at(-1) }),
      ),
    ])
    const response = await app().request(
      `/internal/pro/wallets/${wallet}/rewards.csv`,
    )
    const lines = csvLines(await response.text())
    expect(lines).toHaveLength(1 + 15)
    // 2.000000000000000001 MEZO at $0.25 that day, exactly.
    for (const line of lines.slice(1)) {
      expect(line).toMatch(
        /,claim,0x[0-9a-f]{64},MEZO,0x7b7c0{35}1,2\.000000000000000001,0\.50,0\.25,CoinGecko daily,\d{4}-\d{2}-\d{2}T00:00:00Z,Kiln Labs,veMEZO #9$/,
      )
    }
  })

  it("ends with a note while older rows are still being added", async () => {
    const rows = history(120)
    await store(rows, 80, stateOf(rows, false))
    await env.READ_DB.prepare(
      `INSERT INTO job_cursors (job, network, value, updated_at)
       VALUES (?1, 'mezo', '100', 1)`,
    )
      .bind(historyBackfillCursor)
      .run()
    const response = await app().request(
      `/internal/pro/wallets/${wallet}/activity.csv`,
    )
    const lines = csvLines(await response.text())
    expect(lines).toHaveLength(1 + 120 + 1)
    expect(lines.at(-1)).toBe(
      "Note: history still being added. Older rows are not in this file yet.",
    )
  })

  it("keeps the wallet rules and limits downloads", async () => {
    expect(
      (await app().request("/internal/pro/wallets/0x123/activity.csv")).status,
    ).toBe(404)
    // A wallet with nothing stored and no live build.
    expect(
      (await app().request(`/internal/pro/wallets/${wallet}/activity.csv`))
        .status,
    ).toBe(404)
    const rows = history(10)
    await store(rows, 10, null)
    const headers = {
      "X-Matchbox-Client": "matchbox-pro-v2",
      "X-Matchbox-End-User": "a".repeat(43),
    }
    const statuses: number[] = []
    for (let index = 0; index < 7; index += 1) {
      const response = await app().request(
        `/internal/pro/wallets/${wallet}/rewards.csv`,
        { headers },
      )
      statuses.push(response.status)
      await response.arrayBuffer()
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 429])
  })

  it("charges a download before its reads, a 404 too, and never a HEAD", async () => {
    const headers = {
      "X-Matchbox-Client": "matchbox-pro-v2",
      "X-Matchbox-End-User": "b".repeat(43),
    }
    const path = `/internal/pro/wallets/${wallet}/rewards.csv`
    let prepared = 0
    const db = new Proxy(env.READ_DB, {
      get(target, property) {
        if (property === "prepare") prepared += 1
        const value: unknown = Reflect.get(target, property)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    // HEAD: no read and no charge, however many.
    for (let index = 0; index < 8; index += 1) {
      const response = await app(db).request(path, { method: "HEAD", headers })
      expect(response.status).toBe(200)
      expect(response.headers.get("Content-Type")).toBe(
        "text/csv; charset=utf-8",
      )
    }
    expect(prepared).toBe(0)
    // A wallet with no history: each 404 costs a download.
    const statuses: number[] = []
    for (let index = 0; index < 7; index += 1) {
      const response = await app(db).request(path, { headers })
      statuses.push(response.status)
      await response.arrayBuffer()
    }
    expect(statuses).toEqual([404, 404, 404, 404, 404, 404, 429])
    // Refused before any read.
    prepared = 0
    expect((await app(db).request(path, { headers })).status).toBe(429)
    expect(prepared).toBe(0)
  })

  it("lets an unchanged repeat through free, and charges a changed one", async () => {
    await store(history(10), 10, null)
    const headers = {
      "X-Matchbox-Client": "matchbox-pro-v2",
      "X-Matchbox-End-User": "c".repeat(43),
    }
    const path = `/internal/pro/wallets/${wallet}/rewards.csv`
    const first = await app().request(path, { headers })
    const etag = first.headers.get("ETag") ?? ""
    await first.arrayBuffer()
    for (let index = 0; index < 10; index += 1) {
      const repeat = await app().request(path, {
        headers: { ...headers, "If-None-Match": etag },
      })
      expect(repeat.status).toBe(304)
    }
    const statuses: number[] = []
    for (let index = 0; index < 6; index += 1) {
      const response = await app().request(path, {
        headers: { ...headers, "If-None-Match": '"stale"' },
      })
      statuses.push(response.status)
      await response.arrayBuffer()
    }
    // The first download and five more: the sixth is over the limit.
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
  })
})

/** READ_DB, counting queries and rows read. */
function countingDb() {
  const count = { queries: 0, rowsRead: 0 }
  const db = new Proxy(env.READ_DB, {
    get(target, property) {
      if (property === "prepare") {
        return (sql: string) =>
          new Proxy(target.prepare(sql), {
            get(statement, name) {
              if (name === "bind") {
                return (...values: unknown[]) => {
                  const bound = statement.bind(...values)
                  return {
                    all: async () => {
                      const result = await bound.all()
                      count.queries += 1
                      count.rowsRead += result.meta.rows_read
                      return result
                    },
                  }
                }
              }
              const value: unknown = Reflect.get(statement, name)
              return typeof value === "function" ? value.bind(statement) : value
            },
          })
      }
      const value: unknown = Reflect.get(target, property)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  return { db, count }
}

describe("history CSV cost", () => {
  it("reads the busiest wallet (4,500 rows) in a few pages", async () => {
    const rows = history(4_500)
    await store(rows, 80, stateOf(rows, true))
    const { db, count } = countingDb()
    const prices = await readClaimPrices(env.READ_DB, "mezo")
    const read = async (kind: "activity" | "rewards") => {
      let summary: ExportSummary | null = null
      const text = await new Response(
        historyCsvStream(
          {
            db,
            network: "mezo",
            wallet,
            kind,
            documentRows: rows.slice(0, 80),
            state: stateOf(rows, true),
            backfill: false,
            prices,
            nowSeconds: demoNow,
          },
          (done) => {
            summary = done
          },
        ),
      ).text()
      return { text, summary }
    }
    const activity = await read("activity")
    expect(activity.summary).toEqual({ rows: 4_500, queries: 9, note: null })
    expect(csvLines(activity.text)).toHaveLength(4_501)
    // The rows after the document's, read once each, and no more.
    expect(count.rowsRead).toBeLessThanOrEqual(4_420 + 9)
    const before = count.rowsRead
    const rewards = await read("rewards")
    expect(rewards.summary).toEqual({ rows: 225, queries: 1, note: null })
    // The claims index: about one row read a claim.
    expect(count.rowsRead - before).toBeLessThanOrEqual(225)
  })

  it("stops at the cap and says so", async () => {
    const rows = history(700)
    await store(rows, 80, stateOf(rows, true))
    let summary: ExportSummary | null = null
    const text = await new Response(
      historyCsvStream(
        {
          db: env.READ_DB,
          network: "mezo",
          wallet,
          kind: "activity",
          documentRows: rows.slice(0, 80),
          state: stateOf(rows, true),
          backfill: false,
          prices: null,
          nowSeconds: demoNow,
          cap: 250,
          pageSize: 100,
        },
        (done) => {
          summary = done
        },
      ),
    ).text()
    const lines = csvLines(text)
    expect(lines).toHaveLength(1 + 250 + 1)
    expect(lines.at(-1)).toBe(
      "Note: this file stops at 250 rows. Older rows are not in it.",
    )
    expect(summary).toMatchObject({ rows: 250, note: "capped" })
  })
})
