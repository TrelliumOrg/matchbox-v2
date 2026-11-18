import { ERC20_ABI } from "@matchbox/chain"
import type { Prices, WalletBalances } from "@matchbox/contracts/read-models"
import { getAddress, type PublicClient } from "viem"
import {
  btcToken,
  currentPrice,
  fromRaw,
  knownTokens,
  mezoToken,
  usdValue,
} from "./money"
import { tokenRegistry } from "./token-registry"

// Spendable BTC, MEZO and MUSD for one wallet, plus every other registered
// token it holds (token-registry.ts), read live from Mezo RPC in one
// multicall.
// Each answer is cached in the isolate for its block, so repeat requests in
// the same ~4s block cost one eth_blockNumber.

export const musdToken = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"

export type RawBalances = {
  block: number
  btc: bigint
  mezo: bigint
  musd: bigint
  /** Other registered tokens by address; zero balances left out. */
  others: Map<string, bigint>
}

/** Registered tokens beyond BTC, MEZO and MUSD (native BTC is not ERC-20). */
const otherTokens = [...tokenRegistry.keys()].filter(
  (token) => token !== btcToken && token !== mezoToken && token !== musdToken,
)

export type BalanceReader = (address: string) => Promise<RawBalances>

/** Isolate cache entries kept, oldest evicted first. */
const cacheSize = 500

export function createBalanceReader(client: PublicClient): BalanceReader {
  const cache = new Map<string, RawBalances>()
  return async function readBalances(address) {
    const blockNumber = await client.getBlockNumber()
    const key = `${address}@${blockNumber}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const owner = getAddress(address)
    const [btc, tokens] = await Promise.all([
      client.getBalance({ address: owner, blockNumber }),
      client.multicall({
        blockNumber,
        allowFailure: true,
        contracts: [mezoToken, musdToken, ...otherTokens].map((token) => ({
          address: getAddress(token),
          abi: ERC20_ABI,
          functionName: "balanceOf" as const,
          args: [owner] as const,
        })),
      }),
    ])
    const [mezo, musd, ...others] = tokens
    if (mezo?.status !== "success" || musd?.status !== "success") {
      throw new Error("MEZO or MUSD balance read failed")
    }
    const held = new Map<string, bigint>()
    others.forEach((result, index) => {
      const token = otherTokens[index]
      if (
        token !== undefined &&
        result.status === "success" &&
        result.result > 0n
      ) {
        held.set(token, result.result)
      }
    })
    const balances: RawBalances = {
      block: Number(blockNumber),
      btc,
      mezo: mezo.result,
      musd: musd.result,
      others: held,
    }
    cache.set(key, balances)
    if (cache.size > cacheSize) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    return balances
  }
}

function amount(token: string, raw: bigint, prices: Prices) {
  const ref = knownTokens[token]
  if (ref === undefined) throw new Error(`Unknown token ${token}`)
  const value = fromRaw(raw, ref.decimals)
  const price = currentPrice(token, prices)
  return {
    token: ref,
    amount: value,
    usd: price === null ? null : usdValue(value, price),
  }
}

export function walletBalances(
  address: string,
  raw: RawBalances,
  prices: Prices,
): WalletBalances {
  return {
    address,
    btc: amount(btcToken, raw.btc, prices),
    mezo: amount(mezoToken, raw.mezo, prices),
    musd: amount(musdToken, raw.musd, prices),
    tokens: [...raw.others]
      .flatMap(([token, value]) => {
        const registered = tokenRegistry.get(token)
        if (registered === undefined) return []
        const whole = fromRaw(value, registered.token.decimals)
        const price =
          registered.pricing === "usd"
            ? "1"
            : registered.pricing === "btc"
              ? (prices.btc?.usd ?? null)
              : registered.pricing === "mezo"
                ? (prices.mezo?.usd ?? null)
                : null
        return [
          {
            token: registered.token,
            amount: whole,
            usd: price === null ? null : usdValue(whole, price),
          },
        ]
      })
      .sort((left, right) => usdOrder(right.usd) - usdOrder(left.usd)),
  }
}

/** USD for ordering only; unpriced last. */
function usdOrder(usd: string | null): number {
  return usd === null ? -1 : Number(usd)
}
