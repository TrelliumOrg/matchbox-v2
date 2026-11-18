import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createLogger } from "@matchbox/logger"
import { getPlatformProxy } from "wrangler"
import { z } from "zod"
import { createWarehouseReader, neonQueryRunner } from "../src/warehouse/reader"
import type { Recording } from "../src/warehouse/recorded"
import { recordingQueryRunner } from "../src/warehouse/recorded"
import { runWarehouseSnapshot } from "../src/warehouse/snapshot"
import {
  emptyChainReader,
  fixtureSweepWallets,
} from "../test/warehouse-fixture"

// Records test/fixtures/warehouse.json: runs the real warehouse snapshot
// against the Neon DEV branch in .dev.vars (WAREHOUSE_DATABASE_URL), with a
// throwaway local D1 and no chain reads, and saves every query with its rows.
// Every query is READ ONLY. Never point this at production.

const root = path.resolve(import.meta.dirname, "..")
const devVars = readFileSync(path.join(root, ".dev.vars"), "utf8")
const url = /^WAREHOUSE_DATABASE_URL=(.+)$/m.exec(devVars)?.[1]?.trim()
if (url === undefined)
  throw new Error("WAREHOUSE_DATABASE_URL missing in .dev.vars")
const branch = /^# Neon DEV branch \(([^)]+)\)/m.exec(devVars)?.[1] ?? "dev"

const envSchema = z.object({
  READ_DB: z.custom<D1Database>((value) => value !== undefined),
  PRICES: z.custom<KVNamespace>((value) => value !== undefined),
})

const proxy = await getPlatformProxy({
  configPath: path.join(root, "wrangler.jsonc"),
  persist: false,
})
try {
  const env = envSchema.parse(proxy.env)
  const migrations = readdirSync(path.join(root, "migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort()
  for (const file of migrations) {
    const migration = readFileSync(path.join(root, "migrations", file), "utf8")
    // Comments go first: some contain semicolons.
    const withoutComments = migration
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
    for (const statement of withoutComments.split(";")) {
      const sql = statement.trim()
      if (sql.length > 0) await env.READ_DB.prepare(sql).run()
    }
  }
  const recorder = recordingQueryRunner(neonQueryRunner(url))
  const reader = createWarehouseReader(recorder.run)
  const head = await reader.head()
  if (head === null) throw new Error("The warehouse branch is empty")
  // Ten minutes after the newest projected event, so its epoch is "current".
  const nowSeconds = head.timestamp + 600
  const result = await runWarehouseSnapshot({
    db: env.READ_DB,
    kv: env.PRICES,
    warehouse: reader,
    chain: emptyChainReader,
    trigger: "chained",
    sweepWallets: fixtureSweepWallets,
    nowSeconds,
    logger: createLogger(),
  })
  const recording: Recording = {
    recordedAt: Math.floor(Date.now() / 1000),
    nowSeconds,
    branch,
    entries: recorder.entries,
  }
  writeFileSync(
    path.join(root, "test/fixtures/warehouse.json"),
    `${JSON.stringify(recording)}\n`,
  )
  createLogger().info({
    message: "Recorded warehouse fixture",
    result,
    queries: recording.entries.length,
  })
} finally {
  await proxy.dispose()
}
