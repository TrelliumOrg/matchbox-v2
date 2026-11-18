import { DurableObject } from "cloudflare:workers"
import {
  type BlockHead,
  type BlockHeadMessage,
  blockHeadSchema,
} from "@matchbox/contracts/scan"
import { logger } from "@matchbox/logger"
import { z } from "zod"
import {
  defaultHeadRpcUrls,
  HeadPoller,
  type PollResult,
  staleAfterMs,
} from "./poller"

// BlockHub: one upstream poll of the Mezo head per hub, fanned out to every
// client over hibernating WebSockets. One hub per network
// (`idFromName(network)`).
//
// Cadence: the alarm loop runs only while a socket is open. It polls at
// block cadence (HEADS_POLL_MS, Mezo's 3.8 s by default) and, when a poll
// finds the same block, retries after 1 s, doubling up to the block
// interval, so a head arrives about a second after it is produced at about
// 1.5 polls per block. With no socket the alarm is not rescheduled and the
// hub costs nothing. The first socket after a sleep polls at once and gets
// the current head before the loop restarts, so a first visitor never sees
// a stale ticker. Plain GETs (`/internal/pro/head`, the Blockscout proxy's
// head read) poll at most once per interval when no loop is running.
//
// A hub with no sockets is evicted after a few idle minutes and wakes with
// no head in memory. A plain GET then waits for the poll (its own, or one
// already in flight for someone else) for at most firstReadWaitMs; if that
// poll is slow or fails, it answers the last head saved to storage
// (`stored: true`, with its age), and 503 only when there is none.
//
// Mezo's public RPCs are HTTP; a `newHeads` WebSocket subscription would
// pin the object awake (an outbound socket cannot hibernate), so polling is
// the cheaper design.

export type BlockHubEnv = {
  /** Comma-separated RPC URLs, primary first; defaults to Mezo mainnet's. */
  HEADS_RPC_URLS?: string
  /** Block interval to poll at, in ms (default 3800, minimum 250). */
  HEADS_POLL_MS?: string
  /** Failures for this long make the feed stale (default 30000). */
  HEADS_STALE_MS?: string
}

/** Mezo averages 3.83 s per block (measured 9 Nov 2026). */
export const defaultPollMs = 3_800
const minimumPollMs = 250
/** First retry after a poll that found no new block. */
export const sameHeadRetryMs = 1_000
/**
 * The longest a plain GET waits for a poll when it has no head to give:
 * well under the readers' deadlines (Scan's 3 s), and under one RPC
 * attempt (2.5 s), so a slow primary falls back to the stored head.
 */
export const firstReadWaitMs = 1_200
/** A new head is saved to storage at most this often. */
export const headSaveEveryMs = 60_000

const storedHeadKey = "head"
const storedHeadSchema = z.object({
  head: blockHeadSchema,
  lastActiveBlock: z.number().int().nonnegative().nullable(),
})

/** What a plain GET answers with. */
type HeadAnswer = {
  head: BlockHead
  lastActiveBlock: number
  /** From storage: the hub's poll was slow or failed. */
  stored: boolean
}

function rpcUrls(env: BlockHubEnv): string[] {
  const configured = (env.HEADS_RPC_URLS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0)
  return configured.length > 0 ? configured : [...defaultHeadRpcUrls]
}

function milliseconds(
  raw: string | undefined,
  fallback: number,
  minimum: number,
): number {
  const value = Number.parseInt(raw ?? "", 10)
  return Number.isFinite(value) && value >= minimum ? value : fallback
}

/**
 * 1005, 1006 and 1015 are reserved and cannot be sent in a close frame; an
 * out-of-range code would throw too.
 */
export function sendableCloseCode(code: number): number {
  if (code === 1005 || code === 1006 || code === 1015) return 1000
  return code >= 1000 && code <= 4999 ? code : 1000
}

/** What one poll told the connected sockets. */
type TickOutcome = {
  result: PollResult
  sent: "head" | "stale" | "nothing"
}

