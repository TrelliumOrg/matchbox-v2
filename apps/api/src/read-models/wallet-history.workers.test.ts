import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import {
  type ActivityRow,
  walletActivityResponseSchema,
} from "@matchbox/contracts/read-models"
import {
  demoBlock,
  demoGauges,
  demoNow,
  demoTokens,
} from "@matchbox/contracts/read-models/fixtures"
import { EPOCH_SECONDS, EPOCH_ZERO_START } from "@matchbox/domain"
import { errorHandler, notFoundHandler } from "@matchbox/server"
import { Hono } from "hono"
import { beforeEach, describe, expect, it } from "vitest"
import type { ApiEnv } from "../context"
import registerInternalProRoutes, { forgetLiveBuilds } from "./routes"
import { writeReadModels } from "./store"
import {
  epochCut,
  type HistoryState,
  historyBackfillCursor,
  historyRowStatements,
  historyStateStatement,
} from "./wallet-history"

const wallet = `0x${"5a".repeat(20)}`
const lock = { escrow: "vemezo" as const, tokenId: "9" }

function hash(kind: number, epoch: number): string {
  return `0x${kind.toString(16).padStart(2, "0")}${(epoch + 1).toString(16).padStart(62, "0")}`
}

function ref(epoch: number) {
  const start = EPOCH_ZERO_START + epoch * EPOCH_SECONDS
  return { number: epoch, start, end: start + EPOCH_SECONDS }
}

/** A vote and a claim in every epoch from 0 to 49, newest first. */
function allRows(): ActivityRow[] {
  const rows: ActivityRow[] = []
  for (let epoch = 49; epoch >= 0; epoch -= 1) {
    const start = EPOCH_ZERO_START + epoch * EPOCH_SECONDS
    rows.push({
      type: "vote",
      id: `${hash(1, epoch)}-2`,
      txHash: hash(1, epoch),
      block: 1_000 + epoch,
      timestamp: start + 2 * 86_400,
      status: "confirmed",
      actor: wallet,
      lock,
      epoch: ref(epoch),
      votes: "10",
      allocations: [{ gauge: demoGauges.kilnLabs, basisPoints: 10_000 }],
    })
    if (epoch === 0) continue
    rows.push({
      type: "claim",
      id: `${hash(2, epoch)}-4`,
      txHash: hash(2, epoch),
      block: 900 + epoch,
      timestamp: start + 3_600,
      status: "confirmed",
      actor: wallet,
      epoch: ref(epoch - 1),
      rewards: {
        usd: "0.50",
        tokens: [{ token: demoTokens.mezo, amount: "2.5", usd: "0.50" }],
      },
      locks: [lock],
      gauges: [demoGauges.kilnLabs],
    })
  }
  return rows
}

const rows = allRows()
/** The document holds the newest 30 rows, as the snapshot would. */
const documentRows = rows.slice(0, 30)

function point(row: ActivityRow) {
  return { ts: row.timestamp, tx: row.txHash }
}

async function store(state: HistoryState, stored: readonly ActivityRow[]) {
  await writeReadModels(env.READ_DB, [
    {
      network: "mezo",
      kind: "wallet-activity",
      key: wallet,
      block: demoBlock,
      source: "warehouse",
      updatedAt: demoNow,
      data: { address: wallet, rows: documentRows, nextCursor: null },
    },
  ])
  await env.READ_DB.batch([
    ...(await historyRowStatements(env.READ_DB, "mezo", wallet, stored, 1)),
    historyStateStatement(env.READ_DB, "mezo", wallet, state),
  ])
}

function app() {
  const hono = new Hono<ApiEnv>()
  hono.onError(errorHandler())
  hono.notFound(notFoundHandler)
  registerInternalProRoutes(hono, {
    readDb: env.READ_DB,
    readPrices: async () => null,
    cache: null,
    heads: null,
    network: "mezo",
    liveWallet: null,
    nowSeconds: () => demoNow,
  })
  return hono
}

