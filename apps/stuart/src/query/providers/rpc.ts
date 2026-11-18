import { MEZO_MAINNET } from "@matchbox/chain"
import {
  type Address,
  type Chain,
  type ContractFunctionParameters,
  createPublicClient,
  fallback,
  http,
  type PublicClient,
  type Transport,
} from "viem"
import { z } from "zod"

// Mezo RPC for the reads the API read models do not cover: trove state, zap
// quotes, token balances and allowances, eth_call simulation, boost state
// and the voters' reward contract addresses. One client per request.

export const DEFAULT_MEZO_RPC_URLS = [
  "https://mainnet.mezo.public.validationcloud.io",
  "https://rpc-internal.mezo.org",
  "https://rpc-http.mezo.boar.network",
] as const

// rpc-internal rejects JSON-RPC batches much past 20 calls (HTTP 413).
const RPC_BATCH_SIZE = 20
const CHUNK = 200

// viem queues JSON-RPC batches per URL for the whole isolate, so two
// requests could share one fetch, and Workers cancels a request that waits
// on another request's I/O. A per-client fragment, which fetch never sends,
// gives each client its own queue.
let clientSequence = 0

function isolatedRpcUrl(url: string): string {
  clientSequence += 1
  return `${url}#c${clientSequence}`
}

/** `MEZO_RPC_URL` may list several URLs, comma separated, tried in order. */
export function rpcUrlsFrom(value: string | null): string[] {
  const urls = (value ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.startsWith("https://"))
  return urls.length > 0 ? urls : [...DEFAULT_MEZO_RPC_URLS]
}

export type MezoClient = PublicClient<Transport, Chain>

export function createMezoClient(urls: readonly string[]): MezoClient {
  return createPublicClient({
    chain: { ...MEZO_MAINNET, rpcUrls: { default: { http: [...urls] } } },
    transport: fallback(
      urls.map((url) =>
        http(isolatedRpcUrl(url), {
          batch: { batchSize: RPC_BATCH_SIZE },
          fetchOptions: { cache: "no-store" },
          retryCount: 0,
        }),
      ),
    ),
  })
}

export const bigintSchema = z.bigint()
export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .transform((value): Address => `0x${value.slice(2)}`)
export const stringSchema = z.string()
export const boolSchema = z.boolean()
export const numberSchema = z.number()

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size))
  }
  return out
}

/** Multicall with per-call failure tolerance; every result is zod-validated. */
export async function multicallParsed<T>(
  client: MezoClient,
  contracts: readonly ContractFunctionParameters[],
  schema: z.ZodType<T>,
  blockNumber?: bigint,
): Promise<Array<T | null>> {
  if (contracts.length === 0) return []
  const results = await Promise.all(
    chunks(contracts, CHUNK).map((chunk) =>
      client.multicall({
        contracts: chunk,
        allowFailure: true,
        ...(blockNumber !== undefined ? { blockNumber } : {}),
      }),
    ),
  )
  return results.flat().map((entry) => {
    if (entry.status !== "success") return null
    const parsed = schema.safeParse(entry.result)
    return parsed.success ? parsed.data : null
  })
}
