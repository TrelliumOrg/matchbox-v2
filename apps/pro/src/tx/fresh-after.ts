/**
 * The blocks this tab's own transactions were mined in, kept for a few
 * minutes. While one is kept, the reads it changed ask the API for an
 * answer that includes it (`?after=<block>`), which skips the answers the
 * API cached before the transaction. Without it the refetch that follows a
 * transaction got the answer from before it: a new lock was missing from
 * Overview for as long as the cache held.
 *
 * In memory only: a reload reads through the server, whose caches are at
 * most a minute old.
 */

/** How long a transaction's block is asked for. */
export const freshAfterMs = 5 * 60_000

type Mark = { block: number; until: number }

/** Wallet reads: overview, voter, rewards. By lower-case address. */
const wallets = new Map<string, Mark>()
/** Shared reads: the gauge directory and gauge profiles. */
let shared: Mark | null = null

function live(mark: Mark | null | undefined, now: number): number | undefined {
  return mark !== null && mark !== undefined && mark.until > now
    ? mark.block
    : undefined
}

function later(current: number | undefined, block: number, now: number): Mark {
  return { block: Math.max(current ?? 0, block), until: now + freshAfterMs }
}

/** A transaction from `address` was mined in `block`. */
export function noteWrite(
  write: { address: string; block: bigint | number; gauges: boolean },
  now: number = Date.now(),
): void {
  const block = Number(write.block)
  if (!Number.isSafeInteger(block) || block <= 0) return
  const address = write.address.toLowerCase()
  wallets.set(address, later(live(wallets.get(address), now), block, now))
  if (write.gauges) shared = later(live(shared, now), block, now)
  for (const [key, mark] of wallets) {
    if (mark.until <= now) wallets.delete(key)
  }
}

/** The block a wallet's reads should include, if it just transacted. */
export function walletAfter(
  address: string,
  now: number = Date.now(),
): number | undefined {
  return live(wallets.get(address.toLowerCase()), now)
}

/** The block the gauge reads should include, if a vote was just signed. */
export function gaugesAfter(now: number = Date.now()): number | undefined {
  return live(shared, now)
}

/** For tests. */
export function forgetWrites(): void {
  wallets.clear()
  shared = null
}
