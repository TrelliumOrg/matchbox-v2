import type { BlockHead } from "@matchbox/contracts/scan"
import { z } from "zod"

// One upstream read of the chain head per poll, tried against each RPC in
// order. Pure apart from the injected fetch, so the Durable Object around it
// stays thin and the logic is testable with a fake RPC.

/** Primary first; the fallbacks are the old indexer's endpoints. */
export const defaultHeadRpcUrls = [
  "https://mainnet.mezo.public.validationcloud.io",
  "https://rpc-internal.mezo.org",
  "https://rpc-http.mezo.boar.network",
] as const

/** Clients are told the feed is stale after this long without a head. */
export const staleAfterMs = 30_000

const hexQuantitySchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]+$/)
  .transform((value) => Number.parseInt(value.slice(2), 16))

/** Gas used as a base-10 string (exact whatever its size). */
const hexBigQuantitySchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]+$/)
  .transform((value) => BigInt(value).toString())

const hashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value.toLowerCase())

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value.toLowerCase())

/**
 * `number` and `timestamp` are required. The explorer extras are read when
 * the block carries them and are null otherwise, so an RPC that trims its
 * blocks never turns the feed stale.
 */
const blockResponseSchema = z.object({
  result: z.object({
    number: hexQuantitySchema,
    timestamp: hexQuantitySchema,
    hash: hashSchema.nullish().catch(null),
    gasUsed: hexBigQuantitySchema.nullish().catch(null),
    miner: addressSchema.nullish().catch(null),
    transactions: z.array(z.unknown()).nullish().catch(null),
  }),
})

export type Fetcher = (input: string, init: RequestInit) => Promise<Response>

export type PollResult =
  | { kind: "new"; head: BlockHead }
  | { kind: "same"; head: BlockHead }
  /** Every RPC failed; `stale` is true once failures outlast staleAfterMs. */
  | { kind: "failed"; stale: boolean; since: number }

export type HeadPollerOptions = {
  urls: readonly string[]
  fetch: Fetcher
  timeoutMs?: number
  /** Failures for this long make the feed stale; default staleAfterMs. */
  staleAfterMs?: number
}

async function readHead(
  url: string,
  fetcher: Fetcher,
  timeoutMs: number,
): Promise<BlockHead> {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBlockByNumber",
      params: ["latest", false],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`RPC answered ${response.status}`)
  const body: unknown = await response.json()
  const block = blockResponseSchema.parse(body).result
  return {
    block: block.number,
    timestamp: block.timestamp,
    hash: block.hash ?? null,
    transactionCount: block.transactions?.length ?? null,
    gasUsed: block.gasUsed ?? null,
    miner: block.miner ?? null,
  }
}

export class HeadPoller {
  head: BlockHead | null = null
  /** Wall-clock ms of the last poll that reached an RPC; null before one. */
  lastSuccessAt: number | null = null
  private failingSince: number | null = null
  private readonly options: Required<HeadPollerOptions>

  constructor(options: HeadPollerOptions) {
    this.options = { timeoutMs: 2_500, staleAfterMs, ...options }
  }

  /** True while every RPC has failed for at least staleAfterMs. */
  isStale(nowMs: number): boolean {
    return (
      this.failingSince !== null &&
      nowMs - this.failingSince >= this.options.staleAfterMs
    )
  }

  /** Unix seconds when the current failure run began; null when healthy. */
  get failingSinceSeconds(): number | null {
    return this.failingSince === null
      ? null
      : Math.floor(this.failingSince / 1000)
  }

  /** Reads the head once; `nowMs` is when the poll started. */
  async poll(nowMs: number): Promise<PollResult> {
    for (const url of this.options.urls) {
      try {
        const head = await readHead(
          url,
          this.options.fetch,
          this.options.timeoutMs,
        )
        this.failingSince = null
        this.lastSuccessAt = nowMs
        // Never step backwards when a lagging fallback answers.
        if (this.head !== null && head.block <= this.head.block) {
          return { kind: "same", head: this.head }
        }
        this.head = head
        return { kind: "new", head }
      } catch {
        // Try the next endpoint.
      }
    }
    this.failingSince ??= nowMs
    return {
      kind: "failed",
      stale: this.isStale(nowMs),
      since: Math.floor(this.failingSince / 1000),
    }
  }
}
