import { writeFileSync } from "node:fs"
import path from "node:path"
import type { CrossChain } from "@matchbox/chain"
import { createLogger } from "@matchbox/logger"
import { createPublicClient, custom, type PublicClient } from "viem"
import { readBridgeFlows } from "../src/crosschain/bridge"
import { readMusdQuotes } from "../src/crosschain/musd-price"
import { fetchPoolInputs } from "../src/crosschain/pools"
import { readAllSupply } from "../src/crosschain/supply"

// Records test/fixtures/crosschain.json: every JSON-RPC call and HTTP GET
// one cross-chain run makes, answered by the real public sources, so the
// tests replay real answers. Read only. Large HTTP answers are trimmed to
// the entries the readers use (Curve's volume list to the tracked pools,
// DefiLlama charts to their last three points).
//
//   pnpm --filter @matchbox/jobs exec tsx scripts/record-crosschain-fixtures.ts

const out = path.resolve(
  import.meta.dirname,
  "../test/fixtures/crosschain.json",
)
const rpcUrls: Record<CrossChain, string> = {
  mezo: "https://mainnet.mezo.public.validationcloud.io",
  ethereum: "https://ethereum-rpc.publicnode.com",
  base: "https://mainnet.base.org",
  bsc: "https://bsc-rpc.publicnode.com",
}

type RpcRecord = {
  chain: CrossChain
  method: string
  params: unknown
  result: unknown
}
const rpc: RpcRecord[] = []

function recordingClient(chain: CrossChain): PublicClient {
  return createPublicClient({
    transport: custom({
      async request({ method, params }) {
        const response = await fetch(rpcUrls[chain], {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        })
        const body: unknown = await response.json()
        const result =
          typeof body === "object" && body !== null
            ? Reflect.get(body, "result")
            : undefined
        if (result === undefined) throw new Error(`${chain} ${method} failed`)
        rpc.push({ chain, method, params, result })
        return result
      },
    }),
  }) as PublicClient
}

const clients = {
  mezo: recordingClient("mezo"),
  ethereum: recordingClient("ethereum"),
  base: recordingClient("base"),
  bsc: recordingClient("bsc"),
}

const http: { url: string; status: number; body: unknown }[] = []
function trim(url: string, body: unknown): unknown {
  if (
    url.includes("api.curve.finance") &&
    typeof body === "object" &&
    body !== null
  ) {
    const data = Reflect.get(body, "data") as { pools: { address: string }[] }
    return {
      data: {
        pools: data.pools.filter(
          (pool) =>
            pool.address.toLowerCase() ===
            "0xb5571e76693ba60110b5811dd650ffefce1c955f",
        ),
      },
    }
  }
  if (
    url.includes("yields.llama.fi/chart") &&
    typeof body === "object" &&
    body !== null
  ) {
    const data = Reflect.get(body, "data") as unknown[]
    return { status: "success", data: data.slice(-3) }
  }
  if (url.includes("api.merkl.xyz") && Array.isArray(body)) {
    return body.map((item: Record<string, unknown>) => ({
      chainId: item.chainId,
      type: item.type,
      identifier: item.identifier,
      name: item.name,
      apr: item.apr,
      rewardsRecord: {
        breakdowns: (
          (
            item.rewardsRecord as {
              breakdowns?: { token: { symbol: string } }[]
            }
          )?.breakdowns ?? []
        ).map((breakdown) => ({ token: { symbol: breakdown.token.symbol } })),
      },
    }))
  }
  if (
    url.includes("geckoterminal") &&
    typeof body === "object" &&
    body !== null &&
    Array.isArray(Reflect.get(body, "data"))
  ) {
    const data = Reflect.get(body, "data") as {
      attributes: Record<string, unknown>
    }[]
    return {
      data: data.map((pool) => ({
        attributes: {
          address: pool.attributes.address,
          name: pool.attributes.name,
          reserve_in_usd: pool.attributes.reserve_in_usd,
          volume_usd: {
            h24: (pool.attributes.volume_usd as { h24: unknown }).h24,
          },
        },
      })),
    }
  }
  return body
}
async function recordingFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(url, init)
  const body: unknown = await response.json()
  http.push({ url, status: response.status, body: trim(url, body) })
  return new Response(JSON.stringify(body), { status: response.status })
}

const logger = createLogger({ level: "warn" })
await readMusdQuotes(clients)
await readAllSupply(clients)
await fetchPoolInputs(recordingFetch, logger)
await readBridgeFlows(recordingFetch, "musd", "2026-11-05", "2026-11-12")
writeFileSync(
  out,
  `${JSON.stringify({ recordedAt: new Date().toISOString(), rpc, http }, null, 2)}\n`,
)
console.log(`Wrote ${rpc.length} RPC and ${http.length} HTTP answers to ${out}`)
