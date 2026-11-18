import { describe, expect, it } from "vitest"
import { type Fetcher, HeadPoller, staleAfterMs } from "./poller"

type FakeRpc = { block: number; timestamp: number; down: boolean }

/** A JSON-RPC endpoint answering eth_getBlockByNumber from `state`. */
function fakeRpc(state: FakeRpc): Fetcher {
  return async function answer(_input, init) {
    if (state.down) return new Response("bad gateway", { status: 502 })
    const body: unknown = JSON.parse(String(init.body))
    expect(body).toMatchObject({ method: "eth_getBlockByNumber" })
    return Response.json({
      jsonrpc: "2.0",
      id: 1,
      result: {
        number: `0x${state.block.toString(16)}`,
        timestamp: `0x${state.timestamp.toString(16)}`,
      },
    })
  }
}

/** An RPC block without the explorer fields reads them as null. */
const noExtras = {
  hash: null,
  transactionCount: null,
  gasUsed: null,
  miner: null,
}

function router(routes: Record<string, Fetcher>): Fetcher {
  return (input, init) => {
    const route = routes[input]
    if (route === undefined) throw new Error(`No route for ${input}`)
    return route(input, init)
  }
}

describe("HeadPoller", () => {
  it("reports new heads and repeats", async () => {
    const state = { block: 13_078_795, timestamp: 1_794_138_780, down: false }
    const poller = new HeadPoller({
      urls: ["https://a"],
      fetch: router({ "https://a": fakeRpc(state) }),
    })
    expect(await poller.poll(0)).toEqual({
      kind: "new",
      head: { block: 13_078_795, timestamp: 1_794_138_780, ...noExtras },
    })
    expect((await poller.poll(1_000)).kind).toBe("same")
    state.block += 1
    state.timestamp += 4
    expect(await poller.poll(2_000)).toEqual({
      kind: "new",
      head: { block: 13_078_796, timestamp: 1_794_138_784, ...noExtras },
    })
  })

  it("falls back in order and never steps backwards", async () => {
    const primary = { block: 100, timestamp: 1, down: true }
    const lagging = { block: 90, timestamp: 1, down: false }
    const poller = new HeadPoller({
      urls: ["https://primary", "https://fallback"],
      fetch: router({
        "https://primary": fakeRpc(primary),
        "https://fallback": fakeRpc(lagging),
      }),
    })
    expect(await poller.poll(0)).toMatchObject({ head: { block: 90 } })
    primary.down = false
    expect(await poller.poll(1_000)).toMatchObject({
      kind: "new",
      head: { block: 100 },
    })
    primary.down = true
    expect(await poller.poll(2_000)).toEqual({
      kind: "same",
      head: { block: 100, timestamp: 1, ...noExtras },
    })
  })

  it("turns stale after every endpoint fails for 30s", async () => {
    const state = { block: 1, timestamp: 1, down: true }
    const poller = new HeadPoller({
      urls: ["https://a"],
      fetch: router({ "https://a": fakeRpc(state) }),
    })
    expect(await poller.poll(10_000)).toEqual({
      kind: "failed",
      stale: false,
      since: 10,
    })
    expect(await poller.poll(10_000 + staleAfterMs)).toEqual({
      kind: "failed",
      stale: true,
      since: 10,
    })
    state.down = false
    expect((await poller.poll(50_000)).kind).toBe("new")
  })

  it("reads the explorer fields when the block carries them", async () => {
    const hash = `0x${"AB".repeat(32)}`
    const poller = new HeadPoller({
      urls: ["https://a"],
      fetch: async () =>
        Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: {
            number: "0xc82d40",
            timestamp: "0x6a1b2c3d",
            hash,
            gasUsed: "0x2e083",
            miner: "0xD7fb1De0a4C2ffE5474E003656302A3f3A388A8a",
            transactions: [`0x${"1".repeat(64)}`, `0x${"2".repeat(64)}`],
          },
        }),
    })
    expect(await poller.poll(0)).toEqual({
      kind: "new",
      head: {
        block: 13_118_784,
        timestamp: 0x6a1b2c3d,
        hash: hash.toLowerCase(),
        transactionCount: 2,
        gasUsed: "188547",
        miner: "0xd7fb1de0a4c2ffe5474e003656302a3f3a388a8a",
      },
    })
  })

  it("honours a custom stale threshold", async () => {
    const poller = new HeadPoller({
      urls: ["https://a"],
      fetch: async () => new Response("down", { status: 502 }),
      staleAfterMs: 500,
    })
    expect(await poller.poll(1_000)).toMatchObject({ stale: false })
    expect(poller.isStale(1_499)).toBe(false)
    expect(await poller.poll(1_500)).toMatchObject({ stale: true, since: 1 })
    expect(poller.failingSinceSeconds).toBe(1)
  })
})
