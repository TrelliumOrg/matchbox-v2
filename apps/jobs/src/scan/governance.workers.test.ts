import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import {
  scanEpochSourceRowSchema,
  scanGaugeEmissionRowSchema,
  scanLockDistributionSchema,
} from "@matchbox/contracts/scan"
import { EPOCH_SECONDS, EPOCH_ZERO_START } from "@matchbox/domain"
import { createLogger } from "@matchbox/logger"
import { beforeEach, describe, expect, it } from "vitest"
import { firstDistributionSql, runGovernance } from "./governance"
import {
  type EscrowRead,
  type LockChainReader,
  runLockDistribution,
} from "./lock-distribution"

// The governance summaries against Miniflare D1: emissions and voter
// totals from copied rows, and the daily lock distribution from a faked
// chain read.

const logger = createLogger({ level: "error" })
/** Epoch 48 starts Thu 12 Nov 2026; noon on Sun 15 Nov. */
const epoch = EPOCH_ZERO_START + 48 * EPOCH_SECONDS
const now = epoch + 3 * 86_400 + 12 * 3_600
const gaugeA = "0x00000000000000000000000000000000000000a1"
const gaugeB = "0x00000000000000000000000000000000000000b2"
const gaugeC = "0x00000000000000000000000000000000000000c3"
const usdc = "0x00000000000000000000000000000000000000d4"

beforeEach(async () => {
  await applyD1Migrations(env.SCAN_DB, env.SCAN_MIGRATIONS)
  await env.SCAN_DB.batch(
    [
      "activity",
      "gauge_epoch",
      "gauge_emissions",
      "epoch_sources",
      "lock_distribution",
      "scan_cursors",
      "scan_status",
    ].map((table) => env.SCAN_DB.prepare(`DELETE FROM ${table}`)),
  )
  await env.SCAN_DB.prepare(
    `INSERT INTO scan_status (id, last_run_status, last_run_at, updated_at)
     VALUES (1, 'ok', ?1, ?1)`,
  )
    .bind(now)
    .run()
})

let log = 0
function distribution(
  gauge: string,
  source: string,
  amount: string,
  timestamp: number,
) {
  log += 1
  return env.SCAN_DB.prepare(
    `INSERT INTO activity (id, tx_hash, log_index, block_number, timestamp,
       epoch_start, action_type, source, contract_address, gauge, amount)
     VALUES (?1, ?2, ?3, ?3, ?4, ?5, 'REWARD_DISTRIBUTED', ?6, ?7, ?7, ?8)`,
  ).bind(
    `0x${log.toString(16).padStart(64, "0")}-${log}-REWARD_DISTRIBUTED`,
    `0x${log.toString(16).padStart(64, "0")}`,
    log,
    timestamp,
    timestamp - ((timestamp - EPOCH_ZERO_START) % EPOCH_SECONDS),
    source,
    gauge,
    amount,
  )
}

function gaugeRow(
  gauge: string,
  source: string,
  weight: string,
  incentives: Record<string, string>,
  fees: Record<string, string> = {},
) {
  return env.SCAN_DB.prepare(
    `INSERT INTO gauge_epoch (epoch_start, gauge, source, vote_weight,
       weight_key, voters, incentives, fees, rank, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, NULL, ?1)`,
  ).bind(
    epoch,
    gauge,
    source,
    weight,
    weight.padStart(40, "0"),
    JSON.stringify(incentives),
    JSON.stringify(fees),
  )
}

async function dataVersion(): Promise<number> {
  const row = await env.SCAN_DB.prepare(
    "SELECT data_version FROM scan_status WHERE id = 1",
  ).first<{ data_version: number }>()
  return row?.data_version ?? 0
}

