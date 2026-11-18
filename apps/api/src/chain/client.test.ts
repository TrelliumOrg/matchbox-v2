import { afterEach, describe, expect, it, vi } from "vitest"
import { claimableDeadlineMs } from "../read-models/live-claimable"
import {
  createLiveLockReader,
  createLiveLocksReader,
} from "../read-models/live-locks"
import { scanLiveDeadlineMs } from "../scan/live-locks"
import { rejectedWithin } from "../test-timing"
import {
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
    // endpoint. The minute cron and wallet builds rely on this.
    const sent = hungEndpoints()
    const client = createMezoClient(["https://a.test"], 30)
    await expect(client.getBlockNumber()).rejects.toThrow()
    expect(sent).toHaveLength(8)
  }, 20_000)
})

describe("one live read against endpoints that never answer", () => {
  it("costs Matchscan one request, given up at its client's 1.2 s", async () => {
    const sent = hungEndpoints()
    const client = createMezoClient(["https://a.test"], scanReadTimeoutMs, 0)
    const read = createLiveLockReader(client, undefined, { attempts: 1 })
    // One request fits Matchscan's live deadline.
    expect(scanReadTimeoutMs).toBeLessThan(scanLiveDeadlineMs)
    // Given up by the client's timeout, before a timer 500 ms past it.
    await rejectedWithin(
      read("vebtc", "6179", Date.now() + scanLiveDeadlineMs),
      scanReadTimeoutMs + 500,
    )
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
    // Given up at the deadline, before a timer 500 ms past it.
    await rejectedWithin(
      read(`0x${"ab".repeat(20)}`, Date.now() + claimableDeadlineMs, {
        vebtc: 1,
        vemezo: 0,
      }),
      claimableDeadlineMs + 500,
    )
    // The first endpoint's 2 s, then the second's until the deadline.
    expect(sent).toEqual(["https://a.test/", "https://b.test/"])
  }, 10_000)
})
