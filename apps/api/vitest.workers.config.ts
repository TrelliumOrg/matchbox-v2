import path from "node:path"
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

// Tests that need the Workers runtime: D1, KV, the Cache API and the
// BlockHub and RateLimiter Durable Objects. Outbound fetches go to a fake Mezo RPC.

/** The fake chain head; tests advance it through `/__fake-rpc/advance`. */
const fakeChain = {
  block: 13_078_795,
  timestamp: 1_794_138_780,
  down: false,
  /** Milliseconds the fake RPC takes to answer a head read. */
  delayMs: 0,
  /** Transactions in each block the fake RPC serves. */
  transactions: 1,
  /** RPC requests answered (control paths excluded). */
  calls: 0,
}

async function fakeRpc(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === "/__fake-rpc/advance") {
    fakeChain.block += 1
    fakeChain.timestamp += 4
    return Response.json(fakeChain)
  }
  if (url.pathname === "/__fake-rpc/skip") {
    fakeChain.block += 2
    fakeChain.timestamp += 8
    return Response.json(fakeChain)
  }
  if (url.pathname === "/__fake-rpc/transactions") {
    fakeChain.transactions = Number(url.searchParams.get("value") ?? "1")
    return Response.json(fakeChain)
  }
  if (url.pathname === "/__fake-rpc/state") return Response.json(fakeChain)
  if (url.pathname === "/__fake-rpc/delay") {
    fakeChain.delayMs = Number(url.searchParams.get("value") ?? "0")
    return Response.json(fakeChain)
  }
  if (url.pathname === "/__fake-rpc/down") {
    fakeChain.down = url.searchParams.get("value") === "true"
    return Response.json(fakeChain)
  }
  if (url.hostname !== "rpc.fake") {
    return new Response("unexpected outbound fetch", { status: 599 })
  }
  fakeChain.calls += 1
  if (fakeChain.delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, fakeChain.delayMs))
  }
  if (fakeChain.down) return new Response("down", { status: 502 })
  return Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: {
      number: `0x${fakeChain.block.toString(16)}`,
      timestamp: `0x${fakeChain.timestamp.toString(16)}`,
      hash: `0x${fakeChain.block.toString(16).padStart(64, "0")}`,
      gasUsed: "0x2e083",
      miner: "0xD7fb1De0a4C2ffE5474E003656302A3f3A388A8a",
      transactions: Array.from(
        { length: fakeChain.transactions },
        () => `0x${"ab".repeat(32)}`,
      ),
    },
  })
}

export default defineConfig(async () => {
  // READ_DB holds the jobs tables and the API's own (read-db-migrations).
  const migrations = [
    ...(await readD1Migrations(
      path.join(import.meta.dirname, "../jobs/migrations"),
    )),
    ...(await readD1Migrations(
      path.join(import.meta.dirname, "read-db-migrations"),
    )),
  ]
  // SCAN_DB: Matchscan's explorer rows (apps/jobs/scan-migrations).
  const scanMigrations = await readD1Migrations(
    path.join(import.meta.dirname, "../jobs/scan-migrations"),
  )
  // MARKET_DB: the market cron's store (migrations/).
  const marketMigrations = await readD1Migrations(
    path.join(import.meta.dirname, "migrations"),
  )
  return {
    plugins: [
      cloudflareTest({
        main: "./test/workers-entry.ts",
        miniflare: {
          compatibilityDate: "2026-09-01",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["READ_DB", "SCAN_DB", "MARKET_DB"],
          kvNamespaces: ["PRICES"],
          durableObjects: {
            BLOCK_HUB: "BlockHub",
            RATE_LIMITER: "RateLimiter",
          },
          bindings: {
            TEST_MIGRATIONS: migrations,
            SCAN_MIGRATIONS: scanMigrations,
            MARKET_MIGRATIONS: marketMigrations,
            HEADS_RPC_URLS: "https://rpc.fake/",
            HEADS_POLL_MS: "250",
            HEADS_STALE_MS: "300",
          },
          outboundService: fakeRpc,
        },
      }),
    ],
    test: {
      include: ["src/**/*.workers.test.ts"],
      // These tests page through lists a request at a time inside the
      // Workers runtime; on a loaded full run (every package at once) a
      // few take over vitest's 5 s default though they pass alone.
      testTimeout: 20_000,
    },
  }
})
