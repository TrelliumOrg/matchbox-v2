import type { TokenRegistryEntry } from "@matchbox/chain"
import { createLogger } from "@matchbox/logger"
import {
  decodeFunctionData,
  encodeFunctionResult,
  type Hex,
  parseAbi,
} from "viem"
import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { formatUnits } from "./money"
import {
  aeroMezoMusdPool,
  baseMezoToken,
  baseMusdToken,
  cachedMezoFromKv,
  mezoUsdFromSqrtPriceX96,
  publicBaseRpcUrls,
  type ReferencePrices,
  readReferencePrices,
  skipBtcUsdOracle,
  tokenPrice,
} from "./prices"

// Registry entries the real registry doesn't have, layered over it.
const extraRegistry = vi.hoisted(() => new Map<string, TokenRegistryEntry>())

vi.mock("@matchbox/chain", async (importOriginal) => {
  const actual = await importOriginal<{
    getTokenFromRegistry(address: string): TokenRegistryEntry | undefined
  }>()
  return {
    ...actual,
    getTokenFromRegistry(address: string) {
      return (
        extraRegistry.get(address.toLowerCase()) ??
        actual.getTokenFromRegistry(address)
      )
    },
  }
})

const testAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
])

const hexSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/)
  .transform((value): Hex => `0x${value.slice(2)}`)

const rpcRequestSchema = z.object({
  id: z.number(),
  method: z.literal("eth_call"),
  params: z.tuple([z.object({ to: z.string(), data: hexSchema })], z.unknown()),
})

type Call = { to: string; functionName: string }

/** A contract-answering RPC, or one that fails at the transport. */
type Endpoint = ((call: Call) => Hex) | "down" | "hang" | "garbage"

const mezoRpc = "https://mezo.test/rpc"
const configuredBase = "https://base.test/v2/secret-key"
const [publicBase, publicnode] = publicBaseRpcUrls
const otherToken = "0x9999999999999999999999999999999999999999"

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000))
}

function rpcResponse(id: number, payload: object): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, ...payload }), {
    headers: { "content-type": "application/json" },
  })
}

/** Stubs fetch with JSON-RPC endpoints by URL; returns the URLs hit, in order. */
function stubRpc(endpoints: Record<string, Endpoint>): string[] {
  const hits: string[] = []
  vi.stubGlobal(
    "fetch",
    async function fetchStub(
      input: unknown,
      init?: RequestInit,
    ): Promise<Response> {
      // viem normalizes origin-only URLs ("https://mainnet.base.org/"), so
      // match on the parsed href and record the URL as configured.
      const href = new URL(String(input)).href
      const url =
        Object.keys(endpoints).find((key) => new URL(key).href === href) ??
        String(input)
      hits.push(url)
      const endpoint = endpoints[url] ?? "down"
      if (endpoint === "down") {
        return new Response("bad gateway", { status: 502 })
      }
      if (endpoint === "garbage") return new Response("<html>", { status: 200 })
      if (endpoint === "hang") {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          )
        })
      }
      const body = typeof init?.body === "string" ? init.body : ""
      const request = rpcRequestSchema.parse(JSON.parse(body))
      const [{ to, data }] = request.params
      try {
        const { functionName } = decodeFunctionData({ abi: testAbi, data })
        return rpcResponse(request.id, {
          result: endpoint({ to, functionName }),
        })
      } catch {
        return rpcResponse(request.id, {
          error: { code: 3, message: "execution reverted" },
        })
      }
    },
  )
  return hits
}

function distinct(hits: readonly string[]): string[] {
  return [...new Set(hits)]
}

function oracle(state: {
  answer: bigint
  updatedAt: bigint
  decimals: number
}): Endpoint {
  return function answer({ to, functionName }) {
    if (!sameAddress(to, skipBtcUsdOracle)) throw new Error("Unknown contract")
    if (functionName === "decimals") {
      return encodeFunctionResult({
        abi: testAbi,
        functionName: "decimals",
        result: state.decimals,
      })
    }
    return encodeFunctionResult({
      abi: testAbi,
      functionName: "latestRoundData",
      result: [7n, state.answer, state.updatedAt, state.updatedAt, 7n],
    })
  }
}

