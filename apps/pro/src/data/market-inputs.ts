import type { ChainHead, Prices } from "@matchbox/contracts/read-models"

/**
 * The shell's market reads, each allowed to fail or to be late on its own.
 * Every page loads the market in the root loader, so this is on the path
 * of every first byte.
 *
 * The live head is the fragile read. The API's BlockHub forgets its head
 * when it sleeps: on the first request after a few idle minutes it has to
 * wake and poll an RPC (up to 2.5 s) before it can answer, and sometimes
 * answers 503. Waiting for it put the whole page 0.9 to 3.5 s behind on a
 * cold start (measured 12 Nov 2026 on a throttled phone profile, against
 * 0.2 s warm). The page does not need the newest block to paint: the
 * browser's head feed moves the ticker on within a block or two.
 *
 * So the live head has a short deadline. When it has not answered after
 * `hedgeAfterMs`, the last indexed head is read alongside it; at
 * `deadlineMs` the page goes with whichever it has.
 */

export type MarketReads = {
  /** The live chain head. */
  head: () => Promise<ChainHead>
  prices: () => Promise<Prices>
  /**
   * The last block the read models reflect, a few minutes old at most. The
   * browser's head feed moves the ticker on from it.
   */
  indexedHead: () => Promise<ChainHead>
}

export type MarketInputs = {
  head: ChainHead
  prices: Prices
  /** The reads that failed or were too slow and were covered, for the log. */
  degraded: ("head" | "prices")[]
}

export type MarketTiming = {
  /** With no live head by now, start reading the indexed one too. */
  hedgeAfterMs: number
  /** With no live head by now, go with the indexed one. */
  deadlineMs: number
  /** Resolves after `ms`; injected so tests need no clock. */
  wait: (ms: number) => Promise<void>
}

export const marketTiming: MarketTiming = {
  hedgeAfterMs: 150,
  deadlineMs: 450,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

const late: unique symbol = Symbol("late")

/**
 * Reads the head and prices together. Without prices the shell shows none.
 * Without a live head in time it starts from the last indexed block. It
 * rejects only when neither head can be read: then the API is down and
 * there is no page to draw.
 */
export async function readMarketInputs(
  reads: MarketReads,
  timing: MarketTiming = marketTiming,
): Promise<MarketInputs> {
  const prices = reads.prices().catch(() => null)
  const live = reads.head().catch(() => null)

  const early = await Promise.race([
    live,
    timing.wait(timing.hedgeAfterMs).then((): typeof late => late),
  ])
  let head: ChainHead | null = early === late ? null : early
  let covered = false
  if (head === null) {
    covered = true
    // Read the indexed head now; keep waiting for the live one meanwhile.
    const indexed = reads.indexedHead()
    // Not awaited yet: a failure must not go unhandled if the live head wins.
    indexed.catch(() => undefined)
    if (early === late) {
      const second = await Promise.race([
        live,
        timing
          .wait(Math.max(0, timing.deadlineMs - timing.hedgeAfterMs))
          .then((): typeof late => late),
      ])
      if (second !== late && second !== null) {
        head = second
        covered = false
      }
    }
    head ??= await indexed
  }

  const priced = await prices
  const degraded: MarketInputs["degraded"] = []
  if (covered) degraded.push("head")
  if (priced === null) degraded.push("prices")
  return {
    head,
    prices: priced ?? { btc: null, mezo: null },
    degraded,
  }
}
