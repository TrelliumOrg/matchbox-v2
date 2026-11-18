import type { PublicClient } from "viem"
import { describe, expect, it } from "vitest"
import {
  createWalletChainReader,
  earnedCallsPerRequest,
  earnedKey,
  gentlePace,
  inTurn,
  requestsInFlight,
  retryPauseMs,
  retryRounds,
  rewardTokenSlots,
  viewCallsPerRequest,
} from "./chain"

const zero = "0x0000000000000000000000000000000000000000"
const pool = "0xb4d498029af77680cd1ef828b967f010d06c51cc"
const gauge = "0x677817bF3e44b90E8F95222F75e2950b7904a401"
const bribe = "0x7D98F38a020a94b08EeC295BFb6f4E86d581e607"
const fees = "0x33b8B1162F0b86d68CAd418D96246Ee2c5164a01"
const musd = "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186"

type Call = { functionName: string; args?: readonly unknown[] }
type Result =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: Error }

/**
 * A client whose multicall answers each call with `answer`, and loses the
 * whole request (as a dropped RPC request does) whenever `lose` says so.
 */
function client(
  answer: (call: Call) => unknown,
  lose: (request: number, calls: readonly Call[]) => boolean = () => false,
) {
  const requests: Call[][] = []
  const fake = {
    async multicall(input: { contracts: readonly Call[]; batchSize?: number }) {
      const request = requests.length
      requests.push([...input.contracts])
      if (lose(request, input.contracts)) throw new Error("HTTP request failed")
      return input.contracts.map((call): Result => {
        const result = answer(call)
        return result === undefined
          ? { status: "failure", error: new Error("reverted") }
          : { status: "success", result }
      })
    },
  }
  // No real pauses: the retry's wait is recorded and resolves at once.
  const waits: number[] = []
  const clock = { now: 0 }
  const reader = createWalletChainReader(
    fake as unknown as PublicClient,
    undefined,
    {
      wait: async (ms) => {
        waits.push(ms)
        clock.now += ms
      },
      now: () => clock.now,
    },
  )
  return { reader, requests, waits, clock }
}

const names = (requests: readonly Call[][]): string[][] =>
  requests.map((calls) => calls.map((call) => call.functionName))

