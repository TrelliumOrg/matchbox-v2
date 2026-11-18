import path from "node:path"
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

// Tests that need the Workers runtime: the routes against a real D1 and R2
// (Miniflare). Turnstile and Discord are fakes passed to the app, and no
// request leaves the test.

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "migrations"),
  )
  return {
    plugins: [
      cloudflareTest({
        main: "./test/workers-entry.ts",
        miniflare: {
          compatibilityDate: "2026-09-01",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["FEEDBACK_DB"],
          r2Buckets: ["SCREENSHOTS"],
          bindings: { TEST_MIGRATIONS: migrations },
          outboundService: () =>
            new Response("unexpected outbound fetch", { status: 599 }),
        },
      }),
    ],
    test: {
      include: ["src/**/*.workers.test.ts"],
      testTimeout: 20_000,
    },
  }
})
