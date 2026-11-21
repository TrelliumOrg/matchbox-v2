// `triggers.crons` in wrangler.jsonc; each schedule runs one task.
//
// Kept out of src/index.ts: the Workers runtime treats every export of the
// entry module as a handler or class, and refuses to start on a string.

/** Prices, cross-chain quotes and validator uptime. */
export const priceCron = "* * * * *"
/** Live RPC snapshot, then the hourly cross-chain reads. */
export const liveCron = "*/5 * * * *"
/** Warehouse fallback (skipped after a chained run). */
export const warehouseCron = "3,18,33,48 * * * *"
