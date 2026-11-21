import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { getPlatformProxy } from "wrangler"
import {
  assertLocalEnvironment,
  assertNoArguments,
  childEnvironment,
  credentialVariables,
  localStateDir,
  migrateArgs,
} from "../src/local-seed/guard"
import { type SeedBindings, seedLocalWorld } from "../src/local-seed/world"

// `pnpm db:seed:local`: migrates the API's local D1 databases and fills
// them, and the local PRICES KV, with the fixture world
// (src/local-seed/world.ts). Local state only: every wrangler command runs
// with --local and no Cloudflare credentials, the bindings come from a
// Miniflare proxy with remote bindings off, and the script takes no
// arguments, so nothing can point it at a deployed database (the checks
// are in src/local-seed/guard.ts and its test). Safe to run again: it
// resets to the same state.
//
// State lives where `wrangler dev` in apps/api keeps it
// (apps/api/.wrangler/state). The jobs Worker's dev scripts persist there
// too, so a local jobs run feeds the same databases.

const apiDir = path.resolve(import.meta.dirname, "..")
const configPath = path.join(apiDir, "wrangler.jsonc")
const stateDir = localStateDir(apiDir)

function refuse(message: string): never {
  process.stderr.write(`db:seed:local: ${message}\n`)
  process.exit(1)
}

// Checks before anything runs (src/local-seed/guard.ts): no arguments, no
// wrangler environment selected, nothing named production. Credentials
// are dropped from this process too, so the proxy below has none either.
let childEnv: Record<string, string | undefined>
try {
  assertNoArguments(process.argv.slice(2))
  assertLocalEnvironment(process.env)
  childEnv = childEnvironment(process.env)
  for (const name of credentialVariables) delete process.env[name]
} catch (error) {
  refuse(error instanceof Error ? error.message : String(error))
}

// The package exports only its API, so find the CLI next to package.json.
const wranglerBin = path.join(
  path.dirname(createRequire(import.meta.url).resolve("wrangler/package.json")),
  "bin",
  "wrangler.js",
)

/** Applies one binding's migrations to local state; refuses anything else. */
function migrateLocal(binding: string, environment?: string): void {
  let args: string[]
  try {
    args = migrateArgs({ binding, environment, apiDir, persistTo: stateDir })
  } catch (error) {
    refuse(error instanceof Error ? error.message : String(error))
  }
  const result = spawnSync(process.execPath, [wranglerBin, ...args], {
    cwd: apiDir,
    stdio: "inherit",
    env: childEnv,
  })
  if (result.status !== 0) {
    refuse(`wrangler ${args.join(" ")} failed (exit ${result.status})`)
  }
}

// Every migration directory the API's config names, so a new migration
// (such as the wallet history tables) is applied without a change here.
// READ_DB carries two histories: the jobs tables (../jobs/migrations, the
// default env's migrations_dir) and the API's own (read-db-migrations, the
// v2preview env's). Same database id, so the same local database.
migrateLocal("READ_DB")
migrateLocal("READ_DB", "v2preview")
migrateLocal("SCAN_DB")
migrateLocal("MARKET_DB")

const proxy = await getPlatformProxy<SeedBindings>({
  configPath,
  persist: { path: path.join(stateDir, "v3") },
  remoteBindings: false,
})
try {
  const summary = await seedLocalWorld(proxy.env)
  process.stdout.write(
    [
      "",
      `Seeded ${stateDir}:`,
      `  READ_DB   ${summary.readModels} read models, ${summary.watchItems} watch list items, ${summary.historyRows} stored history rows, trove, Morpho and Stability Pool rows`,
      `  SCAN_DB   ${summary.scanActivityRows} activity rows and the scan test fixtures`,
      "  PRICES    demo BTC and MEZO prices",
      "",
      "Next: pnpm --filter @matchbox/api dev:memory (port 8787)",
      "",
    ].join("\n"),
  )
} finally {
  await proxy.dispose()
}