export class BlockHub extends DurableObject<BlockHubEnv> {
  private readonly poller: HeadPoller
  private readonly intervalMs: number
  /** True once clients were told the feed is stale. */
  private announcedStale = false
  /** Wall-clock ms of the last poll attempt; null before the first. */
  private lastPollAt: number | null = null
  /** Consecutive polls that found no new block. */
  private sameStreak = 0
  private inFlight: Promise<TickOutcome> | null = null
  /**
   * The newest block that may have had transactions. Reported on plain
   * GETs so the Blockscout proxy can skip refreshing views over idle blocks.
   */
  private lastActiveBlock: number | null = null
  /** Wall-clock ms the head was last saved; null in a fresh instance. */
  private lastSavedAt: number | null = null

  constructor(ctx: DurableObjectState, env: BlockHubEnv) {
    super(ctx, env)
    this.poller = new HeadPoller({
      urls: rpcUrls(env),
      fetch: (input, init) => fetch(input, init),
      staleAfterMs: milliseconds(env.HEADS_STALE_MS, staleAfterMs, 100),
    })
    this.intervalMs = milliseconds(
      env.HEADS_POLL_MS,
      defaultPollMs,
      minimumPollMs,
    )
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      if (client === undefined || server === undefined) {
        return new Response("WebSocket pair unavailable", { status: 500 })
      }
      this.ctx.acceptWebSocket(server)
      // Answer the upgrade now; the greeting may wait on the RPC.
      this.ctx.waitUntil(this.greet(server))
      return new Response(null, { status: 101, webSocket: client })
    }
    // Plain GET: the latest head, polled now when the last poll (successful
    // or not) is older than a block, so a failing RPC is not hammered.
    const answer = await this.headForRead()
    if (answer === null) {
      return Response.json({ error: "head unavailable" }, { status: 503 })
    }
    return Response.json({
      data: {
        ...answer.head,
        lastActiveBlock: answer.lastActiveBlock,
        stored: answer.stored,
        ageSeconds: Math.max(
          0,
          Math.floor(Date.now() / 1000) - answer.head.timestamp,
        ),
      },
    })
  }

  /**
   * The head for a plain GET. Starts a poll when none ran within an
   * interval and waits for it; with no head in memory (a hub that just
   * woke) also waits for a poll someone else started, which used to answer
   * 503 at once. Each wait is bounded by firstReadWaitMs. Without a head
   * after that, the last saved one; null only when there is none.
   */
  private async headForRead(): Promise<HeadAnswer | null> {
    const startedHere = this.inFlight === null && !this.polledRecently()
    const polling = startedHere ? this.tick() : this.inFlight
    if (polling !== null && (startedHere || this.poller.head === null)) {
      await Promise.race([
        polling.then(
          () => undefined,
          () => undefined,
        ),
        new Promise<void>((resolve) => setTimeout(resolve, firstReadWaitMs)),
      ])
    }
    const live = this.poller.head
    if (live !== null) {
      return {
        head: live,
        lastActiveBlock: this.lastActiveBlock ?? live.block,
        stored: false,
      }
    }
    const saved = storedHeadSchema.safeParse(
      await this.ctx.storage.get(storedHeadKey).catch(() => null),
    )
    if (!saved.success) return null
    return {
      head: saved.data.head,
      lastActiveBlock: saved.data.lastActiveBlock ?? saved.data.head.block,
      stored: true,
    }
  }

  override async alarm(): Promise<void> {
    // No sockets: let the loop lapse. The next socket restarts it.
    if (this.ctx.getWebSockets().length === 0) {
      this.sameStreak = 0
      return
    }
    const outcome = await this.tick()
    await this.schedule(this.delayAfter(outcome.result))
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // Clients may ping to keep intermediaries from closing the socket.
    if (message === "ping") ws.send("pong")
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    // Idle check first: closing can throw, and the alarm must still stop.
    await this.sleepIfIdle(ws)
    try {
      ws.close(sendableCloseCode(code), "closing")
    } catch {
      // Already closed.
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.sleepIfIdle(ws)
  }

  /** Cancels the alarm when `closing` was the last open socket. */
  private async sleepIfIdle(closing: WebSocket): Promise<void> {
    const open = this.ctx
      .getWebSockets()
      .filter(
        (socket) => socket !== closing && socket.readyState === WebSocket.OPEN,
      )
    if (open.length === 0) {
      this.sameStreak = 0
      await this.ctx.storage.deleteAlarm()
    }
  }

  /**
   * The first message for a new socket: the current head (polled now if
   * the hub slept), or `stale` when the upstream is down. Then makes sure
   * the alarm loop is running.
   */
  private async greet(socket: WebSocket): Promise<void> {
    try {
      const outcome = this.polledRecently() ? null : await this.tick()
      // A new head was broadcast to every socket, this one included.
      if (outcome?.sent !== "head") {
        const since = this.poller.failingSinceSeconds
        if (this.poller.isStale(Date.now()) && since !== null) {
          if (outcome?.sent !== "stale") {
            this.send(socket, { type: "stale", since })
          }
        } else if (this.poller.head !== null) {
          this.send(socket, { type: "head", ...this.poller.head })
        }
      }
      await this.schedule(
        outcome === null ? this.intervalMs : this.delayAfter(outcome.result),
      )
    } catch (error) {
      logger.error({ message: "BlockHub greeting failed", error })
    }
  }

  /** Any poll, successful or not, within the last interval. */
  private polledRecently(): boolean {
    return (
      this.lastPollAt !== null && Date.now() - this.lastPollAt < this.intervalMs
    )
  }

  /** Next alarm delay after a poll. */
  private delayAfter(result: PollResult): number {
    if (result.kind === "same") {
      const retry = sameHeadRetryMs * 2 ** Math.min(this.sameStreak - 1, 8)
      return Math.min(retry, this.intervalMs)
    }
    return this.intervalMs
  }

  private send(socket: WebSocket, message: BlockHeadMessage): void {
    try {
      socket.send(JSON.stringify(message))
    } catch {
      // A closing socket; its close handler cleans up.
    }
  }

  private broadcast(message: BlockHeadMessage): void {
    for (const socket of this.ctx.getWebSockets()) this.send(socket, message)
  }

  /** One poll, shared by everyone who asks while it is in flight. */
  private tick(): Promise<TickOutcome> {
    if (this.inFlight === null) {
      this.inFlight = this.pollOnce().finally(() => {
        this.inFlight = null
      })
    }
    return this.inFlight
  }

  private async pollOnce(): Promise<TickOutcome> {
    const now = Date.now()
    this.lastPollAt = now
    const previous = this.poller.head?.block ?? null
    const result = await this.poller.poll(now)
    if (result.kind === "new") {
      // A block with transactions, or one we cannot vouch for (the first
      // poll, a skipped block, an RPC without the transaction list).
      if (
        previous === null ||
        result.head.block - previous !== 1 ||
        result.head.transactionCount !== 0
      ) {
        this.lastActiveBlock = result.head.block
      }
      this.sameStreak = 0
      this.announcedStale = false
      this.broadcast({ type: "head", ...result.head })
      await this.save(result.head, now)
      return { result, sent: "head" }
    }
    if (result.kind === "same") {
      this.sameStreak += 1
      return { result, sent: "nothing" }
    }
    if (result.stale && !this.announcedStale) {
      this.announcedStale = true
      logger.warn({ message: "BlockHub head is stale", since: result.since })
      this.broadcast({ type: "stale", since: result.since })
      return { result, sent: "stale" }
    }
    return { result, sent: "nothing" }
  }

  /**
   * Keeps the newest head in storage, at most once per headSaveEveryMs, for
   * a GET that finds the hub just woken and its first poll slow or failing.
   */
  private async save(head: BlockHead, now: number): Promise<void> {
    if (this.lastSavedAt !== null && now - this.lastSavedAt < headSaveEveryMs) {
      return
    }
    this.lastSavedAt = now
    try {
      await this.ctx.storage.put(storedHeadKey, {
        head,
        lastActiveBlock: this.lastActiveBlock,
      })
    } catch (error) {
      logger.warn({ message: "BlockHub could not save the head", error })
    }
  }

  private async schedule(delayMs: number): Promise<void> {
    const existing = await this.ctx.storage.getAlarm()
    if (existing === null) await this.ctx.storage.setAlarm(Date.now() + delayMs)
  }
}