/** What the snapshot's last run recorded for the backfill. */
async function backfillSetting(value: string) {
  await env.READ_DB.prepare(
    `INSERT INTO job_cursors (job, network, value, updated_at)
     VALUES (?1, 'mezo', ?2, 1)
     ON CONFLICT (job, network) DO UPDATE SET value = excluded.value`,
  )
    .bind(historyBackfillCursor, value)
    .run()
}

async function page(query: string) {
  const response = await app().request(
    `/internal/pro/wallets/${wallet}/activity${query}`,
  )
  expect(response.status).toBe(200)
  return walletActivityResponseSchema.parse(await response.json()).data
}

/** Every page from the first, following the cursors. */
async function walk(category = "") {
  const pages = []
  let cursor: string | null = null
  for (let guard = 0; guard < 40; guard += 1) {
    const params = new URLSearchParams()
    if (category !== "") params.set("category", category)
    if (cursor !== null) params.set("cursor", cursor)
    const found = await page(params.size === 0 ? "" : `?${params}`)
    pages.push(found)
    if (found.nextCursor === null) break
    cursor = found.nextCursor
  }
  return pages
}

beforeEach(async () => {
  await applyD1Migrations(env.READ_DB, env.TEST_MIGRATIONS)
  await env.READ_DB.batch(
    [
      "read_models",
      "wallet_activity_rows",
      "wallet_history_state",
      "job_cursors",
    ].map((table) => env.READ_DB.prepare(`DELETE FROM ${table}`)),
  )
  forgetLiveBuilds()
})

const oldest = rows.at(-1) as ActivityRow
const newest = rows[0] as ActivityRow

