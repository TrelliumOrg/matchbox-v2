import type { LiveConfig } from "../data/inputs.server"
import { blockTimeMs, type HeadStore } from "./heads"

/**
 * Feeds the head store. Sources, in order: the BlockHub WebSocket behind
 * `/live/heads`; while it is down or stale, polling at most every 15s (Mezo
 * RPC `eth_blockNumber`, or the market read model) and reconnecting with
 * backoff, polling stopping at the socket's first fresh head; or a
 * simulated head in fixtures mode. Loaded when the page is idle.
 */

/** Reads `{ "number": 13078796 }` (or a hex `result`) without trusting it. */
/** BlockHub's `{ type: "stale" }`: its upstream failed, so poll instead. */
export function isStaleMessage(raw: unknown): boolean {
  return typeof raw === "string" && raw.includes('"type":"stale"')
}

export function parseHeadMessage(raw: unknown): number | null {
  let value: unknown = raw
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }
  if (typeof value !== "object" || value === null) return null
  // BlockHub: { type: "head", block, timestamp } (see headMessageSchema).
  if (
    "type" in value &&
    value.type === "head" &&
    "block" in value &&
    typeof value.block === "number"
  ) {
    return Number.isSafeInteger(value.block) && value.block > 0
      ? value.block
      : null
  }
  if ("number" in value && typeof value.number === "number") {
    return Number.isSafeInteger(value.number) && value.number > 0
      ? value.number
      : null
  }
  if ("result" in value && typeof value.result === "string") {
    const parsed = Number.parseInt(value.result, 16)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
  }
  return null
}

export type HeadSourceOptions = {
  config: LiveConfig
  store: HeadStore
  /** Fallback poll when there is no RPC URL: returns the latest block. */
  pollLatest: () => Promise<number>
  /** Injected for tests. */
  createSocket?: (url: string) => WebSocket
  fetcher?: typeof fetch
  location?: Pick<Location, "protocol" | "host">
}

/** Polling while the socket is down: never more often than this. */
export const pollMs = 15_000
/** Socket reconnects back off from 5s to a minute. */
export const reconnectMs = { first: 5_000, max: 60_000 } as const

/** Starts following heads. Returns a stop function. */
export function startHeads(options: HeadSourceOptions): () => void {
  const { config, store } = options

  if (config.mode === "simulated") {
    const timer = setInterval(
      () => store.set(store.get().number + 1),
      blockTimeMs,
    )
    return () => clearInterval(timer)
  }

  const rpcUrl = config.rpcUrl
  const fetcher = options.fetcher ?? fetch
  let stopped = false
  let socket: WebSocket | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let attempts = 0
  let lastPoll = Number.NEGATIVE_INFINITY

  async function pollOnce(): Promise<void> {
    lastPoll = Date.now()
    try {
      if (rpcUrl === null) {
        store.set(await options.pollLatest())
        return
      }
      const response = await fetcher(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_blockNumber",
          params: [],
        }),
      })
      const number = parseHeadMessage(await response.text())
      if (number !== null) store.set(number)
    } catch {
      // The ticker goes stale after 30s without a block; nothing else to do.
    }
  }

  /** Polls every 15s at most, however often the socket flaps. */
  function startPolling(): void {
    if (pollTimer !== null || stopped) return
    if (Date.now() - lastPoll >= pollMs) void pollOnce()
    pollTimer = setInterval(() => void pollOnce(), pollMs)
  }

  function stopPolling(): void {
    if (pollTimer === null) return
    clearInterval(pollTimer)
    pollTimer = null
  }

  function scheduleReconnect(): void {
    if (reconnectTimer !== null || stopped) return
    const delay = Math.min(
      reconnectMs.max,
      reconnectMs.first * 2 ** Math.min(attempts, 8),
    )
    attempts += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  const where = options.location ?? window.location
  const url = `${where.protocol === "https:" ? "wss:" : "ws:"}//${where.host}/live/heads`

  function connect(): void {
    if (stopped) return
    let current: WebSocket
    try {
      current = (options.createSocket ?? ((target) => new WebSocket(target)))(
        url,
      )
    } catch {
      startPolling()
      scheduleReconnect()
      return
    }
    socket = current
    current.addEventListener("message", (event: MessageEvent) => {
      if (isStaleMessage(event.data)) {
        startPolling()
        return
      }
      const number = parseHeadMessage(event.data)
      if (number === null) return
      // The socket is up and fresh: polling has nothing left to do.
      attempts = 0
      stopPolling()
      store.set(number)
    })
    const lost = (): void => {
      if (socket !== current) return
      socket = null
      startPolling()
      scheduleReconnect()
    }
    current.addEventListener("close", lost)
    current.addEventListener("error", lost)
  }

  connect()

  return () => {
    stopped = true
    socket?.close()
    socket = null
    stopPolling()
    if (reconnectTimer !== null) clearTimeout(reconnectTimer)
  }
}
