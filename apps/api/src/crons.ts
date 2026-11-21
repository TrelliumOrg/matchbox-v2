// `triggers.crons` in wrangler.jsonc; each schedule runs one task.
//
// Kept out of src/index.ts: the Workers runtime treats every export of the
// entry module as a handler or class, and refuses to start on a string.

/** Health probes and gauge votes. */
export const healthProbeCron = "* * * * *"
/** Chain-state reconciliation. */
export const reconcileCron = "*/10 * * * *"
/** Market snapshot. */
export const marketCron = "*/5 * * * *"