describe("wallet history paging", () => {
  it("ends with the document when nothing more is stored", async () => {
    await writeReadModels(env.READ_DB, [
      {
        network: "mezo",
        kind: "wallet-activity",
        key: wallet,
        block: demoBlock,
        source: "warehouse",
        updatedAt: demoNow,
        data: { address: wallet, rows: documentRows, nextCursor: null },
      },
    ])
    const pages = await walk()
    expect(pages.flatMap((each) => each.rows)).toEqual(documentRows)
    expect(pages.at(-1)?.pending).toBe(false)
  })

  it("pages past the document to Epoch 0, each row once, in order", async () => {
    await store(
      { low: point(oldest), high: point(newest), complete: true, updatedAt: 1 },
      rows,
    )
    const pages = await walk()
    const seen = pages.flatMap((each) => each.rows)
    expect(seen.map((row) => row.id)).toEqual(rows.map((row) => row.id))
    expect(pages.at(-1)?.pending).toBe(false)
    // Stored pages end where an epoch ends (two rows an epoch here).
    for (const each of pages.slice(2, -1)) {
      expect(each.rows.length % 2).toBe(0)
    }
  })

  it("filters the stored pages like the document's", async () => {
    await store(
      { low: point(oldest), high: point(newest), complete: true, updatedAt: 1 },
      rows,
    )
    const claims = (await walk("claims")).flatMap((each) => each.rows)
    expect(claims.map((row) => row.id)).toEqual(
      rows.filter((row) => row.type === "claim").map((row) => row.id),
    )
  })

  it("says older epochs are pending where the stored history stops", async () => {
    const stored = rows.slice(0, 60)
    const last = stored.at(-1) as ActivityRow
    await store(
      { low: point(last), high: point(newest), complete: false, updatedAt: 1 },
      stored,
    )
    await backfillSetting("100")
    const pages = await walk()
    expect(pages.flatMap((each) => each.rows)).toHaveLength(60)
    expect(pages.at(-1)).toMatchObject({ nextCursor: null, pending: true })
  })

  it("promises no older epochs while the backfill is off", async () => {
    const stored = rows.slice(0, 60)
    const last = stored.at(-1) as ActivityRow
    await store(
      { low: point(last), high: point(newest), complete: false, updatedAt: 1 },
      stored,
    )
    // Off, and never recorded: the same, older rows will not arrive.
    for (const setting of ["off", null]) {
      if (setting !== null) await backfillSetting(setting)
      else await env.READ_DB.prepare("DELETE FROM job_cursors").run()
      const pages = await walk()
      expect(pages.flatMap((each) => each.rows)).toHaveLength(60)
      expect(pages.at(-1)).toMatchObject({ nextCursor: null, pending: false })
    }
    // Only the document stored: still nothing promised.
    await env.READ_DB.batch([
      env.READ_DB.prepare("DELETE FROM wallet_activity_rows"),
      env.READ_DB.prepare("DELETE FROM job_cursors"),
    ])
    await store(
      {
        low: point(documentRows.at(-1) as ActivityRow),
        high: point(newest),
        complete: false,
        updatedAt: 1,
      },
      documentRows,
    )
    expect((await walk()).at(-1)).toMatchObject({
      nextCursor: null,
      pending: false,
    })
  })

  it("caches settled history pages longer, keyed by the history alone", async () => {
    await store(
      {
        low: point(oldest),
        high: point(newest),
        complete: false,
        updatedAt: 1,
      },
      rows,
    )
    await backfillSetting("100")
    const head = await app().request(`/internal/pro/wallets/${wallet}/activity`)
    expect(head.headers.get("Cache-Control")).toContain("s-maxage=30")
    const into = (await walk()).find(
      (each) => each.nextCursor?.startsWith("h.") === true,
    )?.nextCursor as string
    const url = `/internal/pro/wallets/${wallet}/activity?cursor=${into}`
    const before = await app().request(url)
    // Older pages follow it: it cannot change as the backfill goes on.
    expect(before.headers.get("Cache-Control")).toContain("s-maxage=3600")
    // A newer document does not change a page of the stored history.
    await writeReadModels(env.READ_DB, [
      {
        network: "mezo",
        kind: "wallet-activity",
        key: wallet,
        block: demoBlock + 5,
        source: "warehouse",
        updatedAt: demoNow + 900,
        data: {
          address: wallet,
          rows: documentRows.slice(1),
          nextCursor: null,
        },
      },
    ])
    const after = await app().request(url)
    expect(after.headers.get("ETag")).toBe(before.headers.get("ETag"))
    // The last page, still pending, stays short.
    const pages = await walk()
    const lastCursor = pages.at(-2)?.nextCursor as string
    const last = await app().request(
      `/internal/pro/wallets/${wallet}/activity?cursor=${lastCursor}`,
    )
    expect(last.headers.get("Cache-Control")).toContain("s-maxage=30")
  })

  it("does not page into a gap between the history and the document", async () => {
    const older = rows.slice(40)
    await store(
      {
        low: point(oldest),
        high: point(older[0] as ActivityRow),
        complete: true,
        updatedAt: 1,
      },
      older,
    )
    const pages = await walk()
    expect(pages.flatMap((each) => each.rows)).toEqual(documentRows)
    expect(pages.at(-1)).toMatchObject({ nextCursor: null, pending: true })
  })

  it("refuses a malformed history cursor", async () => {
    const response = await app().request(
      `/internal/pro/wallets/${wallet}/activity?cursor=h.nope`,
    )
    expect(response.status).toBe(400)
  })
})

describe("epochCut", () => {
  it("finishes the last epoch, up to the hard maximum", () => {
    expect(epochCut([5, 5, 4, 4, 4, 3], 3, 100)).toBe(5)
    expect(epochCut([5, 5, 4, 4, 4, 3], 2, 100)).toBe(2)
    expect(epochCut([5, 5, 5, 5], 2, 3)).toBe(3)
    expect(epochCut([5], 25, 100)).toBe(1)
    expect(epochCut([], 25, 100)).toBe(0)
  })
})