describe("governance summaries", () => {
  it("sums each gauge's distributions and each voter's epoch", async () => {
    await env.SCAN_DB.batch([
      distribution(gaugeA, "VALIDATORS_VOTER", "600", epoch + 60),
      distribution(gaugeA, "VALIDATORS_VOTER", "400", epoch + 120),
      distribution(gaugeB, "POOLS_VOTER", "250", epoch + 60),
      // A pool gauge's own ClaimRewards: an LP claim, not an emission.
      distribution(gaugeB, "GAUGE", "999", epoch + 90),
      // The epoch before, where the history starts.
      distribution(gaugeA, "VALIDATORS_VOTER", "7", epoch - EPOCH_SECONDS),
      gaugeRow(gaugeA, "VALIDATORS_VOTER", "50", { [usdc]: "10" }),
      gaugeRow(gaugeC, "VALIDATORS_VOTER", "25", { [usdc]: "5" }, {}),
      gaugeRow(gaugeB, "POOLS_VOTER", "0", {}, { [usdc]: "3" }),
    ])
    const result = await runGovernance({
      db: env.SCAN_DB,
      nowSeconds: now,
      logger,
    })
    expect(result.status).toBe("ok")
    expect(result.epochs.slice(0, 2)).toEqual([epoch, epoch - EPOCH_SECONDS])

    const emissions = (
      await env.SCAN_DB.prepare(
        "SELECT * FROM gauge_emissions ORDER BY epoch_start, gauge",
      ).all()
    ).results.map((row) => scanGaugeEmissionRowSchema.parse(row))
    expect(
      emissions.map((row) => [
        row.epoch_start,
        row.gauge,
        row.amount,
        row.events,
      ]),
    ).toEqual([
      [epoch - EPOCH_SECONDS, gaugeA, "7", 1],
      [epoch, gaugeA, "1000", 2],
      [epoch, gaugeB, "250", 1],
    ])

    const sources = (
      await env.SCAN_DB.prepare(
        "SELECT * FROM epoch_sources WHERE epoch_start = ?1 ORDER BY source",
      )
        .bind(epoch)
        .all()
    ).results.map((row) =>
      scanEpochSourceRowSchema.parse({
        ...row,
        incentives: JSON.parse(String(row.incentives)),
        fees: JSON.parse(String(row.fees)),
      }),
    )
    expect(sources).toMatchObject([
      {
        source: "POOLS_VOTER",
        emissions: "250",
        fees: { [usdc]: "3" },
        incentives: {},
        vote_weight: "0",
        gauges: 0,
        emission_gauges: 1,
      },
      {
        source: "VALIDATORS_VOTER",
        emissions: "1000",
        incentives: { [usdc]: "15" },
        vote_weight: "75",
        gauges: 2,
        emission_gauges: 1,
      },
    ])
  })

  it("has no emissions figure before the distribution history", async () => {
    // History starts an hour into the previous epoch: that epoch is partial
    // and the ones before have none, so neither reads as 0 MEZO.
    await env.SCAN_DB.batch([
      distribution(
        gaugeA,
        "VALIDATORS_VOTER",
        "7",
        epoch - EPOCH_SECONDS + 3_600,
      ),
      distribution(gaugeA, "VALIDATORS_VOTER", "600", epoch + 60),
      gaugeRow(gaugeA, "VALIDATORS_VOTER", "50", { [usdc]: "10" }),
    ])
    await env.SCAN_DB.prepare(
      `INSERT INTO gauge_epoch (epoch_start, gauge, source, vote_weight,
         weight_key, voters, incentives, fees, rank, updated_at)
       VALUES (?1, ?2, 'VALIDATORS_VOTER', '5', ?3, 1, '{}', '{}', NULL, ?1)`,
    )
      .bind(epoch - 2 * EPOCH_SECONDS, gaugeA, "5".padStart(40, "0"))
      .run()
    const result = await runGovernance({
      db: env.SCAN_DB,
      nowSeconds: now,
      logger,
    })
    expect(result.status).toBe("ok")
    const sources = await env.SCAN_DB.prepare(
      "SELECT epoch_start, emissions FROM epoch_sources ORDER BY epoch_start",
    ).all<{ epoch_start: number; emissions: string | null }>()
    expect(
      sources.results.map((row) => [row.epoch_start, row.emissions]),
    ).toEqual([
      [epoch - 2 * EPOCH_SECONDS, null],
      [epoch, "600"],
    ])
    const gauges = await env.SCAN_DB.prepare(
      "SELECT epoch_start FROM gauge_emissions",
    ).all<{ epoch_start: number }>()
    expect(gauges.results.map((row) => row.epoch_start)).toEqual([epoch])
  })

  it("finds where the history starts in one index row", async () => {
    const plan = await env.SCAN_DB.prepare(
      `EXPLAIN QUERY PLAN ${firstDistributionSql}`,
    ).all<{ detail: string }>()
    const detail = plan.results.map((row) => row.detail).join(" | ")
    expect(detail).toContain("activity_action")
    expect(detail).not.toContain("TEMP B-TREE")
  })

  it("writes every epoch in one served batch: one mark, one bump", async () => {
    await env.SCAN_DB.batch([
      distribution(gaugeA, "VALIDATORS_VOTER", "600", epoch + 60),
      distribution(gaugeA, "VALIDATORS_VOTER", "7", epoch - 60),
      distribution(gaugeA, "VALIDATORS_VOTER", "9", epoch - 3 * EPOCH_SECONDS),
    ])
    const version = await dataVersion()
    const first = await runGovernance({
      db: env.SCAN_DB,
      nowSeconds: now,
      logger,
    })
    // Three epochs changed: data_version moves once.
    expect(await dataVersion()).toBe(version + 1)
    expect(first.epochs.length).toBeGreaterThanOrEqual(3)
    // Unchanged: change_mark and the sweep cursor only, 2 row writes.
    const again = await runGovernance({
      db: env.SCAN_DB,
      nowSeconds: now + 300,
      logger,
    })
    expect(again.rowsWritten).toBeLessThanOrEqual(2)
    expect(await dataVersion()).toBe(version + 1)
  })

  it("writes nothing when nothing changed, and drops a vanished row", async () => {
    await env.SCAN_DB.batch([
      // The history starts at the previous epoch's flip.
      distribution(gaugeC, "VALIDATORS_VOTER", "1", epoch - EPOCH_SECONDS),
      distribution(gaugeA, "VALIDATORS_VOTER", "600", epoch + 60),
      distribution(gaugeB, "POOLS_VOTER", "250", epoch + 60),
    ])
    await runGovernance({ db: env.SCAN_DB, nowSeconds: now, logger })
    const version = await dataVersion()
    await runGovernance({ db: env.SCAN_DB, nowSeconds: now + 300, logger })
    expect(await dataVersion()).toBe(version)

    // A re-fill that loses gauge B's row: its summary row goes too.
    await env.SCAN_DB.prepare(
      "DELETE FROM activity WHERE source = 'POOLS_VOTER'",
    ).run()
    await runGovernance({ db: env.SCAN_DB, nowSeconds: now + 600, logger })
    expect(await dataVersion()).toBe(version + 1)
    const left = await env.SCAN_DB.prepare(
      "SELECT gauge FROM gauge_emissions WHERE epoch_start = ?1",
    )
      .bind(epoch)
      .all<{ gauge: string }>()
    expect(left.results.map((row) => row.gauge)).toEqual([gaugeA])
    const sources = await env.SCAN_DB.prepare(
      "SELECT source FROM epoch_sources WHERE epoch_start = ?1",
    )
      .bind(epoch)
      .all<{ source: string }>()
    expect(sources.results.map((row) => row.source)).toEqual([
      "VALIDATORS_VOTER",
    ])
  })

  it("sweeps older epochs across runs and wraps", async () => {
    await env.SCAN_DB.batch([
      distribution(gaugeA, "VALIDATORS_VOTER", "5", epoch - 10 * EPOCH_SECONDS),
    ])
    let seen = false
    for (let run = 0; run < 20 && !seen; run += 1) {
      await runGovernance({
        db: env.SCAN_DB,
        nowSeconds: now + run * 300,
        logger,
      })
      const row = await env.SCAN_DB.prepare(
        "SELECT amount FROM gauge_emissions WHERE epoch_start = ?1",
      )
        .bind(epoch - 10 * EPOCH_SECONDS)
        .first<{ amount: string }>()
      seen = row?.amount === "5"
    }
    expect(seen).toBe(true)
  })
})

