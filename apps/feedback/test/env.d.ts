import type { D1Migration } from "@cloudflare/vitest-plugin"

declare global {
  namespace Cloudflare {
    interface Env {
      FEEDBACK_DB: D1Database
      SCREENSHOTS: R2Bucket
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}
