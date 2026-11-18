import type { D1Migration } from "@cloudflare/vitest-plugin"

declare global {
  namespace Cloudflare {
    interface Env {
      READ_DB: D1Database
      PRICES: KVNamespace
      TEST_MIGRATIONS: D1Migration[]
      SCAN_DB: D1Database
      SCAN_MIGRATIONS: D1Migration[]
    }
  }
}
