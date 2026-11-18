import path from "node:path"
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

// Tests that need the Workers runtime: D1 and KV through Miniflare. Chain
// reads are faked and the warehouse replays a recorded SQL fixture, so no
// test touches a network.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "migrations"),
  )
  const scanMigrations = await readD1Migrations(
    path.join(import.meta.dirname, "scan-migrations"),
  )
  return {
    plugins: [
      cloudflareTest({
        main: "./test/workers-entry.ts",
        miniflare: {
          compatibilityDate: "2026-09-01",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["READ_DB", "SCAN_DB"],
          kvNamespaces: ["PRICES"],
          bindings: {
            TEST_MIGRATIONS: migrations,
            SCAN_MIGRATIONS: scanMigrations,
          },
          outboundService: () =>
            new Response("No network in tests", { status: 599 }),
        },
      }),
    ],
    test: { include: ["src/**/*.workers.test.ts"] },
  }
})
