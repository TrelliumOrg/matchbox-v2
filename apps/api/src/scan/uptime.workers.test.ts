import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import {
  scanUptimeSchema,
  scanValidatorUptimeSchema,
} from "@matchbox/contracts/scan"
import { createLogger } from "@matchbox/logger"
import { errorHandler, notFoundHandler, requestId } from "@matchbox/server"
import { Hono } from "hono"
import { beforeEach, describe, expect, it } from "vitest"
import type { ApiEnv } from "../context"
import { internalAccess } from "../internal/access"
import { cors } from "../middleware/cors"
import registerScanRoutes from "./routes"

// /internal/scan/uptime and /validators/{address}/uptime over the jobs
// Worker's uptime tables (scan-migrations 0005), seeded as the poller
// writes them.

const base = "https://api.internal/internal/scan"
/** Thu 12 Nov 2026 06:40 UTC. */
const now = Date.UTC(2026, 10, 12, 6, 40) / 1000
const hour = now - (now % 3_600)
const imperator = "0x3c67d8020bf8aa75542f65e8152f74086be71f20"
const arashaus = "0x274642b8a3a06c98459c218c43d3d3bfff779674"
const members = [
  {
    c: "B287F0DA423C6AC2054FE3969B8853F4040D81A0",
    o: imperator,
    n: "Imperator.co",
    p: "1",
  },
  {
    c: "DCBAD12EE8A9B0298705F8DE15726F869B8F2408",
    o: arashaus,
    n: "arashaus",
    p: "1",
  },
  { c: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", o: null, n: null, p: "1" },
]

function app(clock: { now: number }) {
  const logger = createLogger({ sink: () => undefined })
  const hono = new Hono<ApiEnv>()
  hono.use(requestId({ logger }))
  hono.use(internalAccess({ internalToken: null }))
  hono.use(cors())
  hono.onError(errorHandler())
  hono.notFound(notFoundHandler)
  registerScanRoutes(hono, {
    scanDb: env.SCAN_DB,
    readDb: env.READ_DB,
    network: "mezo",
    cache: null,
    rateLimits: null,
    readPrices: async () => null,
    proxy: null,
    clock: async () => ({ height: 13171530, lastActive: 13171530 }),
    logger,
    now: () => clock.now * 1000,
  })
  return hono
}

async function seed(): Promise<void> {
  const db = env.SCAN_DB
  await db.batch([
    db.prepare("DELETE FROM uptime_blocks"),
    db.prepare("DELETE FROM uptime_hourly"),
    db.prepare("DELETE FROM uptime_daily"),
    db.prepare("DELETE FROM uptime_sets"),
    db.prepare("DELETE FROM uptime_status"),
    db
      .prepare(
        `INSERT INTO uptime_sets (id, hash, first_height, members, created_at)
         VALUES (1, 'H1', 13171500, ?1, ?2)`,
      )
      .bind(JSON.stringify(members), now),
    db
      .prepare(
        `INSERT INTO uptime_status (id, height, block_time, set_id,
           started_time, finalized_day, read_at, source, node_height,
           evm_height, health)
         VALUES (1, 13171503, ?1, 1, ?2, NULL, ?3, 'pathrock', 13171504,
           13171505, 'ok')`,
      )
      .bind(now - 20, hour - 2 * 3_600, now - 30),
    // Imperator never signs (bit 0); 13,171,503 was its round-0 turn.
    ...[
      [13171501, 0, 1, "", "6", 2],
      [13171502, 0, 1, "", "6", 2],
      [13171503, 1, 1, "0", "6", 2],
    ].map(([height, round, proposer, missed, signed, signers]) =>
      db
        .prepare(
          `INSERT INTO uptime_blocks (height, time, round, set_id, proposer,
             missed, signed, signers) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7)`,
        )
        .bind(height, now - 30, round, proposer, missed, signed, signers),
    ),
    ...[
      [imperator, 0, 3, 0, 1],
      [arashaus, 3, 0, 3, 0],
      ["cons:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 3, 0, 0, 0],
      ["", 6, 3, 3, 1],
    ].map(([validator, signed, missed, proposed, proposalsMissed]) =>
      db
        .prepare(
          `INSERT INTO uptime_hourly (validator, hour, blocks, signed, missed,
             proposed, proposals_missed, expected_micro, unattributed,
             first_height, last_height)
           VALUES (?1, ?2, 3, ?3, ?4, ?5, ?6, 1000000, 0, 13171501, 13171503)`,
        )
        .bind(validator, hour, signed, missed, proposed, proposalsMissed),
    ),
  ])
}

beforeEach(async () => {
  await applyD1Migrations(env.READ_DB, env.TEST_MIGRATIONS)
  await applyD1Migrations(env.SCAN_DB, env.SCAN_MIGRATIONS)
  await seed()
})

async function get<T>(
  hono: Hono<ApiEnv>,
  path: string,
  schema: { parse(value: unknown): T },
): Promise<T> {
  const response = await hono.request(`${base}${path}`)
  expect(response.status).toBe(200)
  return schema.parse(await response.json())
}

describe("/uptime", () => {
  it("gives every validator's windows and the newest block's signers", async () => {
    const body = await get(app({ now }), "/uptime", scanUptimeSchema)
    expect(body.data.status).toMatchObject({
      state: "live",
      source: "pathrock",
      height: 13171503,
      behind_blocks: 2,
    })
    expect(body.data.latest).toEqual({
      height: 13171503,
      time: now - 30,
      round: 1,
      signing: 2,
      of: 3,
    })
    const byAddress = new Map(
      body.data.validators.map((row) => [row.address ?? row.consensus, row]),
    )
    expect(byAddress.get(imperator)).toMatchObject({
      consensus: "B287F0DA423C6AC2054FE3969B8853F4040D81A0",
      moniker: "Imperator.co",
      in_set: true,
      windows: {
        d1: { blocks: 3, signed: 0, missed: 3, uptime_bps: 0, complete: false },
      },
    })
    expect(byAddress.get(arashaus)?.windows.d1.uptime_bps).toBe(10_000)
    // A member the PoA module did not name is listed by consensus address.
    expect(
      byAddress.get("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
    ).toMatchObject({
      address: null,
      in_set: true,
    })
    expect(body.data.validators).toHaveLength(3)
  })

  it("says down, not live, when no run read a node lately", async () => {
    const body = await get(app({ now: now + 600 }), "/uptime", scanUptimeSchema)
    expect(body.data.status.state).toBe("down")
  })

  it("answers not started before the migration's tables have data", async () => {
    await env.SCAN_DB.prepare("DELETE FROM uptime_status").run()
    const body = await get(app({ now }), "/uptime", scanUptimeSchema)
    expect(body.data).toEqual({
      status: {
        state: "not_started",
        source: null,
        height: null,
        block_time: null,
        read_at: null,
        behind_blocks: null,
      },
      latest: null,
      validators: [],
    })
  })
})

describe("/validators/{address}/uptime", () => {
  it("gives the windows, the strip and when it last signed", async () => {
    const body = await get(
      app({ now }),
      `/validators/${imperator.toUpperCase().replace("0X", "0x")}/uptime`,
      scanValidatorUptimeSchema,
    )
    expect(body.data).toMatchObject({
      address: imperator,
      moniker: "Imperator.co",
      in_set: true,
      last_signed: null,
      windows: { d1: { missed: 3, proposals_missed: 1 } },
    })
    expect(body.data.strip.map((block) => block.height)).toEqual([
      13171503, 13171502, 13171501,
    ])
    expect(body.data.strip[0]).toMatchObject({
      state: "missed",
      missed_proposal: true,
    })
    const arashausBody = await get(
      app({ now }),
      `/validators/${arashaus}/uptime`,
      scanValidatorUptimeSchema,
    )
    expect(
      arashausBody.data.strip.every((block) => block.state === "signed"),
    ).toBe(true)
    expect(arashausBody.data.last_signed).toEqual({
      at: hour,
      precision: "hour",
    })
  })

  it("answers an unknown validator with no windows", async () => {
    const body = await get(
      app({ now }),
      `/validators/0x${"12".repeat(20)}/uptime`,
      scanValidatorUptimeSchema,
    )
    expect(body.data).toMatchObject({ in_set: false, windows: null })
    expect(body.data.strip.every((block) => block.state === "out")).toBe(true)
  })
})
