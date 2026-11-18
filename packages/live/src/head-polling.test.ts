import { afterEach, describe, expect, it, vi } from "vitest"
import {
  pollMaxMs,
  pollMs,
  reconnectMs,
  silentMs,
  startHeads,
  type Visibility,
} from "./head-source"
import { createHeadStore } from "./heads"

afterEach(() => vi.useRealTimers())

function fakeVisibility(): Visibility & { set: (hidden: boolean) => void } {
  let hidden = false
  const listeners = new Set<() => void>()
  return {
    hidden: () => hidden,
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      hidden = next
      for (const listener of listeners) listener()
    },
  }
}

/** A BlockHub socket that never connects. */
function deadSockets() {
  const sockets: EventTarget[] = []
  return {
    sockets,
    createSocket: () => {
      const socket = Object.assign(new EventTarget(), { close: vi.fn() })
      sockets.push(socket)
      queueMicrotask(() => socket.dispatchEvent(new Event("close")))
      return socket as unknown as WebSocket
    },
  }
}

describe("polling while the socket is down", () => {
  it("backs off from 15s to every 2 minutes", async () => {
    vi.useFakeTimers()
    const pollLatest = vi.fn(async () => 120)
    const stop = startHeads({
      config: { mode: "blockhub", rpcUrl: null },
      store: createHeadStore({ number: 100, receivedAt: 0 }),
      pollLatest,
      ...deadSockets(),
      visibility: fakeVisibility(),
      location: { protocol: "https:", host: "scan.example" },
    })
    await vi.advanceTimersByTimeAsync(0)
    const times: number[] = []
    let elapsed = 0
    while (elapsed < 10 * 60_000) {
      const before = pollLatest.mock.calls.length
      await vi.advanceTimersByTimeAsync(1_000)
      elapsed += 1_000
      if (pollLatest.mock.calls.length > before) times.push(elapsed)
    }
    const gaps = times.slice(1).map((at, index) => at - (times[index] ?? 0))
    expect(times[0]).toBe(pollMs)
    expect(gaps.slice(0, 3)).toEqual([2 * pollMs, 4 * pollMs, pollMaxMs])
    expect(Math.max(...gaps)).toBe(pollMaxMs)
    stop()
  })

  it("stops while the tab is hidden and resumes when it is seen", async () => {
    vi.useFakeTimers()
    const visibility = fakeVisibility()
    const pollLatest = vi.fn(async () => 120)
    const dead = deadSockets()
    const stop = startHeads({
      config: { mode: "blockhub", rpcUrl: null },
      store: createHeadStore({ number: 100, receivedAt: 0 }),
      pollLatest,
      ...dead,
      visibility,
      location: { protocol: "https:", host: "scan.example" },
    })
    await vi.advanceTimersByTimeAsync(0)
    visibility.set(true)
    const polls = pollLatest.mock.calls.length
    const sockets = dead.sockets.length
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(pollLatest).toHaveBeenCalledTimes(polls)
    expect(dead.sockets).toHaveLength(sockets)
    visibility.set(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(pollLatest.mock.calls.length).toBe(polls + 1)
    // And it tries the socket again.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(dead.sockets.length).toBeGreaterThan(sockets)
    stop()
  })
})

describe("a socket that is open but silent", () => {
  it("falls back to polling and reconnects after the deadline", async () => {
    vi.useFakeTimers()
    const pollLatest = vi.fn(async () => 120)
    const sockets: { close: ReturnType<typeof vi.fn> }[] = []
    const stop = startHeads({
      config: { mode: "blockhub", rpcUrl: null },
      store: createHeadStore({ number: 100, receivedAt: 0 }),
      pollLatest,
      // Connects, then never says a word.
      createSocket: () => {
        const socket = Object.assign(new EventTarget(), { close: vi.fn() })
        sockets.push(socket)
        return socket as unknown as WebSocket
      },
      visibility: fakeVisibility(),
      location: { protocol: "https:", host: "scan.example" },
    })
    await vi.advanceTimersByTimeAsync(silentMs - 1_000)
    expect(pollLatest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(pollLatest).toHaveBeenCalledTimes(1)
    expect(sockets[0]?.close).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(reconnectMs.first)
    expect(sockets).toHaveLength(2)
    stop()
  })

  it("keeps a socket that speaks, however long it stays open", async () => {
    vi.useFakeTimers()
    const pollLatest = vi.fn(async () => 120)
    const sockets: EventTarget[] = []
    const stop = startHeads({
      config: { mode: "blockhub", rpcUrl: null },
      store: createHeadStore({ number: 100, receivedAt: 0 }),
      pollLatest,
      createSocket: () => {
        const socket = Object.assign(new EventTarget(), { close: vi.fn() })
        sockets.push(socket)
        return socket as unknown as WebSocket
      },
      visibility: fakeVisibility(),
      location: { protocol: "https:", host: "scan.example" },
    })
    for (let block = 101; block < 140; block += 1) {
      await vi.advanceTimersByTimeAsync(4_000)
      sockets[0]?.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "head", block, timestamp: block }),
        }),
      )
    }
    expect(pollLatest).not.toHaveBeenCalled()
    expect(sockets).toHaveLength(1)
    stop()
  })
})
