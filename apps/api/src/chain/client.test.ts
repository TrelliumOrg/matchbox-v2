import { parseAbi } from "viem"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import {
  ClaimableUnread,
  claimableDeadlineMs,
} from "../read-models/live-claimable"
import {
  createLiveLockReader,
  createLiveLocksReader,
} from "../read-models/live-locks"
import { scanLiveDeadlineMs } from "../scan/live-locks"
import { settlement } from "../test-timing"
import {
  createLiveMezoClient,
  createMezoClient,
  liveReadTimeoutMs,
  scanReadTimeoutMs,
} from "./client"

/** Endpoints that never answer: each request ends only at its timeout. */
function hungEndpoints() {
  const sent: string[] = []
  vi.stubGlobal(
    "fetch",
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      sent.push(String(input instanceof Request ? input.url : input))
      return new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted", "AbortError")),
        )
      })
    },
  )
  return sent
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("a Mezo client against endpoints that never answer", () => {
  it("sends one request per endpoint when told not to retry", async () => {
    const sent = hungEndpoints()
    const client = createMezoClient(["https://a.test", "https://b.test"], 30, 0)
    await expect(client.getBlockNumber()).rejects.toThrow()
    expect(sent).toEqual(["https://a.test/", "https://b.test/"])
  })

  it("sends one request in all for one endpoint, as Matchscan's client has", async () => {
    const sent = hungEndpoints()
    const client = createMezoClient(["https://a.test"], 30, 0)
    await expect(client.getBlockNumber()).rejects.toThrow()
    expect(sent).toHaveLength(1)
  })

  it("keeps the retries it always had without a count", async () => {
    // One retry per endpoint, then the list three more times: 8 for one
    // endpoint. The minute cron and wallet builds rely on this. Fake timers
    // run the timeouts and viem's backoff between retries without waiting.
    vi.useFakeTimers()
    const sent = hungEndpoints()
    const client = createMezoClient(["https://a.test"], 30)
    const read = settlement(client.getBlockNumber())
    await vi.runAllTimersAsync()
    expect(read.settled).toBe(true)
    expect(read.error).toBeInstanceOf(Error)
    expect(sent).toHaveLength(8)
  })
})

// Fake timers: the readers' deadlines (read from Date.now()) and the
// client's request timeouts (setTimeout) then run on one clock that moves
// only when the test moves it, so each check is of the exact millisecond a
// read is given up, however busy the machine. On real timers the same
// checks failed on loaded CI runners.
describe("one live read against endpoints that never answer", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it("costs Matchscan one request, given up at its client's 1.2 s", async () => {
    const sent = hungEndpoints()
    const client = createMezoClient(["https://a.test"], scanReadTimeoutMs, 0)
    const read = createLiveLockReader(client, undefined, { attempts: 1 })
    // One request fits Matchscan's live deadline.
    expect(scanReadTimeoutMs).toBeLessThan(scanLiveDeadlineMs)
    const outcome = settlement(
      read("vebtc", "6179", Date.now() + scanLiveDeadlineMs),
    )
    // Still waiting a millisecond before the client's timeout...
    await vi.advanceTimersByTimeAsync(scanReadTimeoutMs - 1)
    expect(outcome.settled).toBe(false)
    // ...and given up by it, well before the deadline.
    await vi.advanceTimersByTimeAsync(1)
    expect(outcome.settled).toBe(true)
    expect(outcome.error).toBeInstanceOf(ClaimableUnread)
    expect(sent).toHaveLength(1)
  })

  it("costs Pro two requests across three endpoints, given up at 4 s", async () => {
    const sent = hungEndpoints()
    const client = createMezoClient(
      ["https://a.test", "https://b.test", "https://c.test"],
      liveReadTimeoutMs,
      0,
    )
    const read = createLiveLocksReader(client)
    const outcome = settlement(
      read(`0x${"ab".repeat(20)}`, Date.now() + claimableDeadlineMs, {
        vebtc: 1,
        vemezo: 0,
      }),
    )
    // The first endpoint's 2 s, then the second's until the deadline.
    await vi.advanceTimersByTimeAsync(claimableDeadlineMs - 1)
    expect(outcome.settled).toBe(false)
    expect(sent).toEqual(["https://a.test/", "https://b.test/"])
    // Given up at the deadline.
    await vi.advanceTimersByTimeAsync(1)
    expect(outcome.settled).toBe(true)
    expect(outcome.error).toBeInstanceOf(ClaimableUnread)
    // The client itself still moves on to the third endpoint when the
    // second's 2 s end, at that same moment: the read no longer waits for
    // it, but the request is sent and left to time out.
  })
})

describe("the live client's Multicall3 requests", () => {
  /** Answers every request with a JSON-RPC error; records the eth_calls. */
  function refusingEndpoint(): { calls: string[] } {
    const calls: string[] = []
    vi.stubGlobal(
      "fetch",
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = z
          .object({ id: z.number(), method: z.string() })
          .parse(JSON.parse(String(init?.body)))
        calls.push(body.method)
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32000, message: "refused" },
        })
      },
    )
    return { calls }
  }

  const multicall3 = "0xcA11bde05977b3631167028862bE2a173976CA11"
  const read = (client: ReturnType<typeof createMezoClient>) =>
    client.multicall({
      allowFailure: true,
      batchSize: 0,
      contracts: [
        {
          address: multicall3,
          abi: parseAbi(["function getBlockNumber() view returns (uint256)"]),
          functionName: "getBlockNumber",
        },
      ],
    })

  it("sends requests made side by side as requests of their own", async () => {
    const { calls } = refusingEndpoint()
    const client = createLiveMezoClient(["https://a.test"], 200)
    await Promise.all([read(client), read(client), read(client)])
    expect(calls).toEqual(["eth_call", "eth_call", "eth_call"])
  })

  it("is not what the batching client does, which packs them into one", async () => {
    const { calls } = refusingEndpoint()
    const client = createMezoClient(["https://a.test"], 200, 0)
    await Promise.all([read(client), read(client), read(client)])
    expect(calls).toEqual(["eth_call"])
  })
})
