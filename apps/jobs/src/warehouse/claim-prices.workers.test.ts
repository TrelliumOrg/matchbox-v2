import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { CoinGeckoError } from "@matchbox/api/market/coingecko"
import {
  addDays,
  claimPricesCursor,
  dayStart,
  type HistoryToken,
  readClaimPrices,
  utcDay,
  valueClaim,
} from "@matchbox/api/read-models/claim-prices"
import { btcToken, mezoToken } from "@matchbox/api/read-models/money"
import { historyRowStatements } from "@matchbox/api/read-models/wallet-history"
import {
  type ActivityRow,
  activityRowSchema,
} from "@matchbox/contracts/read-models"
import { createLogger } from "@matchbox/logger"
import { beforeEach, describe, expect, it } from "vitest"
import { resetStorage } from "../../test/reset"
import {
  claimValueReadsPerRun,
  fillClaimValues,
  fillDailyPrices,
  historyStartDay,
  type PriceHistoryFetch,
  retrySeconds,
  settleDays,
} from "./claim-prices"

const logger = createLogger({ level: "error" })
const db = () => env.READ_DB

// 20 Nov 2026, 10:00 UTC: Epoch 0's first day is 345 days back.
const now = dayStart("2026-11-20") + 10 * 3_600

/** CoinGecko's daily points: 00:00 UTC each day, and the latest price. */
function coingecko(price: (token: HistoryToken, day: string) => number) {
  const calls: { token: HistoryToken; from: number; to: number }[] = []
  const fetchHistory: PriceHistoryFetch = async (token, from, to) => {
    calls.push({ token, from, to })
    const prices: [number, number][] = []
    for (let at = dayStart(utcDay(from)); at <= to; at += 86_400) {
      if (at >= from) prices.push([at * 1000, price(token, utcDay(at))])
    }
    // The latest point is the price now, not at 00:00: never a day's.
    prices.push([to * 1000 - 1_234_000, 1])
    return { prices, market_caps: [], total_volumes: [] }
  }
  return { fetchHistory, calls }
}

async function rowCount(): Promise<number> {
  const row = await db()
    .prepare("SELECT count(*) AS n FROM token_price_daily")
    .first<{ n: number }>()
  return row?.n ?? 0
}

beforeEach(async () => {
  await applyD1Migrations(db(), env.TEST_MIGRATIONS)
  await resetStorage()
  await db().prepare("DELETE FROM wallet_activity_rows").run()
})

