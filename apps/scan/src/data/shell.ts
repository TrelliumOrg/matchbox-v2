import type { ChainHead, Prices } from "@matchbox/contracts/read-models"
import {
  EPOCH_SECONDS,
  epochIndexFor,
  epochStartOf,
} from "@matchbox/domain/epoch"
import {
  formatChange,
  formatPrice,
  parseDecimal,
  roundDecimal,
} from "@matchbox/domain/format"
import type { LiveConfig } from "@matchbox/live/config"
import { blockTimeMs } from "@matchbox/live/heads"
import type * as PriceSlot from "@matchbox/ui/price-slot"

/**
 * What every Scan page's shell needs from the server: the chain head (block
 * ticker, epoch countdown), prices for the price slot, and how the browser
 * follows new blocks. Prices are formatted here, so the client ships no
 * formatter for them.
 */

export type ShellSeed = {
  /** Null when the head could not be read: the live head fills in. */
  head: { number: number; timestamp: number } | null
  prices: { btc: PriceSlot.Price | null; mezo: PriceSlot.Price | null }
  /** The epoch at the head, or at `renderedAt` without one. */
  epoch: { number: number; endsAt: number }
  /** Unix seconds the server built this, the clock when there is no head. */
  renderedAt: number
  /** A read failed: the page renders, but must not be cached. */
  degraded: boolean
  live: LiveConfig
  /** The RPC the wallet reads through. */
  rpc: string
  /**
   * Scan's copy step has halted tables (`/status` `halted`): some lists
   * and figures lag the chain. False when unknown.
   */
  delayed: boolean
  /**
   * The live Borrow snapshot is behind the head by more than two runs
   * (`/status` `liveSnapshot.stale`). False when unknown.
   */
  borrowDelayed: boolean
}

/**
 * Whether a page says its Borrow data is delayed under the top bar. Only
 * address pages do (Borrow pages say so from each live answer). The
 * address document's borrow part says how old its own snapshot is
 * (`pageDelayed`); without one (null: an older API, or no borrow part)
 * the page falls back to `/status` (`statusDelayed`).
 */
export function borrowDelayNote(
  path: string,
  statusDelayed: boolean,
  pageDelayed: boolean | null | undefined,
): boolean {
  if (!path.startsWith("/address/")) return false
  return pageDelayed ?? statusDelayed
}

/**
 * "1.8" percent to 180 basis points, rounding half up away from zero. The
 * decimal is rounded with bigint arithmetic (financial-precision.md); only
 * the result, a whole count of basis points, becomes a number.
 */
export function percentToBps(decimal: string): number {
  const parsed = parseDecimal(decimal)
  const { int, fraction } = roundDecimal(parsed, 2)
  const bps = int * 100n + BigInt(fraction)
  return Number(parsed.negative ? -bps : bps)
}

function slotPrice(price: Prices["btc"]): PriceSlot.Price | null {
  if (price === null) return null
  const bps = price.change24h === null ? null : percentToBps(price.change24h)
  return {
    price: formatPrice(price.usd),
    change: bps === null ? null : formatChange(bps),
    trend: (bps ?? 0) < 0 ? "down" : "up",
  }
}

/** The epoch containing `timestamp`, numbered from Epoch 0. */
export function epochAt(timestamp: number): { number: number; endsAt: number } {
  const start = epochStartOf(timestamp)
  return { number: epochIndexFor(start), endsAt: start + EPOCH_SECONDS }
}

/**
 * Chain time in unix seconds at `liveHead`: the shell's head timestamp,
 * moved on by blocks since (3.8s each); the server's clock when the head
 * could not be read.
 */
export function chainSeconds(
  shell: Pick<ShellSeed, "head" | "renderedAt">,
  liveHead: number,
): number {
  if (shell.head === null) return shell.renderedAt
  const blocks = Math.max(0, liveHead - shell.head.number)
  return shell.head.timestamp + Math.round((blocks * blockTimeMs) / 1000)
}

/** `head` or `prices` is null when its read failed. */
export function toShell(
  head: ChainHead | null,
  prices: Prices | null,
  live: LiveConfig,
  rpc: string,
  renderedAt: number,
): ShellSeed {
  return {
    head:
      head === null ? null : { number: head.block, timestamp: head.timestamp },
    prices: {
      btc: slotPrice(prices?.btc ?? null),
      mezo: slotPrice(prices?.mezo ?? null),
    },
    epoch: epochAt(head?.timestamp ?? renderedAt),
    renderedAt,
    degraded: head === null || prices === null,
    live,
    rpc,
    delayed: false,
    borrowDelayed: false,
  }
}

export type ShellReads = {
  head: () => Promise<ChainHead>
  prices: () => Promise<Prices>
}

/**
 * Reads the head and prices independently: either may fail (a rate limit,
 * no token in local api mode) and the shell still renders, degraded. Never
 * rejects.
 */
export async function readShell(
  reads: ShellReads,
  options: { live: LiveConfig; rpc: string; nowSeconds: number },
): Promise<ShellSeed> {
  const [head, prices] = await Promise.allSettled([
    reads.head(),
    reads.prices(),
  ])
  return toShell(
    head.status === "fulfilled" ? head.value : null,
    prices.status === "fulfilled" ? prices.value : null,
    options.live,
    options.rpc,
    options.nowSeconds,
  )
}