type PoolState = {
  token0: Hex
  token1: Hex
  sqrtPriceX96: bigint
  liquidity: bigint
  mezoDecimals: number
  musdDecimals: number
}

/** MEZO/MUSD at $0.25: both 18 decimals, sqrt(0.25) * 2^96 = 2^95. */
const quarterPool: PoolState = {
  token0: baseMezoToken,
  token1: baseMusdToken,
  sqrtPriceX96: 2n ** 95n,
  liquidity: 10n ** 21n,
  mezoDecimals: 18,
  musdDecimals: 18,
}

function pool(overrides: Partial<PoolState> = {}): Endpoint {
  const state = { ...quarterPool, ...overrides }
  return function answer({ to, functionName }) {
    if (sameAddress(to, aeroMezoMusdPool)) {
      switch (functionName) {
        case "slot0":
          return encodeFunctionResult({
            abi: testAbi,
            functionName: "slot0",
            result: [state.sqrtPriceX96, -1000, 0, 1, 1, true],
          })
        case "liquidity":
          return encodeFunctionResult({
            abi: testAbi,
            functionName: "liquidity",
            result: state.liquidity,
          })
        case "token0":
          return encodeFunctionResult({
            abi: testAbi,
            functionName: "token0",
            result: state.token0,
          })
        case "token1":
          return encodeFunctionResult({
            abi: testAbi,
            functionName: "token1",
            result: state.token1,
          })
      }
    }
    if (functionName === "decimals" && sameAddress(to, baseMezoToken)) {
      return encodeFunctionResult({
        abi: testAbi,
        functionName: "decimals",
        result: state.mezoDecimals,
      })
    }
    if (functionName === "decimals" && sameAddress(to, baseMusdToken)) {
      return encodeFunctionResult({
        abi: testAbi,
        functionName: "decimals",
        result: state.musdDecimals,
      })
    }
    throw new Error("Unknown call")
  }
}

/** 65000.5 USD with 8 decimals, updated a minute ago. */
function freshOracle(): Endpoint {
  return oracle({
    answer: 6_500_050_000_000n,
    updatedAt: nowSeconds() - 60n,
    decimals: 8,
  })
}

function captureLogger() {
  const lines: string[] = []
  const logger = createLogger({
    format: "json",
    sink: (_level, line) => lines.push(line),
  })
  return { logger, lines }
}

afterEach(() => {
  vi.unstubAllGlobals()
  extraRegistry.clear()
})

