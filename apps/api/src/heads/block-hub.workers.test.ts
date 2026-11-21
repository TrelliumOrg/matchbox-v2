import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test"
import { env } from "cloudflare:workers"
import {
  chainHeadSchema,
  headMessageSchema,
} from "@matchbox/contracts/read-models"
import {
  type BlockHeadMessage,
  blockHeadMessageSchema,
} from "@matchbox/contracts/scan"
import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { firstReadWaitMs, sendableCloseCode } from "./block-hub"
import type { Fetcher } from "./poller"

// The fake Mezo RPC lives in vitest.workers.config.ts (outboundService).
//
// Real time never decides when a hub polls here. HEADS_POLL_MS is a minute
// in that config, longer than any test, so no alarm fires and no interval
// lapses on its own however slow the machine is: a test runs the alarm
// with `runAlarm` and makes an interval pass with `expireInterval`. With a
// 250 ms interval, alarms fired in the background on loaded CI runners and
// polled between a test's steps. Staleness is still real time
// (HEADS_STALE_MS, 300 ms): a test waits at least that long, and a longer
// wait only makes the feed more stale.

const pollMs = Number(env.HEADS_POLL_MS)
const staleMs = Number(env.HEADS_STALE_MS)

function advanceChain(): Promise<Response> {
  return fetch("https://rpc.fake/__fake-rpc/advance")
}

function setRpcDelay(ms: number): Promise<Response> {
  return fetch(`https://rpc.fake/__fake-rpc/delay?value=${ms}`)
}

function setRpcDown(down: boolean): Promise<Response> {
  return fetch(`https://rpc.fake/__fake-rpc/down?value=${down}`)
}

function skipBlock(): Promise<Response> {
  return fetch("https://rpc.fake/__fake-rpc/skip")
}

function setTransactions(count: number): Promise<Response> {
  return fetch(`https://rpc.fake/__fake-rpc/transactions?value=${count}`)
}

/**
 * Counts the RPC requests one hub sends from now on. The fake RPC is shared
 * by every test file running at once, so its own count would include other
 * files' hubs.
 */
async function countRequests(name: string): Promise<() => number> {
  let count = 0
  await runInDurableObject(hub(name), (instance) => {
    const { options } = (
      instance as unknown as { poller: { options: { fetch: Fetcher } } }
    ).poller
    const send = options.fetch
    options.fetch = (input, init) => {
      count += 1
      return send(input, init)
    }
  })
  return () => count
}

/**
 * Makes the hub's last poll an interval old, as if HEADS_POLL_MS had
 * passed: its next plain GET or greeting polls again.
 */
function expireInterval(name: string): Promise<void> {
  return runInDurableObject(hub(name), (instance) => {
    ;(instance as unknown as { lastPollAt: number }).lastPollAt =
      Date.now() - pollMs
  })
}

const headWithActivity = z.object({
  data: chainHeadSchema.extend({ lastActiveBlock: z.number() }),
})

async function headState(name: string) {
  const response = await hub(name).fetch("https://block-hub/head")
  return headWithActivity.parse(await response.json()).data
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function hub(name: string) {
  return env.BLOCK_HUB.get(env.BLOCK_HUB.idFromName(name))
}

function alarmOf(name: string): Promise<number | null> {
  return runInDurableObject(hub(name), (_instance, state) =>
    state.storage.getAlarm(),
  )
}

/**
 * Waits until `check` holds, polling every 10 ms. Generous (500 tries, five
 * seconds or more), as a slow machine handles a socket close late; a check
 * that holds costs nothing extra.
 */
async function eventually(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (await check()) return
    await wait(10)
  }
  throw new Error("Condition never held")
}

/**
 * Runs the hub's alarm once, failing the test if none ran. A greeting
 * schedules the alarm after its first message is sent, so this waits for
 * the alarm to be set first.
 */
async function runAlarm(name: string): Promise<void> {
  await eventually(async () => (await alarmOf(name)) !== null)
  expect(await runDurableObjectAlarm(hub(name))).toBe(true)
}

