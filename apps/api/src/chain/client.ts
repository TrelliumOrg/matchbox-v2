import { CHAIN_ID } from "@matchbox/chain"
import {
  type Chain,
  createPublicClient,
  defineChain,
  fallback,
  http,
  type PublicClient,
} from "viem"
import { defaultHeadRpcUrls } from "../heads/poller"
import { multicall3Address } from "../reconcile/chain-reader"

/** Mezo mainnet with the canonical Multicall3, for batched reads. */
export const mezoMainnet: Chain = defineChain({
  id: CHAIN_ID.mainnet,
  name: "Mezo",
  nativeCurrency: { decimals: 18, name: "Bitcoin", symbol: "BTC" },
  rpcUrls: { default: { http: [...defaultHeadRpcUrls] } },
  contracts: { multicall3: { address: multicall3Address } },
})

/**
 * A Mezo client over the given RPCs, primary first, falling back in order.
 * Multicall batching packs concurrent reads into Multicall3 calls.
 *
 * Retries happen at two levels in viem: each endpoint's own (`http`) and
 * the whole list's (`fallback`, 3 by default, a timeout counting as
 * retryable). `retries` sets both; without it the client keeps the
 * settings it always had (one retry per endpoint, the list's default),
 * which the minute cron, the market snapshot and wallet builds rely on.
 */
export function createMezoClient(
  urls: readonly string[] = defaultHeadRpcUrls,
  timeoutMs = 15_000,
  retries?: number,
  options: { batch?: boolean } = {},
): PublicClient {
  return createPublicClient({
    chain: mezoMainnet,
    transport: fallback(
      urls.map((url) =>
        http(url, { timeout: timeoutMs, retryCount: retries ?? 1 }),
      ),
      retries === undefined ? {} : { retryCount: retries },
    ),
    ...(options.batch === false
      ? {}
      : { batch: { multicall: { batchSize: 1024 * 16, wait: 0 } } }),
  })
}

/**
 * The client for page-view reads (live claimable, live locks), no retry.
 * Those readers build their own Multicall3 requests and send several at
 * once (`askChain`), so the client must not batch: its multicall batching
 * packs concurrent `eth_call`s, Multicall3 requests included, into one
 * outer Multicall3 call. On 20 Nov 2026 a wallet voting 25 gauges asked
 * for 165 `earned` calls in five requests; packed into one call they ran
 * out of gas on every public RPC ("out of gas", then "Missing or invalid
 * parameters" from the last fallback), so its claimable was never live.
 * Sent as five requests each took 0.15 to 0.35 s.
 */
export function createLiveMezoClient(
  urls: readonly string[],
  timeoutMs: number,
): PublicClient {
  return createMezoClient(urls, timeoutMs, 0, { batch: false })
}

/**
 * Pro's live wallet reads wait at most 4 s for the chain
 * (`claimableDeadlineMs`). One request took 0.7 s at worst on a fallback
 * RPC (13 Nov 2026), so an endpoint gets 2 s, with no retry: a stuck
 * request is ended rather than left running for the default 15 s.
 */
export const liveReadTimeoutMs = 2_000

/**
 * Matchscan's chain reads (the primary RPC only): one request took 0.25 s
 * at worst there and 0.6 s on a fallback, and a whole route must answer
 * inside Matchscan's 3 s (`scan/live-locks.ts`).
 */
export const scanReadTimeoutMs = 1_200
