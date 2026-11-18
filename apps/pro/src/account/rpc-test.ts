import { MEZO_MAINNET } from "@matchbox/chain"
import { groupThousands } from "../lib/format"
import { isRpcUrl } from "../settings/settings-store"

/**
 * The Network setting's Test: asks a custom RPC for its chain id and latest
 * block, timing the block request. Anything but Mezo mainnet (31612) is
 * rejected, so reads and simulations never run against another chain.
 * Plain fetch with hand-checked JSON, so the panel ships without viem or zod.
 */

export type RpcTestResult =
  | { kind: "ok"; block: bigint; ms: number }
  | { kind: "wrong-chain"; chainId: number }
  | { kind: "invalid-url" }
  | { kind: "unreachable" }
  | { kind: "bad-response" }

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

const timeoutMs = 6000

function hexResult(body: unknown): bigint | null {
  if (typeof body !== "object" || body === null) return null
  const result: unknown = Reflect.get(body, "result")
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]+$/.test(result))
    return null
  return BigInt(result)
}

async function rpc(
  fetcher: Fetcher,
  url: string,
  method: string,
): Promise<bigint | null> {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) return null
  const body: unknown = await response.json()
  return hexResult(body)
}

/** The line under the RPC URL after Test. */
export function rpcTestLabel(result: RpcTestResult): string {
  switch (result.kind) {
    case "ok":
      return `Mezo mainnet, block ${groupThousands(result.block)}, ${result.ms} ms`
    case "wrong-chain":
      return `Chain ${result.chainId}, not Mezo mainnet`
    case "invalid-url":
      return "https or localhost only"
    case "unreachable":
      return "No response"
    case "bad-response":
      return "Not a JSON-RPC endpoint"
  }
}

export async function testRpc(
  input: string,
  fetcher: Fetcher = (url, init) => fetch(url, init),
  now: () => number = () => performance.now(),
): Promise<RpcTestResult> {
  const url = input.trim()
  if (!isRpcUrl(url)) return { kind: "invalid-url" }
  try {
    const chainId = await rpc(fetcher, url, "eth_chainId")
    if (chainId === null) return { kind: "bad-response" }
    if (chainId !== BigInt(MEZO_MAINNET.id))
      return { kind: "wrong-chain", chainId: Number(chainId) }
    const started = now()
    const block = await rpc(fetcher, url, "eth_blockNumber")
    const ms = Math.max(0, Math.round(now() - started))
    if (block === null) return { kind: "bad-response" }
    return { kind: "ok", block, ms }
  } catch {
    return { kind: "unreachable" }
  }
}
