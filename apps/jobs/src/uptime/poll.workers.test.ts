import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { createLogger } from "@matchbox/logger"
import { beforeEach, describe, expect, it } from "vitest"
import { cometNode } from "./comet"
import { countRows } from "./counts"
import { finalizeDays, hourlyStatements, runUptimePoll } from "./poll"
import { fixtureReader, imperator } from "./testing"

// The poller against Miniflare D1 with scan-migrations 0005, replaying real
// commits (heights 13,171,500 to 13,171,525, all on 12 Nov 2026 06:2x UTC).

const logger = createLogger({ level: "error" })
const primary = cometNode(
  "https://comet.mezo-archive.pathrocknetwork.org",
  "https://rest.mezo-archive.pathrocknetwork.org",
)
const fallback = cometNode(
  "https://rpc.lavenderfive.com/mezo",
  "https://rest.lavenderfive.com/mezo",
)
const now = Date.UTC(2026, 10, 12, 6, 40) / 1000

beforeEach(async () => {
  await applyD1Migrations(env.SCAN_DB, env.SCAN_MIGRATIONS)
  await env.SCAN_DB.batch([
    env.SCAN_DB.prepare("DELETE FROM uptime_blocks"),
    env.SCAN_DB.prepare("DELETE FROM uptime_hourly"),
    env.SCAN_DB.prepare("DELETE FROM uptime_daily"),
    env.SCAN_DB.prepare("DELETE FROM uptime_sets"),
    env.SCAN_DB.prepare("DELETE FROM uptime_status"),
    // As if a run had counted through 13,171,499 and lost its priorities.
    env.SCAN_DB.prepare(
      "INSERT INTO uptime_status (id, height, health) VALUES (1, 13171499, 'ok')",
    ),
  ])
})

function poll(
  reader: ReturnType<typeof fixtureReader>["reader"],
  maxHeights = 10,
) {
  return runUptimePoll({
    db: env.SCAN_DB,
    reader,
    primary,
    fallback,
    evmHeight: async () => 13171527,
    nowSeconds: now,
    maxHeights,
    readBudgetMs: 60_000,
    logger,
  })
}

async function hourly(validator: string) {
  return env.SCAN_DB.prepare(
    `SELECT blocks, signed, missed, proposed, proposals_missed, first_height,
       last_height FROM uptime_hourly WHERE validator = ?1`,
  )
    .bind(validator)
    .first()
}

async function status() {
  return env.SCAN_DB.prepare(
    `SELECT height, set_id, priorities IS NOT NULL AS has_priorities,
       started_height, source, health, lease_until, last_error
     FROM uptime_status WHERE id = 1`,
  ).first()
}