describe("readReferencePrices", () => {
  it("reads BTC from the Skip oracle and MEZO from the Base pool", async () => {
    const hits = stubRpc({ [mezoRpc]: freshOracle(), [configuredBase]: pool() })
    const prices = await readReferencePrices({
      coingecko: null,
      mezoMainnetRpcUrl: mezoRpc,
      baseRpcUrl: configuredBase,
    })
    expect(prices).toEqual({
      btcUsd: { usd: "65000.5", source: "skip-oracle" },
      mezoUsd: { usd: "0.25", source: "aerodrome-cl" },
    })
    expect(distinct(hits).sort()).toEqual([configuredBase, mezoRpc].sort())
  })

  it("formats 18-decimal oracle answers exactly", async () => {
    stubRpc({
      [mezoRpc]: oracle({
        answer: 80_224_123_456_789_012_345_678n,
        updatedAt: nowSeconds() - 3_500n,
        decimals: 18,
      }),
    })
    const prices = await readReferencePrices({
      coingecko: null,
      mezoMainnetRpcUrl: mezoRpc,
      baseRpcUrl: null,
    })
    expect(prices.btcUsd).toEqual({
      usd: "80224.123456789012345678",
      source: "skip-oracle",
    })
  })

  it("rejects a stale oracle round", async () => {
    stubRpc({
      [mezoRpc]: oracle({
        answer: 6_500_000_000_000n,
        updatedAt: nowSeconds() - 3_601n,
        decimals: 8,
      }),
      [configuredBase]: pool(),
    })
    const { logger, lines } = captureLogger()
    const prices = await readReferencePrices({
      coingecko: null,
      mezoMainnetRpcUrl: mezoRpc,
      baseRpcUrl: configuredBase,
      logger,
    })
    expect(prices.btcUsd).toBeNull()
    expect(prices.mezoUsd).toEqual({ usd: "0.25", source: "aerodrome-cl" })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("BTC/USD price unavailable")
    expect(lines[0]).toContain("stale")
  })

  it("rejects a zero or negative oracle answer", async () => {
    for (const answer of [0n, -1n]) {
      stubRpc({
        [mezoRpc]: oracle({ answer, updatedAt: nowSeconds(), decimals: 8 }),
      })
      const prices = await readReferencePrices({
        coingecko: null,
        mezoMainnetRpcUrl: mezoRpc,
        baseRpcUrl: null,
      })
      expect(prices.btcUsd, `answer ${answer}`).toBeNull()
    }
  })

  it("skips BTC without a Mezo mainnet RPC URL", async () => {
    for (const mezoMainnetRpcUrl of [null, "", "   "]) {
      const hits = stubRpc({ [configuredBase]: pool() })
      const prices = await readReferencePrices({
        coingecko: null,
        mezoMainnetRpcUrl,
        baseRpcUrl: configuredBase,
      })
      expect(prices.btcUsd).toBeNull()
      expect(prices.mezoUsd).not.toBeNull()
      expect(distinct(hits)).toEqual([configuredBase])
    }
  })

  it("falls back from the configured Base RPC to the public ones in order", async () => {
    const hits = stubRpc({
      [configuredBase]: "down",
      [publicBase]: "hang",
      [publicnode]: pool(),
    })
    const prices = await readReferencePrices({
      coingecko: null,
      mezoMainnetRpcUrl: null,
      baseRpcUrl: configuredBase,
      fetchTimeoutMs: 50,
    })
    expect(prices.mezoUsd).toEqual({ usd: "0.25", source: "aerodrome-cl" })
    expect(distinct(hits)).toEqual([configuredBase, publicBase, publicnode])
  })

  it("starts with the public Base RPCs when none is configured", async () => {
    const hits = stubRpc({ [publicBase]: pool() })
    const prices = await readReferencePrices({
      coingecko: null,
      mezoMainnetRpcUrl: null,
      baseRpcUrl: null,
    })
    expect(prices.mezoUsd).toEqual({ usd: "0.25", source: "aerodrome-cl" })
    expect(distinct(hits)).toEqual([publicBase])
  })

  it("does not repeat a configured RPC that is also a public one", async () => {
    const hits = stubRpc({ [publicnode]: pool() })
    await readReferencePrices({
      coingecko: null,
      mezoMainnetRpcUrl: null,
      baseRpcUrl: ` ${publicnode} `,
    })
    expect(distinct(hits)).toEqual([publicnode])
  })

  it("stops at the first RPC that prices MEZO", async () => {
    const hits = stubRpc({
      [configuredBase]: pool(),
      [publicBase]: pool({ sqrtPriceX96: 2n ** 96n }),
    })
    const prices = await readReferencePrices({
      coingecko: null,
      mezoMainnetRpcUrl: null,
      baseRpcUrl: configuredBase,
    })
    expect(prices.mezoUsd?.usd).toBe("0.25")
    expect(distinct(hits)).toEqual([configuredBase])
  })

  it("tries the next RPC after an on-chain rejection", async () => {
    const hits = stubRpc({
      [configuredBase]: pool({ liquidity: 0n }),
      [publicBase]: pool(),
    })
    const prices = await readReferencePrices({
      coingecko: null,
      mezoMainnetRpcUrl: null,
      baseRpcUrl: configuredBase,
    })
    expect(prices.mezoUsd?.usd).toBe("0.25")
    expect(distinct(hits)).toEqual([configuredBase, publicBase])
  })

  it("inverts the price when MEZO is token1", async () => {
    // sqrt(4) * 2^96: 4 MEZO per MUSD.
    stubRpc({
      [publicBase]: pool({
        token0: baseMusdToken,
        token1: baseMezoToken,
        sqrtPriceX96: 2n ** 97n,
      }),
    })
    const prices = await readReferencePrices({
      coingecko: null,
      mezoMainnetRpcUrl: null,
      baseRpcUrl: null,
    })
    expect(prices.mezoUsd?.usd).toBe("0.25")
  })

  it("applies the tokens' on-chain decimals", async () => {
    // 1 MEZO base unit per MUSD base unit with 6-decimal MEZO, 18-decimal MUSD.
    stubRpc({
      [publicBase]: pool({
        token0: baseMusdToken,
        token1: baseMezoToken,
        sqrtPriceX96: 2n ** 96n,
        mezoDecimals: 6,
        musdDecimals: 18,
      }),
    })
    const prices = await readReferencePrices({
      coingecko: null,
      mezoMainnetRpcUrl: null,
      baseRpcUrl: null,
    })
    expect(prices.mezoUsd?.usd).toBe("0.000000000001")
  })

  it("accepts prices just under $1,000,000", async () => {
    stubRpc({ [publicBase]: pool({ sqrtPriceX96: 999n * 2n ** 96n }) })
    const prices = await readReferencePrices({
      coingecko: null,
      mezoMainnetRpcUrl: null,
      baseRpcUrl: null,
    })
    expect(prices.mezoUsd?.usd).toBe("998001")
  })

  it("returns null when every RPC rejects the pool", async () => {
    const rejected: Record<string, Partial<PoolState>> = {
      "empty pool": { liquidity: 0n },
      "zero price": { sqrtPriceX96: 0n },
      "wrong pair": { token0: otherToken },
      "same token twice": { token1: baseMezoToken },
      "absurd price": { sqrtPriceX96: 1_000n * 2n ** 96n },
      "absurd decimals": { musdDecimals: 77 },
    }
    for (const [label, overrides] of Object.entries(rejected)) {
      const bad = pool(overrides)
      const hits = stubRpc({
        [configuredBase]: bad,
        [publicBase]: bad,
        [publicnode]: bad,
      })
      const { logger, lines } = captureLogger()
      const prices = await readReferencePrices({
        coingecko: null,
        mezoMainnetRpcUrl: null,
        baseRpcUrl: configuredBase,
        logger,
      })
      expect(prices.mezoUsd, label).toBeNull()
      expect(distinct(hits), label).toEqual([
        configuredBase,
        publicBase,
        publicnode,
      ])
      expect(lines.filter((line) => line.includes("MEZO/USD"))).toHaveLength(1)
    }
  })

  it("never throws when RPCs fail at the transport", async () => {
    for (const endpoint of ["down", "garbage"] as const) {
      stubRpc({
        [mezoRpc]: endpoint,
        [configuredBase]: endpoint,
        [publicBase]: endpoint,
        [publicnode]: endpoint,
      })
      const prices = await readReferencePrices({
        coingecko: null,
        mezoMainnetRpcUrl: mezoRpc,
        baseRpcUrl: configuredBase,
      })
      expect(prices, endpoint).toEqual({ btcUsd: null, mezoUsd: null })
    }
    vi.stubGlobal("fetch", function fetchThrows(): never {
      throw new TypeError("fetch failed")
    })
    await expect(
      readReferencePrices({
        coingecko: null,
        mezoMainnetRpcUrl: mezoRpc,
        baseRpcUrl: "not a url",
      }),
    ).resolves.toEqual({ btcUsd: null, mezoUsd: null })
  })

  it("times out a hanging Mezo RPC", async () => {
    stubRpc({ [mezoRpc]: "hang" })
    const prices = await readReferencePrices({
      coingecko: null,
      mezoMainnetRpcUrl: mezoRpc,
      baseRpcUrl: null,
      fetchTimeoutMs: 20,
    })
    expect(prices.btcUsd).toBeNull()
  })

  it("ignores an invalid timeout", async () => {
    stubRpc({ [mezoRpc]: freshOracle(), [publicBase]: pool() })
    for (const fetchTimeoutMs of [0, -1, Number.NaN]) {
      const prices = await readReferencePrices({
        coingecko: null,
        mezoMainnetRpcUrl: mezoRpc,
        baseRpcUrl: null,
        fetchTimeoutMs,
      })
      expect(prices.btcUsd?.usd).toBe("65000.5")
      expect(prices.mezoUsd?.usd).toBe("0.25")
    }
  })

  it("keeps RPC URLs out of the logs", async () => {
    stubRpc({})
    const { logger, lines } = captureLogger()
    await readReferencePrices({
      coingecko: null,
      mezoMainnetRpcUrl: mezoRpc,
      baseRpcUrl: configuredBase,
      logger,
    })
    expect(lines).toHaveLength(2)
    const output = lines.join("\n")
    expect(output).not.toContain("secret-key")
    expect(output).not.toContain("mezo.test")
    expect(output).toContain('"rpc":"configured"')
    expect(output).toContain(publicBase)
  })
})

