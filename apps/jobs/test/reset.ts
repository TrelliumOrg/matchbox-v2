import { env } from "cloudflare:workers"

const tables = [
  "read_models",
  "price_samples",
  "morpho_markets",
  "morpho_positions",
  "morpho_accounts",
  "morpho_known_markets",
  "troves",
  "stability_pool",
  "job_cursors",
  "snapshot_runs",
  "watch_items",
  "wallet_requests",
]

/** Empties READ_DB and PRICES; Miniflare storage persists across tests. */
export async function resetStorage(): Promise<void> {
  await env.READ_DB.batch(
    tables.map((table) => env.READ_DB.prepare(`DELETE FROM ${table}`)),
  )
  const keys = await env.PRICES.list()
  await Promise.all(keys.keys.map((key) => env.PRICES.delete(key.name)))
}