// -- lock distribution ------------------------------------------------------

const btc = 10n ** 18n

function fakeRead(escrow: "vebtc" | "vemezo", time: number): EscrowRead {
  const scale = escrow === "vebtc" ? 1n : 100_000n
  const locks = [
    {
      id: 1,
      amount: 2n * btc * scale,
      end: 0,
      permanent: true,
      votingPower: 2n * btc * scale,
    },
    {
      id: 3,
      amount: (btc / 20n) * scale,
      end: time + 3 * 86_400,
      permanent: false,
      votingPower: btc / 100n,
    },
    {
      id: 4,
      amount: (btc / 200n) * scale,
      end: time - 86_400,
      permanent: false,
      votingPower: 0n,
    },
  ]
  return {
    block: 13_200_000,
    time,
    ids: 4,
    supply: locks.reduce((sum, lock) => sum + lock.amount, 0n),
    locks,
  }
}

function fakeReader(
  options: { fail?: boolean; headTime?: number } = {},
): LockChainReader & {
  reads: number
} {
  const time = options.headTime ?? now
  const reader = {
    reads: 0,
    async head() {
      return { block: 13_200_000, time }
    },
    async readEscrow(escrow: "vebtc" | "vemezo") {
      reader.reads += 1
      if (options.fail) throw new Error("RPC down")
      return fakeRead(escrow, time)
    },
  }
  return reader
}