describe("mezoUsdFromSqrtPriceX96", () => {
  const even = { mezoIsToken0: true, mezoDecimals: 18, musdDecimals: 18 }
  const wad = 10n ** 18n

  it("squares sqrtPriceX96 into an 18-decimal price", () => {
    expect(mezoUsdFromSqrtPriceX96(2n ** 96n, even)).toBe(wad)
    expect(mezoUsdFromSqrtPriceX96(2n ** 95n, even)).toBe(wad / 4n)
    expect(mezoUsdFromSqrtPriceX96(0n, even)).toBe(0n)
  })

  it("inverts when MEZO is token1", () => {
    const inverted = { ...even, mezoIsToken0: false }
    expect(mezoUsdFromSqrtPriceX96(2n ** 97n, inverted)).toBe(wad / 4n)
    expect(mezoUsdFromSqrtPriceX96(2n ** 95n, inverted)).toBe(4n * wad)
    expect(mezoUsdFromSqrtPriceX96(0n, inverted)).toBe(0n)
  })

  it("scales by the decimal difference", () => {
    expect(
      mezoUsdFromSqrtPriceX96(2n ** 96n, { ...even, musdDecimals: 6 }),
    ).toBe(10n ** 12n * wad)
    expect(
      mezoUsdFromSqrtPriceX96(2n ** 96n, {
        mezoIsToken0: false,
        mezoDecimals: 6,
        musdDecimals: 18,
      }),
    ).toBe(10n ** 6n)
  })

  it("matches the live pool's encoding", () => {
    // slot0 of the Base MEZO/MUSD pool on 2026-10-26 (MEZO is token0).
    const price = mezoUsdFromSqrtPriceX96(0x142b2791617f02372c76e6f6n, even)
    expect(formatUnits(price, 18)).toBe("0.006206837723028314")
  })
})