/** Opens a client socket and collects the messages it receives. */
async function connect(name: string) {
  const response = await hub(name).fetch("https://block-hub/heads", {
    headers: { Upgrade: "websocket" },
  })
  expect(response.status).toBe(101)
  const socket = response.webSocket
  if (socket === null) throw new Error("No WebSocket in the response")
  socket.accept()
  const raw: string[] = []
  const messages: BlockHeadMessage[] = []
  const waiters: Array<() => void> = []
  socket.addEventListener("message", (event) => {
    const text = String(event.data)
    raw.push(text)
    messages.push(blockHeadMessageSchema.parse(JSON.parse(text)))
    for (const wake of waiters.splice(0)) wake()
  })
  async function next(count: number): Promise<BlockHeadMessage[]> {
    while (messages.length < count) {
      await new Promise<void>((resolve) => waiters.push(resolve))
    }
    return messages.slice(0, count)
  }
  return { socket, raw, messages, next }
}

async function headBlock(name: string): Promise<number> {
  const response = await hub(name).fetch("https://block-hub/head")
  const body = z.object({ data: chainHeadSchema }).parse(await response.json())
  return body.data.block
}

afterEach(async () => {
  await setRpcDown(false)
  await setRpcDelay(0)
  await setTransactions(1)
})

describe("BlockHub", () => {
  it("answers the latest head over HTTP", async () => {
    const response = await hub("http").fetch("https://block-hub/head")
    const body: unknown = await response.json()
    expect(body).toMatchObject({ data: { block: expect.any(Number) } })
  })

  it("re-polls a plain GET once the head is a block old", async () => {
    const before = await headBlock("http-fresh")
    await advanceChain()
    // Within one interval the cached head answers without a poll. The last
    // poll is stamped "now" inside the hub, so the read cannot fall outside
    // the interval.
    await runInDurableObject(hub("http-fresh"), (instance) => {
      ;(instance as unknown as { lastPollAt: number }).lastPollAt = Date.now()
    })
    const requests = await countRequests("http-fresh")
    expect(await headBlock("http-fresh")).toBe(before)
    expect(requests()).toBe(0)
    await expireInterval("http-fresh")
    expect(await headBlock("http-fresh")).toBe(before + 1)
    expect(requests()).toBe(1)
  })

  it("fans new heads out to every connected client", async () => {
    const first = await connect("fanout")
    const second = await connect("fanout")
    const [initial] = await first.next(1)
    await second.next(1)
    expect(initial?.type).toBe("head")

    await advanceChain()
    await runAlarm("fanout")
    const [, firstHead] = await first.next(2)
    const secondMessages = await second.next(2)
    const latest = secondMessages.at(-1)
    expect(firstHead).toEqual(latest)
    expect(firstHead).toMatchObject({ type: "head" })
    if (firstHead?.type === "head" && initial?.type === "head") {
      expect(firstHead.block).toBe(initial.block + 1)
      expect(firstHead.timestamp).toBe(initial.timestamp + 4)
    }

    // The hub keeps one alarm loop while clients are connected.
    expect(await alarmOf("fanout")).not.toBeNull()
    first.socket.close(1000, "done")
    second.socket.close(1000, "done")
  })

  it("keeps Pro's message shape and adds the explorer fields", async () => {
    const client = await connect("shape")
    const [message] = await client.next(1)
    const text = client.raw[0] ?? ""
    // Pro's contract still parses it; Pro's client reads type and block.
    const pro = headMessageSchema.parse(JSON.parse(text))
    expect(pro).toEqual({
      type: "head",
      block: expect.any(Number),
      timestamp: expect.any(Number),
    })
    expect(text).toContain('"type":"head"')
    expect(message).toMatchObject({
      type: "head",
      hash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      transactionCount: 1,
      gasUsed: "188547",
      miner: "0xd7fb1de0a4c2ffe5474e003656302a3f3a388a8a",
    })
    client.socket.close(1000, "done")
  })

  it("does not repeat a head and stops polling with no clients", async () => {
    const client = await connect("idle")
    await client.next(1)
    await runAlarm("idle")
    // The same head again: the loop retries after a second, so on a slow
    // machine that alarm may already have run by itself. Either way the hub
    // polled twice and sent nothing new.
    await runDurableObjectAlarm(hub("idle"))
    expect(client.messages).toHaveLength(1)
    client.socket.close(1000, "done")
    // The last close cancels the alarm; a lapsed alarm would not reschedule.
    await eventually(async () => (await alarmOf("idle")) === null)
    await runDurableObjectAlarm(hub("idle"))
    expect(await alarmOf("idle")).toBeNull()
  })

  it("lets the alarm lapse when it fires with no sockets", async () => {
    const client = await connect("lapse")
    await client.next(1)
    await runInDurableObject(hub("lapse"), (_instance, state) =>
      state.storage.setAlarm(Date.now() + 60_000),
    )
    client.socket.close(1000, "done")
    await eventually(async () => (await alarmOf("lapse")) === null)
    await runInDurableObject(hub("lapse"), (_instance, state) =>
      state.storage.setAlarm(Date.now()),
    )
    await runDurableObjectAlarm(hub("lapse"))
    expect(await alarmOf("lapse")).toBeNull()
  })

  it("wakes on the first socket after a sleep with the current head", async () => {
    const first = await connect("wake")
    const [before] = await first.next(1)
    first.socket.close(1000, "done")
    await eventually(async () => (await alarmOf("wake")) === null)

    // The chain moves on while nobody is watching.
    await advanceChain()
    await advanceChain()
    await expireInterval("wake")

    const second = await connect("wake")
    const [greeting] = await second.next(1)
    expect(greeting?.type).toBe("head")
    if (greeting?.type === "head" && before?.type === "head") {
      expect(greeting.block).toBe(before.block + 2)
    }
    // The loop restarted for the new socket.
    await eventually(async () => (await alarmOf("wake")) !== null)
    second.socket.close(1000, "done")
  })

  it("keeps the last head while the RPC is down", async () => {
    const client = await connect("down")
    await client.next(1)
    await setRpcDown(true)
    await runAlarm("down")
    expect(client.messages).toHaveLength(1)
    const response = await hub("down").fetch("https://block-hub/head")
    expect(response.status).toBe(200)
    client.socket.close(1000, "done")
  })

  it("signals stale once, greets late sockets with it, then recovers", async () => {
    const client = await connect("stale")
    await client.next(1)
    await setRpcDown(true)
    await runAlarm("stale")
    expect(client.messages).toHaveLength(1)
    await wait(staleMs + 20)
    await runAlarm("stale")
    const [, stale] = await client.next(2)
    expect(stale).toMatchObject({ type: "stale", since: expect.any(Number) })
    // Pro's client recognises it by this substring.
    expect(client.raw[1]).toContain('"type":"stale"')

    // Announced once per outage.
    await runAlarm("stale")
    expect(client.messages).toHaveLength(2)

    // A socket that joins during the outage is told at once.
    await expireInterval("stale")
    const late = await connect("stale")
    const [lateGreeting] = await late.next(1)
    expect(lateGreeting).toMatchObject({ type: "stale" })

    await setRpcDown(false)
    await advanceChain()
    await runAlarm("stale")
    const [, , recovered] = await client.next(3)
    expect(recovered).toMatchObject({ type: "head" })
    client.socket.close(1000, "done")
    late.socket.close(1000, "done")
  })

  it("throttles plain GETs while the RPC has never answered", async () => {
    await setRpcDown(true)
    const requests = await countRequests("never")
    // Three GETs inside one interval: one poll between them.
    const statuses = await Promise.all(
      [1, 2, 3].map(async () => {
        const response = await hub("never").fetch("https://block-hub/head")
        return response.status
      }),
    )
    expect(statuses).toEqual([503, 503, 503])
    expect(requests()).toBe(1)
    await expireInterval("never")
    await hub("never").fetch("https://block-hub/head")
    expect(requests()).toBe(2)
  })

  it("reports the last block that may have had transactions", async () => {
    // The first head is always counted as active.
    const first = await headState("activity")
    expect(first.lastActiveBlock).toBe(first.block)
    await setTransactions(0)
    await advanceChain()
    await expireInterval("activity")
    const idle = await headState("activity")
    expect(idle.block).toBe(first.block + 1)
    expect(idle.lastActiveBlock).toBe(first.block)
    // A skipped block cannot be vouched for.
    await skipBlock()
    await expireInterval("activity")
    const skipped = await headState("activity")
    expect(skipped.lastActiveBlock).toBe(skipped.block)
    await setTransactions(2)
    await advanceChain()
    await expireInterval("activity")
    const busy = await headState("activity")
    expect(busy.lastActiveBlock).toBe(busy.block)
  })

  it("stops the alarm even when the close code cannot be echoed", async () => {
    await runInDurableObject(hub("reserved"), (_instance, state) =>
      state.storage.setAlarm(Date.now() + 60_000),
    )
    const thrown = await runInDurableObject(
      hub("reserved"),
      async (instance) => {
        const [, server] = Object.values(new WebSocketPair())
        if (server === undefined) throw new Error("No socket")
        server.accept()
        // Sending 1006 is refused by the runtime...
        let refused = false
        try {
          server.close(1006, "closing")
        } catch {
          refused = true
        }
        const [, other] = Object.values(new WebSocketPair())
        if (other === undefined) throw new Error("No socket")
        other.accept()
        // ...yet the handler neither throws nor leaves the alarm set.
        await instance.webSocketClose(other, 1006)
        return refused
      },
    )
    expect(thrown).toBe(true)
    expect(await alarmOf("reserved")).toBeNull()
  })

  it("maps reserved and out-of-range close codes to 1000", () => {
    expect(sendableCloseCode(1005)).toBe(1000)
    expect(sendableCloseCode(1006)).toBe(1000)
    expect(sendableCloseCode(1015)).toBe(1000)
    expect(sendableCloseCode(999)).toBe(1000)
    expect(sendableCloseCode(1001)).toBe(1001)
    expect(sendableCloseCode(4000)).toBe(4000)
  })
})

