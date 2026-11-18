import { afterEach, describe, expect, it, vi } from "vitest"
import { parseHeadMessage, pollMs, startHeads } from "./head-source"
import { createHeadStore } from "./heads"

afterEach(() => {
  vi.useRealTimers()
})

describe("head store", () => {
  it("only moves forward and notifies", () => {
    const store = createHeadStore({ number: 10, receivedAt: 0 })
    const listener = vi.fn()
    store.subscribe(listener)
    store.set(9)
    store.set(11, 5)
    expect(store.get()).toEqual({ number: 11, receivedAt: 5 })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe("head messages", () => {
  it("reads BlockHub and RPC shapes and rejects the rest", () => {
    expect(
      parseHeadMessage('{"type":"head","block":13078796,"timestamp":1}'),
    ).toBe(13_078_796)
    expect(parseHeadMessage('{"number":13078796}')).toBe(13_078_796)
    expect(parseHeadMessage({ result: "0xc7900c" })).toBe(13_078_540)
    expect(parseHeadMessage("not json")).toBeNull()
    expect(parseHeadMessage({ number: -1 })).toBeNull()
    expect(parseHeadMessage(null)).toBeNull()
  })
})

describe("head sources", () => {
  it("simulates a block every 3.8s in fixtures mode", () => {
    vi.useFakeTimers()
    const store = createHeadStore({ number: 100, receivedAt: 0 })
    const stop = startHeads({
      config: { mode: "simulated" },
      store,
      pollLatest: async () => 0,
    })
    vi.advanceTimersByTime(3800 * 3)
    expect(store.get().number).toBe(103)
    stop()
    vi.advanceTimersByTime(3800)
    expect(store.get().number).toBe(103)
  })

  it("falls back to polling the RPC when the socket closes", async () => {
    vi.useFakeTimers()
    const store = createHeadStore({ number: 100, receivedAt: 0 })
    const target = new EventTarget()
    const close = vi.fn()
    const fetcher = vi.fn(async () => new Response('{"result":"0x6e"}'))
    const stop = startHeads({
      config: { mode: "blockhub", rpcUrl: "https://rpc.example" },
      store,
      pollLatest: async () => 0,
      createSocket: (url) => {
        expect(url).toBe("wss://pro.example/live/heads")
        return Object.assign(target, { close }) as unknown as WebSocket
      },
      fetcher,
      location: { protocol: "https:", host: "pro.example" },
    })
    target.dispatchEvent(
      new MessageEvent("message", {
        data: '{"type":"head","block":105,"timestamp":1}',
      }),
    )
    expect(store.get().number).toBe(105)
    target.dispatchEvent(
      new MessageEvent("message", { data: '{"type":"stale","since":1}' }),
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(store.get().number).toBe(110)
    stop()
    expect(close).toHaveBeenCalled()
  })

  it("polls at most every 15s while the socket is down and stops once it is back", async () => {
    vi.useFakeTimers()
    const store = createHeadStore({ number: 100, receivedAt: 0 })
    const sockets: EventTarget[] = []
    let block = 110
    const fetcher = vi.fn(
      async () => new Response(`{"result":"0x${(block++).toString(16)}"}`),
    )
    const stop = startHeads({
      config: { mode: "blockhub", rpcUrl: "https://rpc.example" },
      store,
      pollLatest: async () => 0,
      createSocket: () => {
        const socket = Object.assign(new EventTarget(), { close: vi.fn() })
        sockets.push(socket)
        return socket as unknown as WebSocket
      },
      fetcher,
      location: { protocol: "https:", host: "pro.example" },
    })
    const first = sockets[0]
    first?.dispatchEvent(new Event("error"))
    first?.dispatchEvent(new Event("close"))
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledTimes(1)

    // The socket retries after 5s; it flaps, and polling does not speed up.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(sockets).toHaveLength(2)
    sockets[1]?.dispatchEvent(new Event("close"))
    await vi.advanceTimersByTimeAsync(pollMs - 5_000 - 1)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetcher).toHaveBeenCalledTimes(2)

    // Next retry waits 10s; a fresh head on it ends the polling.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(sockets).toHaveLength(3)
    sockets[2]?.dispatchEvent(
      new MessageEvent("message", {
        data: '{"type":"head","block":200,"timestamp":1}',
      }),
    )
    const calls = fetcher.mock.calls.length
    await vi.advanceTimersByTimeAsync(pollMs * 4)
    expect(fetcher).toHaveBeenCalledTimes(calls)
    expect(sockets).toHaveLength(3)
    expect(store.get().number).toBe(200)
    stop()
  })

  it("polls the market read model no faster when there is no RPC", async () => {
    vi.useFakeTimers()
    const store = createHeadStore({ number: 100, receivedAt: 0 })
    const pollLatest = vi.fn(async () => 120)
    const stop = startHeads({
      config: { mode: "blockhub", rpcUrl: null },
      store,
      pollLatest,
      createSocket: () => {
        throw new Error("no sockets")
      },
      location: { protocol: "https:", host: "pro.example" },
    })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(pollLatest.mock.calls.length).toBeLessThanOrEqual(
      1 + 60_000 / pollMs,
    )
    stop()
    const after = pollLatest.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(pollLatest).toHaveBeenCalledTimes(after)
  })

  it("keeps the rendered head for hydration as new blocks land", () => {
    const store = createHeadStore({ number: 7, receivedAt: 0 })
    store.set(9)
    expect(store.get().number).toBe(9)
    expect(store.initial().number).toBe(7)
  })
})