describe("tokenPrice", () => {
  const refs: ReferencePrices = {
    btcUsd: { usd: "65000.5", source: "skip-oracle" },
    mezoUsd: { usd: "0.25", source: "aerodrome-cl" },
  }
  const noRefs: ReferencePrices = { btcUsd: null, mezoUsd: null }
  const mezo = "0x7B7C000000000000000000000000000000000001"
  const btc = "0x7b7c000000000000000000000000000000000000"
  const tbtc = "0x18084fba666a33d37592fa2633fd49a74dd93a88"
  const musd = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
  const musdc = "0x04671c72aab5ac02a03c1098314b1bb6b560c197"

  it("prices registry tokens by type", () => {
    expect(tokenPrice(mezo, refs)).toEqual({ usd: "0.25", source: "mezo" })
    expect(tokenPrice(btc, refs)).toEqual({
      usd: "65000.5",
      source: "btc-pegged",
    })
    expect(tokenPrice(tbtc.toUpperCase().replace("0X", "0x"), refs)).toEqual({
      usd: "65000.5",
      source: "btc-pegged",
    })
    expect(tokenPrice(musd, refs)).toEqual({ usd: "1", source: "stablecoin" })
    expect(tokenPrice(musdc, refs)).toEqual({ usd: "1", source: "stablecoin" })
  })

  it("prices Mezo's bridged BTC wrappers at BTC by address", () => {
    for (const wrapper of [
      "0xa10ad2570ea7b93d19fdae6bd7189ff4929bc747", // mSolvBTC
      "0xdf708431162ba247ddae362d2c919e0fbafcf9de", // mxSolvBTC
      "0x6a7cd8e1384d49f502b4a4ce9ac9eb320835c5d7", // mcbBTC
    ]) {
      expect(tokenPrice(wrapper, refs), wrapper).toEqual({
        usd: "65000.5",
        source: "btc-pegged",
      })
    }
  })

  it("is null when the reference price is missing", () => {
    expect(tokenPrice(mezo, noRefs)).toBeNull()
    expect(tokenPrice(btc, noRefs)).toBeNull()
    expect(tokenPrice(musd, noRefs)).toEqual({ usd: "1", source: "stablecoin" })
  })

  it("never prices unregistered tokens, whatever they are called", () => {
    expect(tokenPrice(otherToken, refs)).toBeNull()
    expect(tokenPrice(baseMezoToken, refs)).toBeNull()
    for (const symbol of ["BTC", "FAKEBTC", "WBTC", "MEZO", "USDC", "MUSD"]) {
      expect(tokenPrice(symbol, refs), symbol).toBeNull()
    }
  })

  it("uses a registry fixed price only when it is a plain decimal", () => {
    extraRegistry.set("0x1111111111111111111111111111111111111111", {
      symbol: "USDX",
      priceType: "stablecoin",
      fixedPrice: "0.998",
    })
    extraRegistry.set("0x2222222222222222222222222222222222222222", {
      symbol: "BAD",
      priceType: "stablecoin",
      fixedPrice: "NaN",
    })
    extraRegistry.set("0x3333333333333333333333333333333333333333", {
      symbol: "TINY",
      priceType: "stablecoin",
      fixedPrice: "1e-7",
    })
    extraRegistry.set("0x4444444444444444444444444444444444444444", {
      symbol: "UNK",
      priceType: "unknown",
      fixedPrice: null,
    })
    expect(
      tokenPrice("0x1111111111111111111111111111111111111111", refs),
    ).toEqual({ usd: "0.998", source: "stablecoin" })
    expect(
      tokenPrice("0x2222222222222222222222222222222222222222", refs),
    ).toBeNull()
    expect(
      tokenPrice("0x3333333333333333333333333333333333333333", refs),
    ).toBeNull()
    expect(
      tokenPrice("0x4444444444444444444444444444444444444444", refs),
    ).toBeNull()
  })
})