describe("daily price history", () => {
  it("stores each settled day once, back to Epoch 0, one call a token", async () => {
    const source = coingecko((token, day) =>
      token === "btc" ? 70_000.5 : day < "2026-04-14" ? 0.0123456789 : 0.004,
    )
    const first = await fillDailyPrices({
      db: db(),
      fetchHistory: source.fetchHistory,
      limitedReach: true,
      nowSeconds: now,
      logger,
    })
    expect(first).toEqual({ calls: 2, rows: 2 * 350, failed: [] })
    expect(source.calls.map((call) => call.token)).toEqual(["btc", "mezo"])
    const prices = await readClaimPrices(db(), "mezo")
    const latest = addDays(utcDay(now), -settleDays)
    expect(prices.coverage.mezo).toEqual({
      from: historyStartDay,
      through: latest,
      pricedFrom: historyStartDay,
    })
    expect(prices.daily.get("mezo:2025-12-11")).toEqual({
      usd: "0.0123456789",
      source: "coingecko",
    })
    expect(prices.daily.get("btc:2026-06-01")?.usd).toBe("70000.5")
    // The latest point (now) is not a day's price, and the last days wait.
    expect(prices.daily.has(`btc:${utcDay(now)}`)).toBe(false)
    expect(prices.daily.has(`btc:${addDays(latest, 1)}`)).toBe(false)

    // The same day: nothing to ask. The next day: one day, one call each.
    const again = await fillDailyPrices({
      db: db(),
      fetchHistory: source.fetchHistory,
      limitedReach: true,
      nowSeconds: now + 3_600,
      logger,
    })
    expect(again.calls).toBe(0)
    const tomorrow = await fillDailyPrices({
      db: db(),
      fetchHistory: coingecko(() => 999).fetchHistory,
      limitedReach: true,
      nowSeconds: now + 86_400,
      logger,
    })
    expect(tomorrow).toEqual({ calls: 2, rows: 2, failed: [] })
    expect(await rowCount()).toBe(2 * 351)
    // A stored day is never rewritten.
    expect(
      (await readClaimPrices(db(), "mezo")).daily.get("btc:2026-06-01"),
    ).toMatchObject({ usd: "70000.5" })
  })

  it("spends no call before migration 0008", async () => {
    await db().prepare("DROP TABLE token_price_daily").run()
    try {
      const source = coingecko(() => 1)
      const result = await fillDailyPrices({
        db: db(),
        fetchHistory: source.fetchHistory,
        limitedReach: true,
        nowSeconds: now,
        logger,
      })
      expect(result).toEqual({ calls: 0, rows: 0, failed: [] })
      expect(source.calls).toHaveLength(0)
      // Claims are then pending, not $0 and not an error.
      expect(await readClaimPrices(db(), "mezo")).toMatchObject({
        coverage: { btc: null, mezo: null },
      })
    } finally {
      // Migrations are applied once: put the table back for the others.
      const migration = env.TEST_MIGRATIONS.find((each) =>
        each.name.startsWith("0008"),
      )
      await db().batch(
        (migration?.queries ?? []).map((query) => db().prepare(query)),
      )
    }
  })

  it("checks days beyond a Demo key's reach as having no price", async () => {
    // A year after Epoch 0: its first days are out of reach.
    const later = dayStart("2027-01-20") + 3_600
    const source = coingecko(() => 1.5)
    await fillDailyPrices({
      db: db(),
      fetchHistory: source.fetchHistory,
      limitedReach: true,
      nowSeconds: later,
      logger,
    })
    expect(utcDay(source.calls[0]?.from ?? 0)).toBe(
      addDays(addDays(utcDay(later), -364), -1),
    )
    const prices = await readClaimPrices(db(), "mezo")
    expect(prices.coverage.btc?.from).toBe(historyStartDay)
    expect(prices.daily.has("btc:2025-12-11")).toBe(false)
    expect(prices.daily.has(`btc:${addDays(utcDay(later), -364)}`)).toBe(true)
  })

  it("checks nothing from an empty answer, and asks again after the wait", async () => {
    const empty: PriceHistoryFetch = async () => ({ prices: [] })
    const result = await fillDailyPrices({
      db: db(),
      fetchHistory: empty,
      limitedReach: true,
      nowSeconds: now,
      logger,
    })
    expect(result).toEqual({ calls: 2, rows: 0, failed: ["btc", "mezo"] })
    const prices = await readClaimPrices(db(), "mezo")
    // Every day still pending, none "No price".
    expect(prices.coverage.btc).toMatchObject({
      through: addDays(historyStartDay, -1),
      retryAt: now + retrySeconds,
    })
    const source = coingecko(() => 3)
    await fillDailyPrices({
      db: db(),
      fetchHistory: source.fetchHistory,
      limitedReach: true,
      nowSeconds: now + retrySeconds,
      logger,
    })
    expect(source.calls).toHaveLength(2)
    expect((await readClaimPrices(db(), "mezo")).coverage.btc?.through).toBe(
      addDays(utcDay(now), -settleDays),
    )
  })

  /** A BTC claim of 1 BTC at 00:01 UTC on `day`. */
  function btcClaim(day: string) {
    return {
      type: "claim" as const,
      id: `x-${day}`,
      txHash: `0x${"1".repeat(64)}`,
      block: 1,
      timestamp: dayStart(day) + 60,
      status: "confirmed" as const,
      actor: `0x${"2".repeat(40)}`,
      epoch: null,
      rewards: {
        usd: "1",
        tokens: [
          {
            token: {
              address: btcToken,
              symbol: "BTC",
              name: "Bitcoin",
              decimals: 18,
            },
            amount: "1",
            usd: "1",
          },
        ],
      },
      locks: [],
      gauges: [],
    }
  }

  /** CoinGecko at `usd` every day, but for the days `skip` names. */
  function withHoles(skip: (token: HistoryToken, day: string) => boolean) {
    const full = coingecko(() => 2)
    const fetchHistory: PriceHistoryFetch = async (token, from, to) => {
      const body = (await full.fetchHistory(token, from, to)) as {
        prices: [number, number][]
      }
      return {
        prices: body.prices.filter(
          ([ms]) => !skip(token, utcDay(Math.floor(ms / 1000))),
        ),
      }
    }
    return { fetchHistory, calls: full.calls }
  }

  it("checks a cut short answer only up to its first missing day", async () => {
    // BTC is missing 12 Nov to 14 Nov 2026, less than a week settled (the
    // latest settled day is 17 Nov); MEZO's list stops at 1 Sep, and the
    // days after a list's last point are never taken as no price.
    const cut = withHoles((token, day) =>
      token === "btc"
        ? day >= "2026-11-12" && day <= "2026-11-14"
        : day > "2026-09-01",
    )
    const result = await fillDailyPrices({
      db: db(),
      fetchHistory: cut.fetchHistory,
      limitedReach: true,
      nowSeconds: now,
      logger,
    })
    expect(result.failed).toEqual(["btc", "mezo"])
    const prices = await readClaimPrices(db(), "mezo")
    expect(prices.coverage.btc).toMatchObject({
      through: "2026-11-11",
      pricedFrom: historyStartDay,
      retryAt: now + retrySeconds,
    })
    expect(prices.coverage.mezo?.through).toBe("2026-09-01")
    // The points after the gap are kept: those days are priced already.
    expect(prices.daily.get("btc:2026-11-15")?.usd).toBe("2")
    // The missing days are pending, not "No price".
    expect(valueClaim(btcClaim("2026-11-13"), prices)).toBeNull()

    // After the wait the rest is asked for from the first missing day.
    const source = coingecko(() => 2)
    await fillDailyPrices({
      db: db(),
      fetchHistory: source.fetchHistory,
      limitedReach: true,
      nowSeconds: now + retrySeconds,
      logger,
    })
    expect(utcDay(source.calls[0]?.from ?? 0)).toBe("2026-11-11")
    const after = await readClaimPrices(db(), "mezo")
    expect(after.coverage.btc?.through).toBe(addDays(utcDay(now), -settleDays))
    expect(after.coverage.btc?.retryAt).toBeUndefined()
    expect(after.daily.get("btc:2026-11-13")?.usd).toBe("2")
  })

  it("checks a day CoinGecko never fills as No price once it is a week settled", async () => {
    // BTC is missing 2 Jun 2026 (months settled) and 13 Nov (4 days).
    const lines: { level: string; line: string }[] = []
    const watched = createLogger({
      level: "warn",
      format: "json",
      sink: (level, line) => lines.push({ level, line }),
    })
    const holes = withHoles(
      (token, day) =>
        token === "btc" && (day === "2026-06-02" || day === "2026-11-13"),
    )
    const result = await fillDailyPrices({
      db: db(),
      fetchHistory: holes.fetchHistory,
      limitedReach: true,
      nowSeconds: now,
      logger: watched,
    })
    // The young gap still stops the walk, and is asked for again.
    expect(result.failed).toEqual(["btc"])
    const prices = await readClaimPrices(db(), "mezo")
    expect(prices.coverage.btc).toMatchObject({
      through: "2026-11-12",
      retryAt: now + retrySeconds,
    })
    // The old one is checked with no price: its claims are "No price", and
    // every claim after it is valued.
    expect(valueClaim(btcClaim("2026-06-02"), prices)).toMatchObject({
      usd: "0.00",
      tokens: [{ price: null, day: "2026-06-02" }],
    })
    expect(valueClaim(btcClaim("2026-06-03"), prices)?.usd).toBe("2.00")
    expect(valueClaim(btcClaim("2026-11-12"), prices)?.usd).toBe("2.00")
    expect(valueClaim(btcClaim("2026-11-13"), prices)).toBeNull()
    const logged = lines.map((each) => JSON.parse(each.line))
    expect(logged).toContainEqual(
      expect.objectContaining({
        message: "claim_prices_day_missing",
        asset: "btc",
        day: "2026-06-02",
      }),
    )
    // The young gap is the failure, and says which token.
    expect(logged).toContainEqual(
      expect.objectContaining({
        message: "claim_prices_history_failed",
        asset: "btc",
        detail: "No daily point for 2026-11-13",
      }),
    )
    expect(
      logged.filter((each) => each.message === "claim_prices_day_missing"),
    ).toHaveLength(1)

    // The young day comes in on the retry; the walk finishes.
    await fillDailyPrices({
      db: db(),
      fetchHistory: coingecko(() => 2).fetchHistory,
      limitedReach: true,
      nowSeconds: now + retrySeconds,
      logger,
    })
    const after = await readClaimPrices(db(), "mezo")
    expect(after.coverage.btc?.through).toBe(addDays(utcDay(now), -settleDays))
    expect(valueClaim(btcClaim("2026-11-13"), after)?.usd).toBe("2.00")

    // An answer that later has the old day stores it, and the stored "No
    // price" is valued again.
    const noPrice = {
      ...btcClaim("2026-06-02"),
      atClaim: valueClaim(btcClaim("2026-06-02"), after) ?? undefined,
    }
    await db()
      .prepare(
        `INSERT INTO token_price_daily
           (token, day, usd, source, priced_at, updated_at)
         VALUES ('btc', '2026-06-02', '3', 'coingecko', 0, 0)`,
      )
      .run()
    const repaired = await readClaimPrices(db(), "mezo")
    expect(valueClaim(noPrice, repaired)?.usd).toBe("3.00")
  })

  it("finds a token's first point from the history, and tests it again", async () => {
    // MEZO's daily history starts on 1 Apr 2026, but the first answer
    // comes back without April.
    const mezoStart = "2026-04-01"
    const history = coingecko(() => 0.02)
    const firstAnswer: PriceHistoryFetch = async (token, from, to) => {
      const body = (await history.fetchHistory(token, from, to)) as {
        prices: [number, number][]
      }
      const start = token === "mezo" ? "2026-05-01" : "0000"
      return {
        prices: body.prices.filter(([ms]) => utcDay(ms / 1000) >= start),
      }
    }
    await fillDailyPrices({
      db: db(),
      fetchHistory: firstAnswer,
      limitedReach: true,
      nowSeconds: now,
      logger,
    })
    const first = await readClaimPrices(db(), "mezo")
    expect(first.coverage.mezo).toMatchObject({
      from: historyStartDay,
      through: addDays(utcDay(now), -settleDays),
      pricedFrom: "2026-05-01",
    })
    expect(first.coverage.mezo?.retryAt).toBeUndefined()
    // BTC has a point on the first day asked: its history starts there.
    expect(first.coverage.btc?.pricedFrom).toBe(historyStartDay)

    // The next day's call starts the day before the first point.
    const real = coingecko(() => 0.02)
    const fromApril: PriceHistoryFetch = async (token, from, to) => {
      const body = (await real.fetchHistory(token, from, to)) as {
        prices: [number, number][]
      }
      return {
        prices: body.prices.filter(
          ([ms]) => token === "btc" || utcDay(ms / 1000) >= mezoStart,
        ),
      }
    }
    await fillDailyPrices({
      db: db(),
      fetchHistory: fromApril,
      limitedReach: true,
      nowSeconds: now + 86_400,
      logger,
    })
    // The next day's MEZO call asks from the first day again, in one call.
    const mezoCall = real.calls.find((call) => call.token === "mezo")
    expect(utcDay((mezoCall?.from ?? 0) + 3_600)).toBe(historyStartDay)
    // BTC's first point is the first day asked: only the new day.
    const btcCall = real.calls.find((call) => call.token === "btc")
    expect(utcDay((btcCall?.from ?? 0) + 3_600)).toBe(
      addDays(utcDay(now), 1 - settleDays),
    )
    const after = await readClaimPrices(db(), "mezo")
    expect(after.coverage.mezo).toMatchObject({
      through: addDays(utcDay(now), 1 - settleDays),
      pricedFrom: mezoStart,
    })
    expect(after.daily.get("mezo:2026-04-01")?.usd).toBe("0.02")
    expect(after.daily.get("mezo:2026-04-20")?.usd).toBe("0.02")
    // Before the first point: checked, no price.
    expect(after.daily.has("mezo:2026-03-31")).toBe(false)
    expect(after.coverage.mezo?.from).toBe(historyStartDay)
  })

  it("survives the source failing or rate limiting, and waits to retry", async () => {
    let calls = 0
    const failing: PriceHistoryFetch = async () => {
      calls += 1
      throw new CoinGeckoError(429)
    }
    const result = await fillDailyPrices({
      db: db(),
      fetchHistory: failing,
      limitedReach: true,
      nowSeconds: now,
      logger,
    })
    expect(result).toEqual({ calls: 2, rows: 0, failed: ["btc", "mezo"] })
    expect(await rowCount()).toBe(0)
    // Nothing is checked: every BTC and MEZO day stays pending.
    const prices = await readClaimPrices(db(), "mezo")
    expect(prices.coverage.btc?.through).toBe(addDays(historyStartDay, -1))

    // Not again within the retry wait, whatever it answers.
    await fillDailyPrices({
      db: db(),
      fetchHistory: failing,
      limitedReach: true,
      nowSeconds: now + retrySeconds - 1,
      logger,
    })
    expect(calls).toBe(2)

    // A body that is not a price list is a failure too.
    const odd = await fillDailyPrices({
      db: db(),
      fetchHistory: async () => ({ status: { error_code: 10_005 } }),
      limitedReach: true,
      nowSeconds: now + retrySeconds,
      logger,
    })
    expect(odd.failed).toEqual(["btc", "mezo"])

    const recovered = await fillDailyPrices({
      db: db(),
      fetchHistory: coingecko(() => 2).fetchHistory,
      limitedReach: true,
      nowSeconds: now + 2 * retrySeconds,
      logger,
    })
    expect(recovered.failed).toEqual([])
    expect(recovered.rows).toBeGreaterThan(600)
  })
})