describe("runUptimePoll", () => {
  it("reads the next heights, then carries the proposer order between runs", async () => {
    const { reader, calls } = fixtureReader({ tip: 13171526 })
    expect(await poll(reader)).toMatchObject({
      status: "ok",
      source: "pathrock",
      from: 13171500,
      to: 13171509,
      heights: 10,
      health: "ok",
      error: null,
    })
    // The set and its names were read once, at the first height.
    expect(calls.validators).toEqual([13171500])
    expect(calls.poa).toBe(1)
    expect(await status()).toMatchObject({
      height: 13171509,
      has_priorities: 1,
      started_height: 13171500,
      source: "pathrock",
      health: "ok",
      lease_until: 0,
    })
    expect(await poll(reader, 100)).toMatchObject({
      from: 13171510,
      to: 13171525,
    })
    // Stepping held: no re-read of the set on the second run.
    expect(calls.validators).toEqual([13171500])
    expect(await hourly(imperator)).toEqual({
      blocks: 26,
      signed: 0,
      missed: 26,
      proposed: 0,
      proposals_missed: 2,
      first_height: 13171500,
      last_height: 13171525,
    })
    expect(await hourly("")).toMatchObject({ blocks: 26, proposed: 26 })
    const late = await env.SCAN_DB.prepare(
      "SELECT height, round, missed FROM uptime_blocks WHERE round > 0 ORDER BY height",
    ).all()
    expect(late.results).toHaveLength(2)
    const sets = await env.SCAN_DB.prepare(
      "SELECT members FROM uptime_sets",
    ).all()
    expect(sets.results).toHaveLength(1)
    expect(String(sets.results[0]?.members)).toContain('"n":"Imperator.co"')
  })

  it("never counts a height twice", async () => {
    const { reader } = fixtureReader({ tip: 13171526 })
    await poll(reader)
    const before = await hourly(imperator)
    // A late batch of a run that started from 13,171,499 changes nothing.
    const replay = hourlyStatements(
      countRows(
        new Map([
          [
            imperator,
            new Map([
              [
                "1794464400",
                {
                  blocks: 10,
                  signed: 0,
                  missed: 10,
                  proposed: 0,
                  proposals_missed: 1,
                  expected_micro: 0,
                  unattributed: 0,
                  first_height: 13171500,
                  last_height: 13171509,
                },
              ],
            ]),
          ],
        ]),
      ),
      13171499,
    )
    await env.SCAN_DB.batch(
      replay.map((each) => env.SCAN_DB.prepare(each.sql).bind(...each.params)),
    )
    expect(await hourly(imperator)).toEqual(before)
  })

  it("skips while another run holds the lease", async () => {
    await env.SCAN_DB.prepare(
      "UPDATE uptime_status SET lease_until = ?1 WHERE id = 1",
    )
      .bind(now + 30)
      .run()
    const { reader, calls } = fixtureReader({ tip: 13171526 })
    expect(await poll(reader)).toMatchObject({ status: "skipped" })
    expect(calls.status).toBe(0)
  })

  it("falls back to the other node when the first fails mid-run", async () => {
    const { reader, calls } = fixtureReader({
      tip: 13171526,
      failCommits: (node) => node.label === "pathrock",
    })
    // An unhealthy primary (behind the EVM head) brings in the fallback.
    const result = await runUptimePoll({
      db: env.SCAN_DB,
      reader: {
        ...reader,
        status: async (node) => ({
          ...(await reader.status(node)),
          catchingUp: node.label === "pathrock",
        }),
      },
      primary,
      fallback,
      evmHeight: async () => 13171527,
      nowSeconds: now,
      maxHeights: 10,
      readBudgetMs: 60_000,
      logger,
    })
    expect(result).toMatchObject({
      status: "ok",
      source: "lavender",
      to: 13171509,
    })
    expect(calls.commits.length).toBe(1)
  })

  it("records the node as down when none answers, and keeps the counts", async () => {
    const { reader } = fixtureReader({ tip: 13171526 })
    await poll(reader)
    const down = {
      ...reader,
      status: async () => Promise.reject(new Error("x")),
    }
    expect(await poll(down)).toMatchObject({ status: "down" })
    expect(await status()).toMatchObject({ height: 13171509, health: "down" })
    expect(await hourly(imperator)).toMatchObject({ blocks: 10 })
  })

  it("marks the data behind when the node trails the EVM head", async () => {
    const { reader } = fixtureReader({ tip: 13171526 })
    const result = await runUptimePoll({
      db: env.SCAN_DB,
      reader,
      primary,
      fallback: null,
      evmHeight: async () => 13171527 + 500,
      nowSeconds: now,
      maxHeights: 10,
      readBudgetMs: 60_000,
      logger,
    })
    expect(result).toMatchObject({ status: "ok", health: "behind" })
  })
})

describe("finalizeDays", () => {
  it("rolls finished days into uptime_daily, the first one incomplete", async () => {
    const day1 = Date.UTC(2026, 10, 10, 0, 0) / 1000
    const day2 = day1 + 86_400
    await env.SCAN_DB.batch([
      env.SCAN_DB.prepare(
        `UPDATE uptime_status SET block_time = ?1, started_time = ?2,
           finalized_day = NULL WHERE id = 1`,
      ).bind(day2 + 86_400 + 60, day1 + 3_600),
      ...[day1 + 3_600, day1 + 7_200, day2, day2 + 82_800].map((hour) =>
        env.SCAN_DB.prepare(
          `INSERT INTO uptime_hourly (validator, hour, blocks, signed, missed,
             proposed, proposals_missed, expected_micro, unattributed,
             first_height, last_height)
           VALUES (?1, ?2, 100, 90, 10, 5, 1, 4761900, 0, ?2, ?2)`,
        ).bind(imperator, hour),
      ),
    ])
    expect(await finalizeDays(env.SCAN_DB, now, logger)).toEqual([
      "2026-11-10",
      "2026-11-11",
    ])
    const rows = await env.SCAN_DB.prepare(
      `SELECT day, blocks, signed, missed, complete, source FROM uptime_daily
       WHERE validator = ?1 ORDER BY day`,
    )
      .bind(imperator)
      .all()
    expect(rows.results).toEqual([
      {
        day: "2026-11-10",
        blocks: 200,
        signed: 180,
        missed: 20,
        complete: 0,
        source: "live",
      },
      {
        day: "2026-11-11",
        blocks: 200,
        signed: 180,
        missed: 20,
        complete: 1,
        source: "live",
      },
    ])
    // Nothing more until the next day ends.
    expect(await finalizeDays(env.SCAN_DB, now, logger)).toEqual([])
  })
})
