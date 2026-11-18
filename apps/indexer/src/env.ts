import type { IndexerTickHook } from "./hook"

// Bindings of the indexer Worker. Secrets are not in wrangler.jsonc:
// `wrangler secret put DATABASE_URL` (the direct Neon URL for a login
// granted matchbox_indexer) and, optionally, HEARTBEAT_URL (a dead man's
// switch pinged after each fresh tick, src/health.ts).
export type Env = {
  DATABASE_URL: string
  HEARTBEAT_URL?: string
  ENVIRONMENT: string
  // Optional service binding to matchbox-jobs, called after each tick
  // (src/hook.ts). Unset, the tick ends as before.
  JOBS?: IndexerTickHook
}