/** MEZO in a recorded `simple/price` answer (12 Nov 2026). */
const coingeckoMezo = {
  mezo: {
    usd: 0.00457132,
    usd_market_cap: 2263925.3989963485,
    usd_24h_vol: 887894.6107905294,
    last_updated_at: 1794465277,
  },
}
const quoteTime = 1_794_465_300

type CoinGeckoAnswer = { status: number; body?: unknown }

/** Answers CoinGecko's host; everything else goes to the RPC stub. */
function stubCoinGecko(
  answer: CoinGeckoAnswer,
  endpoints: Record<string, Endpoint>,
): { rpcHits: string[]; requests: { url: string; headers: Headers }[] } {
  const rpcHits = stubRpc(endpoints)
  const rpcFetch = globalThis.fetch
  const requests: { url: string; headers: Headers }[] = []
  vi.stubGlobal(
    "fetch",
    async function fetchStub(input: unknown, init?: RequestInit) {
      const url = String(input)
      if (new URL(url).hostname.endsWith("coingecko.com")) {
        requests.push({ url, headers: new Headers(init?.headers) })
        return new Response(JSON.stringify(answer.body ?? {}), {
          status: answer.status,
          headers: { "content-type": "application/json" },
        })
      }
      return rpcFetch(input as string, init)
    },
  )
  return { rpcHits, requests }
}