describe("BlockHub's first read after a sleep", () => {
  const headAnswer = z.object({
    data: chainHeadSchema.extend({
      lastActiveBlock: z.number(),
      stored: z.boolean(),
      ageSeconds: z.number(),
    }),
  })

  /** A head saved by an earlier life of the hub, as if it had slept. */
  async function storeHead(name: string, block: number, timestamp: number) {
    await runInDurableObject(hub(name), (_instance, state) =>
      state.storage.put("head", {
        head: {
          block,
          timestamp,
          hash: null,
          transactionCount: null,
          gasUsed: null,
          miner: null,
        },
        lastActiveBlock: block,
      }),
    )
  }

  it("answers every concurrent first read, not only the one that polled", async () => {
    // A hub with no head in memory: the first read starts the poll and the
    // others arrive while it is in flight. They used to answer 503 at once.
    const reads = await Promise.all(
      [0, 1, 2].map(() => hub("woken").fetch("https://block-hub/head")),
    )
    expect(reads.map((response) => response.status)).toEqual([200, 200, 200])
    const blocks = await Promise.all(
      reads.map(async (response) => headAnswer.parse(await response.json())),
    )
    expect(new Set(blocks.map((body) => body.data.block)).size).toBe(1)
    expect(blocks.every((body) => !body.data.stored)).toBe(true)
  })

  it("still answers 503 when the first poll fails and no head is stored", async () => {
    await setRpcDown(true)
    const reads = await Promise.all(
      [0, 1].map(() => hub("never-polled").fetch("https://block-hub/head")),
    )
    expect(reads.map((response) => response.status)).toEqual([503, 503])
  })

  it("answers the stored head, marked and aged, when the first poll fails", async () => {
    const timestamp = Math.floor(Date.now() / 1000) - 120
    await storeHead("slept", 13_000_000, timestamp)
    await setRpcDown(true)
    const response = await hub("slept").fetch("https://block-hub/head")
    expect(response.status).toBe(200)
    const body = headAnswer.parse(await response.json())
    expect(body.data).toMatchObject({ block: 13_000_000, stored: true })
    // The Worker's clock stands still between I/O, so it can read a second
    // behind this file's: 119 is the same head, a tick earlier.
    expect(body.data.ageSeconds).toBeGreaterThanOrEqual(119)
  })

  it("waits for a slow first poll only up to the bound, then serves the stored head", async () => {
    // The RPC takes three times the bound; the read must not wait for it.
    const delay = firstReadWaitMs * 3
    await storeHead("slow", 13_000_000, Math.floor(Date.now() / 1000) - 30)
    await setRpcDelay(delay)
    const response = await hub("slow").fetch("https://block-hub/head")
    expect(response.status).toBe(200)
    // The stored head, not the polled one: the answer came before the
    // poll did, so the read stopped waiting at the bound. (A wall-clock
    // check of the same thing failed on loaded CI machines, where the
    // hub's timers run late; which head came back does not depend on it.)
    expect(headAnswer.parse(await response.json()).data.stored).toBe(true)
  })

  it("saves a polled head, so the next sleep has one to serve", async () => {
    await hub("saves").fetch("https://block-hub/head")
    const saved = await runInDurableObject(hub("saves"), (_instance, state) =>
      state.storage.get("head"),
    )
    expect(saved).toMatchObject({ head: { block: expect.any(Number) } })
  })
})
