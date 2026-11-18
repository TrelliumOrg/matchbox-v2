import { z } from "zod"

// The chain head for freshness checks, read from BlockHub's plain GET and
// remembered in the isolate for under a block, so a burst of proxy requests
// costs one Durable Object request. A read is waited on for at most
// `timeoutMs` (300 ms): past that, or on any failure, the answer is
// unknown and the proxy falls back to time buckets. A failed or slow read
// is not retried inside the same window.

const headBodySchema = z.object({
  data: z.object({
    block: z.number().int().nonnegative(),
    /** Absent from a hub older than this field. */
    lastActiveBlock: z.number().int().nonnegative().optional(),
    /**
     * True when the hub answered its last saved head because its poll was
     * slow or failed: not the current head, so freshness treats it as
     * unknown.
     */
    stored: z.boolean().optional(),
  }),
})

export type ChainClock = {
  /** Current head, or null when unknown. */
  height: number | null
  /** Newest block that may have had transactions, or null when unknown. */
  lastActive: number | null
}

export const unknownClock: ChainClock = { height: null, lastActive: null }

export type HeadReaderOptions = {
  /** BlockHub's `GET /head` response. */
  read: () => Promise<Response>
  /** Epoch milliseconds. */
  now?: () => number
  /** How long a read is reused (default 1000 ms). */
  maxAgeMs?: number
  /** How long a caller waits for a read (default 300 ms). */
  timeoutMs?: number
}

export function createHeadReader(
  options: HeadReaderOptions,
): () => Promise<ChainClock> {
  const now = options.now ?? (() => Date.now())
  const maxAgeMs = options.maxAgeMs ?? 1_000
  const timeoutMs = options.timeoutMs ?? 300
  let last: { at: number; clock: Promise<ChainClock> } | null = null

  async function readClock(): Promise<ChainClock> {
    try {
      const response = await options.read()
      if (!response.ok) return unknownClock
      const parsed = headBodySchema.safeParse(await response.json())
      if (!parsed.success || parsed.data.data.stored === true) {
        return unknownClock
      }
      return {
        height: parsed.data.data.block,
        lastActive: parsed.data.data.lastActiveBlock ?? null,
      }
    } catch {
      return unknownClock
    }
  }

  return function currentClock() {
    if (last === null || now() - last.at >= maxAgeMs) {
      last = { at: now(), clock: readClock() }
    }
    const pending = last.clock
    return new Promise<ChainClock>((resolve) => {
      const timer = setTimeout(() => resolve(unknownClock), timeoutMs)
      pending.then((clock) => {
        clearTimeout(timer)
        resolve(clock)
      })
    })
  }
}

// Blockscout's own indexing state (`main-page/indexing-status`), read at
// most once a minute per isolate: older history pages are only kept long
// while it reports every block indexed. Unknown (failure, slow read) is
// treated as not indexed, so pages keep their route's freshness.

const indexingBodySchema = z.object({
  finished_indexing_blocks: z.boolean(),
})

export type IndexingReaderOptions = {
  /** Blockscout's `GET main-page/indexing-status` response. */
  read: () => Promise<Response>
  /** Epoch milliseconds. */
  now?: () => number
  /** How long a read is reused (default 60 s). */
  maxAgeMs?: number
  /** How long a caller waits for a read (default 500 ms). */
  timeoutMs?: number
}

export function createIndexingReader(
  options: IndexingReaderOptions,
): () => Promise<boolean | null> {
  const now = options.now ?? (() => Date.now())
  const maxAgeMs = options.maxAgeMs ?? 60_000
  const timeoutMs = options.timeoutMs ?? 500
  let last: { at: number; indexed: Promise<boolean | null> } | null = null

  async function readIndexed(): Promise<boolean | null> {
    try {
      const response = await options.read()
      if (!response.ok) {
        await response.body?.cancel()
        return null
      }
      const parsed = indexingBodySchema.safeParse(await response.json())
      return parsed.success ? parsed.data.finished_indexing_blocks : null
    } catch {
      return null
    }
  }

  return function blocksIndexed() {
    if (last === null || now() - last.at >= maxAgeMs) {
      last = { at: now(), indexed: readIndexed() }
    }
    const pending = last.indexed
    return new Promise<boolean | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs)
      pending.then((indexed) => {
        clearTimeout(timer)
        resolve(indexed)
      })
    })
  }
}