describe("stored claims' values", () => {
  const day = "2026-03-12"
  const claimedAt = dayStart(day) + 3_600

  function claimRow(
    wallet: string,
    index: number,
    at = claimedAt,
  ): ActivityRow {
    const tx = `0x${(index + 1).toString(16).padStart(64, "0")}`
    return activityRowSchema.parse({
      type: "claim",
      id: `${tx}-1`,
      txHash: tx,
      block: 1 + index,
      timestamp: at + index,
      status: "confirmed",
      actor: wallet,
      epoch: null,
      rewards: {
        usd: "9.99",
        tokens: [
          {
            token: {
              address: mezoToken,
              symbol: "MEZO",
              name: "Mezo",
              decimals: 18,
            },
            amount: "1000.000000000000000001",
            usd: "9.99",
          },
        ],
      },
      locks: [],
      gauges: [],
    })
  }

  async function store(wallet: string, rows: ActivityRow[]): Promise<void> {
    const statements = await historyRowStatements(db(), "mezo", wallet, rows, 1)
    for (let start = 0; start < statements.length; start += 50) {
      await db().batch(statements.slice(start, start + 50))
    }
  }

  async function seed(through: string): Promise<void> {
    await db().batch([
      db()
        .prepare(
          `INSERT OR REPLACE INTO token_price_daily
             (token, day, usd, source, priced_at, updated_at)
           VALUES ('mezo', ?1, '0.01', 'coingecko', 0, 0)`,
        )
        .bind(day),
      db()
        .prepare(
          `INSERT OR REPLACE INTO job_cursors (job, network, value, updated_at)
           VALUES (?1, 'mezo', ?2, 0)`,
        )
        .bind(
          claimPricesCursor("mezo"),
          JSON.stringify({ from: historyStartDay, through }),
        ),
    ])
  }

  async function valued(): Promise<number> {
    const { results } = await db()
      .prepare("SELECT body FROM wallet_activity_rows")
      .all<{ body: string }>()
    return results.filter((row) => {
      const parsed = activityRowSchema.parse(JSON.parse(row.body))
      return parsed.type === "claim" && parsed.atClaim !== undefined
    }).length
  }

  const wallets = ["0x1", "0x2", "0x3"].map((prefix) =>
    `${prefix}${"0".repeat(39)}`.slice(0, 42),
  )

  it("fills rows stored before their day was priced, within the budget", async () => {
    for (const [index, wallet] of wallets.entries()) {
      await store(
        wallet,
        Array.from({ length: 150 }, (_, row) =>
          claimRow(wallet, index * 1_000 + row),
        ),
      )
    }
    await seed(day)
    const prices = await readClaimPrices(db(), "mezo")
    const first = await fillClaimValues({
      db: db(),
      prices,
      budget: 300,
      nowSeconds: 10,
    })
    expect(first).toEqual({ read: 300, written: 300, done: false })
    expect(await valued()).toBe(300)
    const second = await fillClaimValues({
      db: db(),
      prices,
      budget: 300,
      nowSeconds: 20,
    })
    expect(second).toEqual({ read: 150, written: 150, done: true })
    const { results } = await db()
      .prepare("SELECT body FROM wallet_activity_rows LIMIT 1")
      .all<{ body: string }>()
    const row = activityRowSchema.parse(JSON.parse(results[0]?.body ?? "{}"))
    // 1000.000000000000000001 MEZO at $0.01, exactly.
    expect(row.type === "claim" && row.atClaim).toEqual({
      usd: "10.00",
      tokens: [
        {
          token: mezoToken,
          price: "0.01",
          usd: "10.00",
          day,
          source: "coingecko",
          pricedAs: "mezo",
        },
      ],
    })
    // Done until more days are checked.
    expect(
      await fillClaimValues({ db: db(), prices, budget: 300, nowSeconds: 30 }),
    ).toEqual({ read: 0, written: 0, done: true })
    // No budget left by the history: nothing read or written.
    await seed(addDays(day, 1))
    expect(
      await fillClaimValues({
        db: db(),
        prices: await readClaimPrices(db(), "mezo"),
        budget: 0,
        nowSeconds: 40,
      }),
    ).toEqual({ read: 0, written: 0, done: false })
  })

  it("passes over pending claims and values them once their day is checked", async () => {
    const [wallet = ""] = wallets
    await store(wallet, [
      claimRow(wallet, 0),
      claimRow(wallet, 1, dayStart(addDays(day, 2))),
    ])
    await seed(day)
    const first = await fillClaimValues({
      db: db(),
      prices: await readClaimPrices(db(), "mezo"),
      budget: 300,
      nowSeconds: 10,
    })
    expect(first).toEqual({ read: 2, written: 1, done: true })
    // Two days later, checked with no price: "No price", recorded.
    await seed(addDays(day, 2))
    const second = await fillClaimValues({
      db: db(),
      prices: await readClaimPrices(db(), "mezo"),
      budget: 300,
      nowSeconds: 20,
    })
    expect(second).toEqual({ read: 2, written: 1, done: true })
    expect(await valued()).toBe(2)
  })

  it("values a stored No price again once its day has a price", async () => {
    const [wallet = ""] = wallets
    const later = dayStart(addDays(day, 2)) + 60
    await store(wallet, [claimRow(wallet, 0), claimRow(wallet, 1, later)])
    // Checked through day + 2 with only `day` priced: "No price" stored.
    await seed(addDays(day, 2))
    await fillClaimValues({
      db: db(),
      prices: await readClaimPrices(db(), "mezo"),
      budget: 300,
      nowSeconds: 10,
    })
    expect(await valued()).toBe(2)
    // Done, and unchanged coverage reads nothing more.
    expect(
      await fillClaimValues({
        db: db(),
        prices: await readClaimPrices(db(), "mezo"),
        budget: 300,
        nowSeconds: 20,
      }),
    ).toEqual({ read: 0, written: 0, done: true })
    // A later answer prices day + 2 and checks one more day.
    await db()
      .prepare(
        `INSERT INTO token_price_daily
           (token, day, usd, source, priced_at, updated_at)
         VALUES ('mezo', ?1, '0.02', 'coingecko', 0, 0)`,
      )
      .bind(addDays(day, 2))
      .run()
    await seed(addDays(day, 3))
    const repaired = await fillClaimValues({
      db: db(),
      prices: await readClaimPrices(db(), "mezo"),
      budget: 300,
      nowSeconds: 30,
    })
    // Only the No price row is rewritten.
    expect(repaired).toEqual({ read: 2, written: 1, done: true })
    const { results } = await db()
      .prepare("SELECT body FROM wallet_activity_rows ORDER BY sort_ts")
      .all<{ body: string }>()
    const values = results.map((row) => {
      const parsed = activityRowSchema.parse(JSON.parse(row.body))
      return parsed.type === "claim" ? parsed.atClaim?.usd : null
    })
    expect(values).toEqual(["10.00", "20.00"])
  })

  it("never replaces a valued row with one built without the prices", async () => {
    const [wallet = ""] = wallets
    await store(wallet, [claimRow(wallet, 0)])
    await seed(day)
    await fillClaimValues({
      db: db(),
      prices: await readClaimPrices(db(), "mezo"),
      budget: 300,
      nowSeconds: 10,
    })
    expect(await valued()).toBe(1)
    // A run that could not read the prices stores the row unvalued, with
    // another USD: the stored value stays.
    const unvalued = claimRow(wallet, 0)
    if (unvalued.type !== "claim") throw new Error("Expected a claim")
    await store(wallet, [
      { ...unvalued, rewards: { ...unvalued.rewards, usd: "1.23" } },
    ])
    expect(await valued()).toBe(1)
  })

  it("reads a page a run, at most", async () => {
    const [wallet = ""] = wallets
    await store(
      wallet,
      Array.from({ length: claimValueReadsPerRun + 20 }, (_, row) =>
        claimRow(wallet, row, dayStart(addDays(day, 5))),
      ),
    )
    // Every claim pending: a run reads one page and writes nothing.
    await seed(day)
    const result = await fillClaimValues({
      db: db(),
      prices: await readClaimPrices(db(), "mezo"),
      budget: 300,
      nowSeconds: 10,
    })
    expect(result).toEqual({
      read: claimValueReadsPerRun,
      written: 0,
      done: false,
    })
  })
})
