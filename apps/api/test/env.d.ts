import type { D1Migration } from "@cloudflare/vitest-plugin"
import type { RateLimiterNamespace } from "@matchbox/server"
import type { BlockHub } from "../src/heads/block-hub"

declare global {
  namespace Cloudflare {
    interface Env {
      READ_DB: D1Database
      PRICES: KVNamespace
      BLOCK_HUB: DurableObjectNamespace<BlockHub>
      RATE_LIMITER: RateLimiterNamespace
      TEST_MIGRATIONS: D1Migration[]
      SCAN_DB: D1Database
      SCAN_MIGRATIONS: D1Migration[]
      MARKET_DB: D1Database
      MARKET_MIGRATIONS: D1Migration[]
      HEADS_RPC_URLS: string
      HEADS_POLL_MS: string
      HEADS_STALE_MS: string
    }
  }
}
