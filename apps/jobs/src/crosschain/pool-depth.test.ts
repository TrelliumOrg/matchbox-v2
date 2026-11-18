import { createLogger, type LogLevel } from "@matchbox/logger"
import { describe, expect, it } from "vitest"
import recorded from "../../test/fixtures/coingecko-onchain-pools.json"
import { fetchPoolInputs, poolRows } from "./pools"
import {
  keyedPoolsThisRun,
  keylessPools,
  type PoolSchedule,
  partKey,
  periodStart,
} from "./run"
import {
  coingeckoOnchainPools,
  type KeyedCoinGecko,
  onchainPoolsRequest,
} from "./sources"

// A made-up key: the tests check it never reaches a URL or a log line.
const key = "CG-test-key-0123456789"
const demo: KeyedCoinGecko = { apiKey: key, plan: "demo" }

type Call = { url: string; headers: Record<string, string> }

function headersOf(init?: RequestInit): Record<string, string> {
  return Object.fromEntries(new Headers(init?.headers).entries())
}

/** Answers pools/multi on either host with every address it was asked. */
function poolsAnswer(url: string): Response {
  const addresses = url.split("/pools/multi/")[1]?.split(",") ?? []
  return Response.json({
    data: addresses.map((address) => ({
      attributes: {
        address,
        reserve_in_usd: "1000.5",
        volume_usd: { h24: "250.25" },
      },
    })),
  })
}

/** A fetcher that logs each call; `fail` picks the URLs that get a 429. */
function fakeFetch(
  calls: Call[],
  fail: (url: string) => boolean = () => false,
) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, headers: headersOf(init) })
    if (fail(url)) return new Response("Too Many Requests", { status: 429 })
    if (url.includes("/pools/multi/")) return poolsAnswer(url)
    // DefiLlama, Curve and Merkl are not under test here.
    return new Response("unavailable", { status: 503 })
  }
}

function capture(): {
  lines: string[]
  logger: ReturnType<typeof createLogger>
} {
  const lines: string[] = []
  const logger = createLogger({
    level: "debug",
    format: "json",
    sink: (_level: LogLevel, line: string) => lines.push(line),
  })
  return { lines, logger }
}

const keyed = (call: Call) => call.url.includes("api.coingecko.com")
const keyless = (call: Call) => call.url.includes("api.geckoterminal.com")

describe("CoinGecko onchain pool depth", () => {
  it("parses the recorded answer and the documented example", async () => {
    const calls: Call[] = []
    const pools = await coingeckoOnchainPools(
      async (url, init) => {
        calls.push({ url, headers: headersOf(init) })
        return Response.json(recorded.recorded)
      },
      recorded.network,
      recorded.addresses,
      demo,
      { remaining: 3 },
    )
    expect(calls).toHaveLength(1)
    expect(pools.size).toBe(4)
    expect(pools.get("0xb02fda984eddff593202ed2b5a6de043b9b62ea5")).toEqual({
      tvlUsd: "823783.4422",
      volume24hUsd: "45592.5238923012",
      source: "coingecko",
    })
    const documented = await coingeckoOnchainPools(
      async () => Response.json(recorded.documented),
      "solana",
      ["E6RbuozUjZshXH3sRKgCaoXPzfc7EMFiyu4HRxf6ERrH"],
      demo,
      { remaining: 1 },
    )
    expect(
      documented.get("e6rbuozujzshxh3srkgcaoxpzfc7emfiyu4hrxf6errh"),
    ).toEqual({
      tvlUsd: "13843.8176",
      volume24hUsd: "0.0",
      source: "coingecko",
    })
  })

  it("puts the key in the plan's header, never in the URL", () => {
    const demoRequest = onchainPoolsRequest("base", ["0xabc", "0xdef"], demo)
    expect(demoRequest.url).toBe(
      "https://api.coingecko.com/api/v3/onchain/networks/base/pools/multi/0xabc,0xdef",
    )
    expect(demoRequest.headers["x-cg-demo-api-key"]).toBe(key)
    const proRequest = onchainPoolsRequest("eth", ["0xabc"], {
      apiKey: key,
      plan: "pro",
    })
    expect(proRequest.url.startsWith("https://pro-api.coingecko.com/")).toBe(
      true,
    )
    expect(proRequest.headers["x-cg-pro-api-key"]).toBe(key)
    for (const request of [demoRequest, proRequest]) {
      expect(request.url).not.toContain(key)
    }
  })

  it("stops before a call the allowance has no room for", async () => {
    const calls: Call[] = []
    await expect(
      coingeckoOnchainPools(fakeFetch(calls), "base", ["0xabc"], demo, {
        remaining: 0,
      }),
    ).rejects.toThrow("coingecko-onchain: Per-run call cap reached")
    expect(calls).toHaveLength(0)
  })
})