async function lockRows(): Promise<string[]> {
  const rows = await env.SCAN_DB.prepare(
    "SELECT escrow, day FROM lock_distribution ORDER BY day, escrow",
  ).all<{ escrow: string; day: string }>()
  return rows.results.map((row) => `${row.escrow} ${row.day}`)
}

describe("lock distribution", () => {
  it("writes both escrows once a day", async () => {
    const reader = fakeReader()
    const first = await runLockDistribution({
      db: env.SCAN_DB,
      reader,
      nowSeconds: now,
      logger,
    })
    expect(first.status).toBe("done")
    const rows = await env.SCAN_DB.prepare(
      "SELECT escrow, day, data, source FROM lock_distribution ORDER BY escrow",
    ).all<{ escrow: string; day: string; data: string; source: string }>()
    expect(
      rows.results.map((row) => [row.escrow, row.day, row.source]),
    ).toEqual([
      ["vebtc", "2026-11-15", "live"],
      ["vemezo", "2026-11-15", "live"],
    ])
    const doc = scanLockDistributionSchema.parse(
      JSON.parse(rows.results[0]?.data ?? "{}"),
    )
    expect(doc.live.count).toBe(3)
    expect(doc.permanent.count).toBe(1)
    expect(doc.timed.count).toBe(1)
    expect(doc.expired.count).toBe(1)
    expect(doc.unlocks).toEqual([
      { at: now + 3 * 86_400, count: 1, amount: (btc / 20n).toString() },
    ])

    const again = await runLockDistribution({
      db: env.SCAN_DB,
      reader,
      nowSeconds: now + 300,
      logger,
    })
    expect(again.status).toBe("skipped")
    expect(reader.reads).toBe(2)
  })

  it("retries a failed read after half an hour, writing nothing", async () => {
    const failing = fakeReader({ fail: true })
    const result = await runLockDistribution({
      db: env.SCAN_DB,
      reader: failing,
      nowSeconds: now,
      logger,
    })
    expect(result.status).toBe("failed")
    const count = await env.SCAN_DB.prepare(
      "SELECT count(*) AS n FROM lock_distribution",
    ).first<{ n: number }>()
    expect(count?.n).toBe(0)
    const soon = await runLockDistribution({
      db: env.SCAN_DB,
      reader: fakeReader(),
      nowSeconds: now + 600,
      logger,
    })
    expect(soon.status).toBe("skipped")
    const later = await runLockDistribution({
      db: env.SCAN_DB,
      reader: fakeReader(),
      nowSeconds: now + 1_800,
      logger,
    })
    expect(later.status).toBe("done")
  })

  it("reads each day once, on a block of that day", async () => {
    const midnight = epoch + 4 * 86_400
    // 00:00:20: the head is yesterday's 23:59:58 block. No read yet.
    const early = fakeReader({ headTime: midnight - 2 })
    const first = await runLockDistribution({
      db: env.SCAN_DB,
      reader: early,
      nowSeconds: midnight + 20,
      logger,
    })
    expect(first.status).toBe("skipped")
    expect(early.reads).toBe(0)
    // 00:05: the chain is past midnight; today's read.
    const next = fakeReader({ headTime: midnight + 290 })
    expect(
      (
        await runLockDistribution({
          db: env.SCAN_DB,
          reader: next,
          nowSeconds: midnight + 300,
          logger,
        })
      ).status,
    ).toBe("done")
    // 00:10: read today already.
    expect(
      (
        await runLockDistribution({
          db: env.SCAN_DB,
          reader: next,
          nowSeconds: midnight + 600,
          logger,
        })
      ).status,
    ).toBe("skipped")
    expect(next.reads).toBe(2)
    expect(await lockRows()).toEqual(["vebtc 2026-11-16", "vemezo 2026-11-16"])
  })

  it("never reads while the chain head is over an hour old", async () => {
    // A halt over midnight: every run sees the same old head.
    const halted = fakeReader({ headTime: now - 3 * 3_600 })
    for (const offset of [0, 300, 600, 1_800, 3_600]) {
      const result = await runLockDistribution({
        db: env.SCAN_DB,
        reader: halted,
        nowSeconds: now + offset,
        logger,
      })
      expect(result.status).toBe("skipped")
    }
    expect(halted.reads).toBe(0)
    expect(await lockRows()).toEqual([])
  })

  it("backs off after repeated failures, and resets on a read", async () => {
    const attempts: number[] = []
    for (let minute = 0; minute < 24 * 60; minute += 5) {
      const at = now + minute * 60
      const failing = fakeReader({ fail: true, headTime: at - 5 })
      await runLockDistribution({
        db: env.SCAN_DB,
        reader: failing,
        nowSeconds: at,
        logger,
      })
      if (failing.reads > 0) attempts.push(minute)
    }
    // 30 minutes, then 1, 2 and 4 hours, then every 6: not 48 a day.
    expect(attempts.slice(0, 5)).toEqual([0, 30, 90, 210, 450])
    expect(attempts.length).toBeLessThanOrEqual(8)
    // A read that works clears the count: the next day's first failure
    // waits 30 minutes again.
    const tomorrow = now + 86_400 + 6 * 3_600
    const fixed = fakeReader({ headTime: tomorrow })
    expect(
      (
        await runLockDistribution({
          db: env.SCAN_DB,
          reader: fixed,
          nowSeconds: tomorrow,
          logger,
        })
      ).status,
    ).toBe("done")
    const nextDay = tomorrow + 86_400
    const again = fakeReader({ fail: true, headTime: nextDay })
    for (const offset of [0, 1_800]) {
      await runLockDistribution({
        db: env.SCAN_DB,
        reader: again,
        nowSeconds: nextDay + offset,
        logger,
      })
    }
    expect(again.reads).toBe(2)
  })
})
