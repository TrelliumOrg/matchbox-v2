import type { LiveConfig } from "./config"
import { blockTimeMs, type HeadBlock, type HeadStore } from "./heads"

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

function field(value: object, key: string): unknown {
  return key in value ? Reflect.get(value, key) : undefined
}

function nullableString(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null
}

/**
 * The block details in a BlockHub head message, checked field by field
 * (no zod here: this module loads in the browser). Null when the message is
 * not a head or its number or timestamp is not usable; a malformed extra
 * becomes null on its own.
 */
export function parseHeadBlock(raw: unknown): HeadBlock | null {
  let value: unknown = raw
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }
  if (typeof value !== "object" || value === null) return null
  if (field(value, "type") !== "head") return null
  const number = field(value, "block")
  const timestamp = field(value, "timestamp")
  if (
    typeof number !== "number" ||
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    return null
  }
  if (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp)) {
    return null
  }
  const count = field(value, "transactionCount")
  return {
    number,
    timestamp,
    hash: nullableString(field(value, "hash"), /^0x[0-9a-f]{64}$/),
    transactionCount:
      typeof count === "number" && Number.isSafeInteger(count) && count >= 0
        ? count
        : null,
    gasUsed: nullableString(field(value, "gasUsed"), /^(0|[1-9][0-9]*)$/),
    miner: nullableString(field(value, "miner"), /^0x[0-9a-f]{40}$/),
  }
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
  /** Whether the tab is hidden, and its changes. Injected for tests. */
  visibility?: Visibility
}

export type Visibility = {
  hidden: () => boolean
  onChange: (listener: () => void) => () => void
}

function documentVisibility(): Visibility {
  return {
    hidden: () =>
      typeof document !== "undefined" && document.visibilityState === "hidden",
    onChange(listener) {
      if (typeof document === "undefined") return () => {}
      document.addEventListener("visibilitychange", listener)
      return () => document.removeEventListener("visibilitychange", listener)
    },
  }
}

/** Polling while the socket is down: never more often than this. */
export const pollMs = 15_000
/** Polls back off from pollMs, doubling, to this. */
export const pollMaxMs = 120_000
/** Socket reconnects back off from 5s to a minute. */
export const reconnectMs = { first: 5_000, max: 60_000 } as const
/**
 * A socket that stays open but says nothing for this long is treated as
 * lost: BlockHub sends a head every block (about 3.8s on Mezo), and the
 * ticker already calls a head 30s old stale.
 */
export const silentMs = 30_000

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
  const visibility = options.visibility ?? documentVisibility()
  let stopped = false
  let socket: WebSocket | null = null
  let polling = false
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let pollDelay = pollMs
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectWanted = false
  let attempts = 0
  let lastPoll = Number.NEGATIVE_INFINITY
  let silenceTimer: ReturnType<typeof setTimeout> | null = null

  function clearSilence(): void {
    if (silenceTimer !== null) clearTimeout(silenceTimer)
    silenceTimer = null
  }

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

  /**
   * One slow poll at a time while the socket is down: every 15s at first,
   * doubling to every 2 minutes, however often the socket flaps, and none
   * while the tab is hidden (it resumes when the tab is seen again).
   */
  function schedulePoll(): void {
    if (pollTimer !== null) clearTimeout(pollTimer)
    pollTimer = null
    if (!polling || stopped || visibility.hidden()) return
    const due = lastPoll + pollDelay - Date.now()
    pollTimer = setTimeout(
      () => {
        pollTimer = null
        void pollOnce()
        pollDelay = Math.min(pollMaxMs, pollDelay * 2)
        schedulePoll()
      },
      Math.max(0, due),
    )
  }

  function startPolling(): void {
    if (polling || stopped) return
    polling = true
    if (!visibility.hidden() && Date.now() - lastPoll >= pollMs) {
      void pollOnce()
    }
    schedulePoll()
  }

  function stopPolling(): void {
    polling = false
    pollDelay = pollMs
    if (pollTimer === null) return
    clearTimeout(pollTimer)
    pollTimer = null
  }

  function scheduleReconnect(): void {
    if (reconnectTimer !== null || stopped) return
    // A hidden tab does not reconnect; it does when it is seen again.
    if (visibility.hidden()) {
      reconnectWanted = true
      return
    }
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
    // Open but silent: poll and reconnect, as if it had closed. A hidden
    // tab's timers are throttled, so the deadline waits until it is seen.
    const armSilence = (): void => {
      clearSilence()
      silenceTimer = setTimeout(() => {
        silenceTimer = null
        if (socket !== current || stopped) return
        if (visibility.hidden()) {
          armSilence()
          return
        }
        socket = null
        current.close()
        startPolling()
        scheduleReconnect()
      }, silentMs)
    }
    armSilence()
    current.addEventListener("message", (event: MessageEvent) => {
      if (socket === current) armSilence()
      if (isStaleMessage(event.data)) {
        startPolling()
        return
      }
      const number = parseHeadMessage(event.data)
      if (number === null) return
      // The socket is up and fresh: polling has nothing left to do.
      attempts = 0
      stopPolling()
      store.set(number, Date.now(), parseHeadBlock(event.data) ?? undefined)
    })
    const lost = (): void => {
      if (socket !== current) return
      clearSilence()
      socket = null
      startPolling()
      scheduleReconnect()
    }
    current.addEventListener("close", lost)
    current.addEventListener("error", lost)
  }

  const stopWatching = visibility.onChange(() => {
    if (stopped) return
    if (visibility.hidden()) {
      // Hidden: no polls and no reconnects until the tab is seen again.
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
        reconnectWanted = true
      }
      schedulePoll()
      return
    }
    if (reconnectWanted) {
      reconnectWanted = false
      scheduleReconnect()
    }
    if (polling && Date.now() - lastPoll >= pollMs) void pollOnce()
    schedulePoll()
  })

  connect()

  return () => {
    stopped = true
    clearSilence()
    stopWatching()
    socket?.close()
    socket = null
    stopPolling()
    if (reconnectTimer !== null) clearTimeout(reconnectTimer)
  }
}