describe("pool depth fallback", () => {
  it("reads keyless only, as before, without a key", async () => {
    const calls: Call[] = []
    const inputs = await fetchPoolInputs(fakeFetch(calls), capture().logger)
    expect(calls.some(keyed)).toBe(false)
    expect(calls.filter(keyless)).toHaveLength(3)
    expect([...inputs.gecko.keys()]).toEqual(["mezo", "ethereum", "base"])
  })

  it("reads keyed first, one call a chain, and GeckoTerminal not at all", async () => {
    const calls: Call[] = []
    const inputs = await fetchPoolInputs(fakeFetch(calls), capture().logger, {
      keyed: demo,
    })
    expect(calls.filter(keyed)).toHaveLength(3)
    expect(calls.some(keyless)).toBe(false)
    const rows = poolRows(inputs, "2026-11-12", 1)
    const aero = rows.find((row) => row.pool_id === "base-aerodrome-musd-usdc")
    expect(JSON.parse(String(aero?.sources))).toMatchObject({
      tvl_usd: "coingecko",
      volume_24h_usd: "coingecko",
    })
  })

  it("tries GeckoTerminal after a keyed 429, for that chain only", async () => {
    const calls: Call[] = []
    const { lines, logger } = capture()
    const inputs = await fetchPoolInputs(
      fakeFetch(
        calls,
        (url) => url.includes("api.coingecko.com") && url.includes("/base/"),
      ),
      logger,
      { keyed: demo },
    )
    const order = calls
      .filter((call) => keyed(call) || keyless(call))
      .map(
        (call) =>
          `${keyed(call) ? "keyed" : "keyless"}:${call.url.split("/networks/")[1]?.split("/")[0]}`,
      )
    expect(order).toEqual([
      "keyed:mezo",
      "keyed:eth",
      "keyed:base",
      "keyless:base",
    ])
    expect(inputs.failed.has("depth:base")).toBe(false)
    const warning = lines.find((line) => line.includes("coingecko-onchain"))
    expect(warning).toContain("HTTP 429")
    const rows = poolRows(inputs, "2026-11-12", 1)
    const aero = rows.find((row) => row.pool_id === "base-aerodrome-musd-usdc")
    expect(JSON.parse(String(aero?.sources)).tvl_usd).toBe("geckoterminal")
  })

  it("marks a chain failed, never zero, when both sources fail", async () => {
    const calls: Call[] = []
    const { lines, logger } = capture()
    const inputs = await fetchPoolInputs(
      fakeFetch(calls, (url) => url.includes("/networks/base/")),
      logger,
      { keyed: demo },
    )
    expect(inputs.failed.has("depth:base")).toBe(true)
    const rows = poolRows(inputs, "2026-11-12", 1)
    expect(rows.some((row) => String(row.pool_id).startsWith("base-"))).toBe(
      false,
    )
    expect(rows.some((row) => String(row.pool_id).startsWith("mezo-"))).toBe(
      true,
    )
    const warnings = lines.filter((line) => line.includes("Pool depth"))
    expect(warnings.map((line) => JSON.parse(line).source)).toEqual([
      "coingecko-onchain",
      "geckoterminal",
    ])
    for (const line of warnings) {
      expect(line).not.toContain("http")
      expect(line).not.toContain("?")
    }
  })

  it("never logs the key or sends it in a URL", async () => {
    const calls: Call[] = []
    const { lines, logger } = capture()
    await fetchPoolInputs(
      async (url, init) => {
        calls.push({ url, headers: headersOf(init) })
        // A failure whose message quotes the key back.
        if (url.includes("api.coingecko.com")) {
          throw new Error(`fetch failed for header ${key}`)
        }
        return fakeFetch([])(url, init)
      },
      logger,
      { keyed: demo },
    )
    expect(lines.some((line) => line.includes("[key]"))).toBe(true)
    for (const line of lines) expect(line).not.toContain(key)
    for (const call of calls) expect(call.url).not.toContain(key)
    expect(
      calls
        .filter(keyed)
        .every((call) => call.headers["x-cg-demo-api-key"] === key),
    ).toBe(true)
    expect(
      calls
        .filter(keyless)
        .some((call) => JSON.stringify(call.headers).includes(key)),
    ).toBe(false)
  })

  it("makes at most the allowed keyed calls in one run", async () => {
    const calls: Call[] = []
    const inputs = await fetchPoolInputs(fakeFetch(calls), capture().logger, {
      keyed: demo,
      maxKeyedCalls: 1,
    })
    expect(calls.filter(keyed)).toHaveLength(1)
    expect(calls.filter(keyless)).toHaveLength(2)
    // Only DefiLlama, Curve and Merkl fail here (503); depth never does.
    expect([...inputs.failed].some((name) => name.startsWith("depth:"))).toBe(
      false,
    )
    const more = await fetchPoolInputs(fakeFetch([]), capture().logger, {
      keyed: demo,
      maxKeyedCalls: 99,
    })
    expect(more.gecko.size).toBe(3)
  })
})

describe("pool schedule", () => {
  const schedule: PoolSchedule = { keyed: demo, everyHours: 2 }
  const at = (hour: number, minute: number, second = 0) =>
    Date.UTC(2026, 10, 12, hour, minute, second) / 1000

  it("spends keyed calls only in a period's first five minutes", () => {
    expect(keyedPoolsThisRun(schedule, at(14, 0, 3))).toBe(demo)
    expect(keyedPoolsThisRun(schedule, at(14, 4, 59))).toBe(demo)
    expect(keyedPoolsThisRun(schedule, at(14, 5))).toBeNull()
    expect(keyedPoolsThisRun(schedule, at(15, 0))).toBeNull()
    expect(keyedPoolsThisRun(schedule, at(16, 0, 1))).toBe(demo)
    expect(keyedPoolsThisRun(keylessPools, at(14, 0))).toBeNull()
  })

  it("keys the pool marker by period and the other parts by hour", () => {
    expect(periodStart(at(15, 20), 2)).toBe(at(14, 0))
    expect(partKey("pools", at(15, 20), schedule)).toBe("2026-11-12T14")
    expect(partKey("supply", at(15, 20), schedule)).toBe("2026-11-12T15")
    expect(partKey("pools", at(15, 20), keylessPools)).toBe("2026-11-12T15")
  })
})