describe("MEZO from CoinGecko", () => {
  const keyless = { apiKey: null, plan: "demo" } as const

  it("prices MEZO from CoinGecko first, without touching Base", async () => {
    const { rpcHits, requests } = stubCoinGecko(
      { status: 200, body: coingeckoMezo },
      { [configuredBase]: pool() },
    )
    const prices = await readReferencePrices({
      coingecko: keyless,
      mezoMainnetRpcUrl: null,
      baseRpcUrl: configuredBase,
      nowSeconds: quoteTime,
    })
    expect(prices).toEqual({
      btcUsd: null,
      mezoUsd: { usd: "0.00457132", source: "coingecko" },
    })
    expect(rpcHits).toEqual([])
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toContain("ids=mezo&")
    expect(requests[0]?.headers.has("x-cg-demo-api-key")).toBe(false)
  })

  it("falls back to the new Aerodrome pool on a rate limit", async () => {
    const { rpcHits } = stubCoinGecko(
      { status: 429 },
      { [configuredBase]: pool() },
    )
    const { logger, lines } = captureLogger()
    const prices = await readReferencePrices({
      coingecko: { apiKey: "CG-key", plan: "demo" },
      mezoMainnetRpcUrl: null,
      baseRpcUrl: configuredBase,
      nowSeconds: quoteTime,
      logger,
    })
    expect(prices.mezoUsd).toEqual({ usd: "0.25", source: "aerodrome-cl" })
    expect(distinct(rpcHits)).toEqual([configuredBase])
    expect(lines.join("\n")).toContain("429")
    expect(lines.join("\n")).not.toContain("CG-key")
  })

  it("falls back on a stale or missing quote", async () => {
    for (const body of [
      { mezo: { ...coingeckoMezo.mezo, last_updated_at: quoteTime - 1_801 } },
      { "mezo-usd": { usd: 0.99 } },
      { mezo: { usd: 2_000_000 } },
    ]) {
      stubCoinGecko({ status: 200, body }, { [configuredBase]: pool() })
      const prices = await readReferencePrices({
        coingecko: keyless,
        mezoMainnetRpcUrl: null,
        baseRpcUrl: configuredBase,
        nowSeconds: quoteTime,
      })
      expect(prices.mezoUsd?.source, JSON.stringify(body)).toBe("aerodrome-cl")
    }
  })

  it("reuses a fresh cached CoinGecko reading instead of calling again", async () => {
    const { requests } = stubCoinGecko({ status: 200, body: coingeckoMezo }, {})
    const prices = await readReferencePrices({
      coingecko: keyless,
      mezoMainnetRpcUrl: null,
      baseRpcUrl: null,
      cachedMezoUsd: {
        usd: "0.0045",
        source: "coingecko",
        readAt: quoteTime - 60,
      },
      cacheMaxAgeSeconds: 90,
      nowSeconds: quoteTime,
    })
    expect(requests).toHaveLength(0)
    expect(prices).toEqual({
      btcUsd: null,
      mezoUsd: { usd: "0.0045", source: "coingecko" },
      mezoReadAt: quoteTime - 60,
    })
  })

  it("calls CoinGecko when the cache is old or is a fallback reading", async () => {
    for (const cached of [
      { usd: "0.0045", source: "coingecko", readAt: quoteTime - 90 },
      { usd: "0.0045", source: "aerodrome-cl", readAt: quoteTime - 10 },
    ] as const) {
      const { requests } = stubCoinGecko(
        { status: 200, body: coingeckoMezo },
        {},
      )
      const prices = await readReferencePrices({
        coingecko: keyless,
        mezoMainnetRpcUrl: null,
        baseRpcUrl: null,
        cachedMezoUsd: cached,
        cacheMaxAgeSeconds: 90,
        nowSeconds: quoteTime,
      })
      expect(requests, cached.source).toHaveLength(1)
      expect(prices.mezoUsd?.usd).toBe("0.00457132")
      expect(prices.mezoReadAt).toBeUndefined()
    }
  })

  it("offers only a CoinGecko reading from KV for reuse", () => {
    const kv = (source: "coingecko" | "aerodrome-cl") => ({
      btc: null,
      mezo: { usd: "0.0045", change24h: null, source, updatedAt: 100 },
    })
    expect(cachedMezoFromKv(kv("coingecko"))).toEqual({
      usd: "0.0045",
      source: "coingecko",
      readAt: 100,
    })
    expect(cachedMezoFromKv(kv("aerodrome-cl"))).toBeNull()
    expect(cachedMezoFromKv(null)).toBeNull()
  })
})