describe("reads that fail", () => {
  it("asks once more for a lost request, and then has the answer", async () => {
    // The first request is lost; the second try gets through.
    const { reader, requests } = client(
      (call) => (call.functionName === "gaugeToBribe" ? bribe : fees),
      (request) => request === 0,
    )
    const read = await reader.rewardContracts([{ gauge, voter: "pools" }])
    expect(read).toEqual({
      contracts: [
        { gauge: gauge.toLowerCase(), rewardContract: bribe.toLowerCase() },
        { gauge: gauge.toLowerCase(), rewardContract: fees.toLowerCase() },
      ],
      failed: [],
    })
    expect(names(requests)).toEqual([
      ["gaugeToBribe", "gaugeToFees"],
      ["gaugeToBribe", "gaugeToFees"],
    ])
  })

  it("reports what failed twice instead of calling it empty", async () => {
    const lost = client(
      () => bribe,
      () => true,
    )
    expect(
      await lost.reader.rewardContracts([{ gauge, voter: "pools" }]),
    ).toEqual({ contracts: [], failed: [gauge.toLowerCase()] })
    expect(await lost.reader.poolGauges([pool])).toEqual({
      gauges: new Map(),
      failed: [pool],
    })
    expect(await lost.reader.rewardTokens([fees])).toEqual({
      tokens: new Map(),
      failed: [fees.toLowerCase()],
      truncated: [],
    })
    const request = { rewardContract: fees, token: musd, tokenId: "848" }
    expect(await lost.reader.earned([request])).toEqual({
      earned: new Map(),
      failed: [request],
    })
  })

  it("retries only the calls that failed", async () => {
    // Two requests of 400 and 100 getters; the second is lost once.
    const pools = Array.from(
      { length: viewCallsPerRequest + 100 },
      (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}`,
    )
    const { reader, requests } = client(
      () => gauge,
      (request) => request === 1,
    )
    const read = await reader.poolGauges(pools)
    expect(read.failed).toEqual([])
    expect(read.gauges.size).toBe(pools.length)
    // The retry asks for the lost 100 again, five to a request.
    const sizes = requests.map((calls) => calls.length)
    expect(sizes.slice(0, 2)).toEqual([viewCallsPerRequest, 100])
    expect(sizes.slice(2)).toEqual(Array.from({ length: 20 }, () => 5))
  })

  it("takes the zero address as an answer, not a failure", async () => {
    const { reader } = client(() => zero)
    // Not a pool with a gauge; a validator gauge has no fee contract.
    expect(await reader.poolGauges([pool])).toEqual({
      gauges: new Map(),
      failed: [],
    })
    expect(await reader.rewardContracts([{ gauge, voter: "pools" }])).toEqual({
      contracts: [],
      failed: [],
    })
  })

  it("does not keep half a token list", async () => {
    // The list has two tokens; the second slot's read fails twice.
    const { reader } = client((call) => {
      if (call.functionName === "rewardsListLength") return 2n
      return call.args?.[0] === 0n ? musd : undefined
    })
    expect(await reader.rewardTokens([fees])).toEqual({
      tokens: new Map(),
      failed: [fees.toLowerCase()],
      truncated: [],
    })
  })

  it("reads an empty token list as empty, and says when one is cut short", async () => {
    const empty = client(() => 0n)
    expect(await empty.reader.rewardTokens([fees])).toEqual({
      tokens: new Map([[fees.toLowerCase(), []]]),
      failed: [],
      truncated: [],
    })
    const long = client((call) =>
      call.functionName === "rewardsListLength"
        ? BigInt(rewardTokenSlots + 3)
        : musd,
    )
    const read = await long.reader.rewardTokens([fees])
    expect(read.truncated).toEqual([fees.toLowerCase()])
    expect(read.tokens.get(fees.toLowerCase())).toHaveLength(rewardTokenSlots)
  })
})

describe("requests per read", () => {
  it("sends getters 400 to a request and earned 10", async () => {
    const getters = client(() => gauge)
    await getters.reader.poolGauges(
      Array.from(
        { length: 830 },
        (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}`,
      ),
    )
    expect(getters.requests.map((calls) => calls.length)).toEqual([
      400, 400, 30,
    ])

    const earned = client(() => 5n)
    const requests = Array.from({ length: 95 }, (_, index) => ({
      rewardContract: fees,
      token: musd,
      tokenId: `${index + 1}`,
    }))
    const read = await earned.reader.earned(requests)
    expect(earned.requests.map((calls) => calls.length)).toEqual([
      ...Array.from({ length: 9 }, () => earnedCallsPerRequest),
      5,
    ])
    expect(
      read.earned.get(
        earnedKey({ rewardContract: fees, token: musd, tokenId: "1" }),
      ),
    ).toBe(5n)
    expect(read.earned.size).toBe(95)
  })

  it("drops zero amounts, which are answers", async () => {
    const { reader } = client(() => 0n)
    const request = { rewardContract: fees, token: musd, tokenId: "848" }
    expect(await reader.earned([request])).toEqual({
      earned: new Map(),
      failed: [],
    })
  })
})

describe("requests in flight", () => {
  it("keeps at most six RPC requests open, and the answers in order", async () => {
    let open = 0
    let most = 0
    const results = await inTurn(
      Array.from({ length: 50 }, (_, index) => index),
      requestsInFlight,
      async (item) => {
        open += 1
        most = Math.max(most, open)
        await new Promise((resolve) => setTimeout(resolve, item % 3))
        open -= 1
        return item * 2
      },
    )
    expect(most).toBe(requestsInFlight)
    expect(results).toEqual(Array.from({ length: 50 }, (_, index) => index * 2))
    expect(await inTurn([], requestsInFlight, async () => 1)).toEqual([])
  })

  it("sends a read's requests six at a time, not all together", async () => {
    let open = 0
    let most = 0
    const fake = {
      async multicall(input: { contracts: readonly unknown[] }) {
        open += 1
        most = Math.max(most, open)
        await new Promise((resolve) => setTimeout(resolve, 1))
        open -= 1
        return input.contracts.map(() => ({ status: "success", result: 5n }))
      },
    }
    const reader = createWalletChainReader(fake as unknown as PublicClient)
    // 2,000 earned calls: 50 requests.
    const read = await reader.earned(
      Array.from({ length: 2_000 }, (_, index) => ({
        rewardContract: fees,
        token: musd,
        tokenId: `${index + 1}`,
      })),
    )
    expect(read.earned.size).toBe(2_000)
    expect(read.failed).toEqual([])
    expect(most).toBe(requestsInFlight)
  })
})

