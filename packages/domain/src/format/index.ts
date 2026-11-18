/**
 * Display formatting for read-model values. Money and token amounts arrive as
 * exact decimal strings and are formatted with string and bigint arithmetic
 * only, never parseFloat or toFixed. Formats follow `matchbox-v3` Data
 * formats: $86.42, $1,240.00, $89,854 for large values, votes compact
 * (41.26k, 5.88M), dates "Thu 5 Nov", 24h times, durations "3d 12h". Dates
 * render in UTC so server and client agree.
 *
 * Moved from `apps/pro/src/lib/format` with the same function names. The BTC
 * rule (`./btc`) is a copy of `@matchbox/ui/amount`'s formatter, so domain
 * never imports a UI package.
 */

export * from "./address"
export * from "./btc"
export * from "./durations"
export * from "./hex"
export * from "./money"
export * from "./rates"
export * from "./time"
export * from "./units"
export * from "./votes"