describe("a throttled RPC", () => {
  const request = { rewardContract: fees, token: musd, tokenId: "848" }

  it("is left alone for a moment, then asked again, twice at most", async () => {
    // Lost twice, then it answers.
    const { reader, requests, waits } = client(
      () => 7n,
      (index) => index < 2,
    )
    const read = await reader.earned([request])
    expect(read).toEqual({
      earned: new Map([[earnedKey(request), 7n]]),
      failed: [],
    })
    expect(requests).toHaveLength(3)
    // A longer pause before the second retry.
    expect(waits).toEqual([retryPauseMs, retryPauseMs * 2])
  })

  it("gives up after the retries and says the call is unread", async () => {
    const { reader, requests, waits } = client(
      () => 7n,
      () => true,
    )
    expect(await reader.earned([request])).toEqual({
      earned: new Map(),
      failed: [request],
    })
    expect(requests).toHaveLength(1 + retryRounds)
    expect(waits).toHaveLength(retryRounds)
  })

  it("starts nothing past the deadline, and leaves what is left unread", async () => {
    const { reader, requests, waits } = client(
      () => 7n,
      () => true,
    )
    // The first pause would already end at the deadline.
    const read = await reader.earned([request], { deadline: retryPauseMs })
    expect(read.failed).toEqual([request])
    expect(requests).toHaveLength(1)
    expect(waits).toEqual([])
    // Already past it: not even the first request goes out.
    const late = client(() => 7n)
    late.clock.now = 5_000
    expect(
      (await late.reader.earned([request], { deadline: 4_000 })).failed,
    ).toEqual([request])
    expect(late.requests).toHaveLength(0)
  })

  it("asks one request at a time when told to be gentle", async () => {
    let open = 0
    let most = 0
    const fake = {
      async multicall(input: { contracts: readonly unknown[] }) {
        open += 1
        most = Math.max(most, open)
        await new Promise((resolve) => setTimeout(resolve, 1))
        open -= 1
        return input.contracts.map(() => ({ status: "success", result: 5n }))
      },
    }
    const reader = createWalletChainReader(fake as unknown as PublicClient)
    const many = Array.from({ length: 60 }, (_, index) => ({
      ...request,
      tokenId: `${index + 1}`,
    }))
    await reader.earned(many, { pace: gentlePace })
    expect(most).toBe(1)
  })

  it("tells an endpoint that cannot serve the call from a lost request, and keeps no URL", async () => {
    // What one public fallback answers a Multicall3 eth_call with.
    const refused = Object.assign(new Error("Missing or invalid parameters."), {
      name: "ContractFunctionExecutionError",
      shortMessage: "Missing or invalid parameters.",
      // As viem's multicall hands it back: no code on the outer error.
      cause: {
        name: "CallExecutionError",
        message:
          "Missing or invalid parameters.\nURL: https://rpc.example/key-123\nRequest body: {}",
      },
    })
    let index = 0
    const fake = {
      async multicall(input: { contracts: readonly unknown[] }) {
        index += 1
        if (index === 1) throw refused
        if (index === 2)
          throw new Error(
            "HTTP request failed.\nURL: https://rpc.example/key-123",
          )
        return input.contracts.map(() => ({ status: "success", result: 5n }))
      },
    }
    const reader = createWalletChainReader(
      fake as unknown as PublicClient,
      undefined,
      { wait: async () => {}, now: () => 0 },
    )
    // Refused is not final: the call is asked again and answers.
    const read = await reader.earned([request])
    expect(read.failed).toEqual([])
    const found = reader.diagnostics()
    expect(found.rejectedRequests).toBe(1)
    expect(found.lostRequests).toBe(1)
    expect(found.errors).toEqual([
      "ContractFunctionExecutionError: Missing or invalid parameters.",
      "Error: HTTP request failed.",
    ])
    expect(JSON.stringify(found)).not.toContain("key-123")
    // Reading it clears it.
    expect(reader.diagnostics()).toEqual({
      rejectedRequests: 0,
      lostRequests: 0,
      errors: [],
    })
  })
})
