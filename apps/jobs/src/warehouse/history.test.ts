import type { HistoryState } from "@matchbox/api/read-models/wallet-history"
import { describe, expect, it } from "vitest"
import {
  allocateHistory,
  gapTxs,
  type HistoryPlan,
  historyTxsPerRun,
  historyWrites,
  openGaps,
  planHistory,
  postponedStates,
  type WalletWindow,
  windowOf,
} from "./history"
import type { ActivityEventRow } from "./reader"

const wallet = `0x${"5a".repeat(20)}`

function event(ts: number, tx: string, log = 0): ActivityEventRow {
  return {
    tx_hash: tx,
    log_index: String(log),
    block_number: String(ts),
    timestamp: String(ts),
    action_type: "BOOST_VOTE",
    source: "BOOST_VOTER",
    actor: wallet,
    recipient: null,
    token_id: "9",
    amount: null,
    duration: null,
    prev_duration: null,
    post_duration: null,
    prev_is_permanent: null,
    post_is_permanent: null,
    merge_source_token_id: null,
    merge_dest_token_id: null,
    token: null,
    gauge: null,
    weight: "1",
    boostable_token_id: null,
    boost: null,
    epoch_start: null,
    contract_address: "0x0",
  }
}

/** Newest first: one transaction a second, from `newest` down. */
function events(newest: number, count: number): ActivityEventRow[] {
  return Array.from({ length: count }, (_, index) =>
    event(newest - index, `0x${(newest - index).toString(16)}`),
  )
}

function state(
  low: number,
  high: number,
  complete = false,
  updatedAt = 1,
): HistoryState {
  return {
    low: { ts: low, tx: `0x${low.toString(16)}` },
    high: { ts: high, tx: `0x${high.toString(16)}` },
    complete,
    updatedAt,
  }
}

function plan(
  window: WalletWindow,
  stored: HistoryState | undefined,
  requests: HistoryPlan["requests"] = [],
): HistoryPlan {
  return {
    requests,
    states: new Map(stored === undefined ? [] : [[wallet, stored]]),
    windows: new Map([[wallet, window]]),
    deferred: new Set(),
  }
}

describe("windowOf", () => {
  it("keeps a short read whole", () => {
    expect(windowOf(events(100, 5), 80)).toEqual({
      events: events(100, 5),
      truncated: false,
    })
  })

  it("keeps a wallet with exactly a document's events whole", () => {
    // The read asks for 81: 80 back means nothing older exists.
    expect(windowOf(events(100, 80), 80)).toEqual({
      events: events(100, 80),
      truncated: false,
    })
  })

  it("leaves a full read's oldest second out, whole", () => {
    const read = [...events(100, 79), event(21, "0xa", 3), event(21, "0xb", 2)]
    const window = windowOf(read, 80)
    expect(window.truncated).toBe(true)
    expect(window.events).toHaveLength(79)
    expect(window.events.every((each) => each.timestamp !== "21")).toBe(true)
  })

  it("keeps a document's worth of a full read of a single second", () => {
    const read = Array.from({ length: 81 }, (_, index) =>
      event(50, `0x${index}`),
    )
    const window = windowOf(read, 80)
    expect(window.truncated).toBe(false)
    expect(window.events).toHaveLength(80)
  })
})

describe("historyWrites", () => {
  const window = { events: events(200, 10), truncated: true }

  it("stores a wallet's first window and its span", () => {
    const writes = historyWrites(plan(window, undefined), [], 5)
    expect(writes.events.get(wallet)).toHaveLength(10)
    expect(writes.states.get(wallet)).toEqual(state(191, 200, false, 5))
  })

  it("adds only what is newer than the stored history", () => {
    const writes = historyWrites(plan(window, state(10, 195)), [], 5)
    expect(writes.events.get(wallet)?.map((each) => each.timestamp)).toEqual([
      "200",
      "199",
      "198",
      "197",
      "196",
    ])
    expect(writes.states.get(wallet)).toEqual(state(10, 200, false, 5))
  })

  it("writes nothing when nothing changed", () => {
    const writes = historyWrites(plan(window, state(10, 200)), [], 5)
    expect(writes.events.get(wallet) ?? []).toEqual([])
    expect(writes.states.has(wallet)).toBe(false)
  })

  it("stores the window's events below what is stored when it lowers the low", () => {
    // The warehouse lost events since the history was stored (a
    // re-index): the latest 10 now reach below its low, 195.
    const writes = historyWrites(plan(window, state(195, 200, true)), [], 5)
    expect(writes.events.get(wallet)?.map((each) => each.timestamp)).toEqual([
      "194",
      "193",
      "192",
      "191",
    ])
    // Whole from 191, and older events exist: the backfill looks again.
    expect(writes.states.get(wallet)).toEqual(state(191, 200, false, 5))
    // The run's budget counts them.
    const allocated = allocateHistory({
      windows: new Map([[wallet, window]]),
      states: new Map([[wallet, state(195, 200, true)]]),
      backfill: null,
      backfillTxs: null,
      budget: 3,
    })
    expect(allocated.deferred.has(wallet)).toBe(true)
  })

  it("closes a gap, then adds the window", () => {
    const request = {
      wallet,
      direction: "newer" as const,
      from: state(10, 150).high,
      until: { ts: 191, tx: "0xbf" },
      limit: gapTxs,
    }
    const gap = events(190, 40)
    const writes = historyWrites(
      plan(window, state(10, 150), [request]),
      [gap],
      5,
    )
    expect(writes.events.get(wallet)).toHaveLength(50)
    expect(writes.states.get(wallet)?.high.ts).toBe(200)
  })

  it("moves only up to what was read when the gap is wider than a read", () => {
    const far = { events: events(1_000, 10), truncated: true }
    const request = {
      wallet,
      direction: "newer" as const,
      from: state(10, 150).high,
      until: { ts: 991, tx: "0x3df" },
      limit: gapTxs,
    }
    const gap = events(150 + gapTxs, gapTxs)
    const writes = historyWrites(plan(far, state(10, 150), [request]), [gap], 5)
    expect(writes.events.get(wallet)).toHaveLength(gapTxs)
    expect(writes.states.get(wallet)?.high.ts).toBe(150 + gapTxs)
  })

  it("keeps a gap open when a read short of the full gap size is full", () => {
    // The budget gave this gap read only 30 transactions.
    const request = {
      wallet,
      direction: "newer" as const,
      from: state(10, 150).high,
      until: { ts: 191, tx: "0xbf" },
      limit: 30,
    }
    const writes = historyWrites(
      plan(window, state(10, 150), [request]),
      [events(180, 30).reverse()],
      5,
    )
    // Only the 30 read are stored, and the history ends at the last of
    // them, not at the window: 181 to 190 are still to read.
    expect(writes.events.get(wallet)).toHaveLength(30)
    expect(writes.states.get(wallet)?.high.ts).toBe(180)
  })

  it("reads back older transactions, and completes on a short read", () => {
    const older = {
      wallet,
      direction: "older" as const,
      from: state(100, 200).low,
      limit: 30,
    }
    const full = historyWrites(
      plan(window, state(100, 200), [older]),
      [events(99, 30)],
      5,
    )
    expect(full.states.get(wallet)).toMatchObject({
      low: { ts: 70 },
      complete: false,
    })
    const short = historyWrites(
      plan(window, state(100, 200), [older]),
      [events(99, 12)],
      5,
    )
    expect(short.states.get(wallet)).toMatchObject({
      low: { ts: 88 },
      complete: true,
    })
  })
})

describe("openGaps", () => {
  const window = { events: events(200, 10), truncated: true }
  const gapRead = (limit: number) => ({
    wallet,
    direction: "newer" as const,
    from: state(10, 150).high,
    until: { ts: 191, tx: "0xbf" },
    limit,
  })

  it("leaves out wallets stored up to their window, or never stored", () => {
    expect(openGaps(plan(window, state(10, 195)), []).size).toBe(0)
    expect(openGaps(plan(window, undefined), []).size).toBe(0)
  })

  it("names a gap left for later, read in vain, or read full", () => {
    const deferred = {
      ...plan(window, state(10, 150)),
      deferred: new Set([wallet]),
    }
    expect(openGaps(deferred, []).has(wallet)).toBe(true)
    const reading = plan(window, state(10, 150), [gapRead(gapTxs)])
    expect(openGaps(reading, null).has(wallet)).toBe(true)
    const full = plan(window, state(10, 150), [gapRead(30)])
    expect(openGaps(full, [events(180, 30).reverse()]).has(wallet)).toBe(true)
    // A short read closes it.
    expect(openGaps(reading, [events(190, 40).reverse()]).size).toBe(0)
  })
})

describe("planHistory", () => {
  it("throws on any failure but missing tables", async () => {
    const db = {
      prepare() {
        throw new Error("D1_ERROR: Network connection lost.")
      },
    } as unknown as D1Database
    await expect(
      planHistory({
        db,
        windows: new Map([[wallet, { events: events(9, 3), truncated: true }]]),
        backfillTxs: 100,
      }),
    ).rejects.toThrow("Network connection lost")
  })

  it("is off without the history tables", async () => {
    const db = {
      prepare() {
        throw new Error("no such table: wallet_history_state")
      },
    } as unknown as D1Database
    expect(
      await planHistory({
        db,
        windows: new Map([[wallet, { events: events(9, 3), truncated: true }]]),
        backfillTxs: 100,
      }),
    ).toBeNull()
  })
})

describe("the run's history budget", () => {
  /** Wallet `index`'s transactions: one a second, 1 to `count`. */
  function walletTx(index: number, ts: number): string {
    return `0x${index.toString(16).padStart(3, "0")}${ts.toString(16).padStart(8, "0")}`
  }

  function walletEvents(index: number, from: number, to: number) {
    const found: ActivityEventRow[] = []
    for (let ts = to; ts >= from; ts -= 1) {
      found.push(event(ts, walletTx(index, ts)))
    }
    return found
  }

  function txs(rows: readonly ActivityEventRow[]): number {
    return new Set(rows.map((row) => row.tx_hash)).size
  }

  it("spreads 133 wallets' gaps over runs, each within the budget", () => {
    // After an outage every busy wallet has done more than one read
    // holds: gaps of up to 1,000 transactions; a few were never stored.
    const wallets = Array.from({ length: 133 }, (_, index) => ({
      name: `0x${index.toString(16).padStart(40, "0")}`,
      index,
      count: 200 + ((index * 389) % 4_200),
    }))
    const windows = new Map<string, WalletWindow>()
    const states = new Map<string, HistoryState>()
    for (const each of wallets) {
      windows.set(each.name, {
        events: walletEvents(each.index, each.count - 78, each.count),
        truncated: true,
      })
      if (each.index % 10 !== 3) {
        const high = Math.max(1, each.count - 79 - ((each.index * 97) % 1_000))
        states.set(each.name, {
          low: { ts: 1, tx: walletTx(each.index, 1) },
          high: { ts: high, tx: walletTx(each.index, high) },
          complete: true,
          updatedAt: 0,
        })
      }
    }
    const byName = new Map(wallets.map((each) => [each.name, each]))
    let runs = 0
    for (; runs < 1_000; runs += 1) {
      // Every wallet is rebuilt every run: the worst case.
      const runPlan = allocateHistory({
        windows,
        states: new Map(states),
        backfill: null,
        backfillTxs: null,
        budget: historyTxsPerRun,
      })
      const results = runPlan.requests.map((request) => {
        const each = byName.get(request.wallet)
        const until = request.until
        if (each === undefined || until === undefined) return []
        return walletEvents(each.index, request.from.ts + 1, until.ts - 1)
          .reverse()
          .slice(0, request.limit)
      })
      const writes = historyWrites(runPlan, results, runs + 1)
      const written = [...writes.events.values()].reduce(
        (sum, rows) => sum + txs(rows),
        0,
      )
      expect(written).toBeLessThanOrEqual(historyTxsPerRun)
      if (writes.states.size === 0) break
      for (const [name, next] of writes.states) states.set(name, next)
    }
    // Several runs, and then every wallet's history reaches its document.
    expect(runs).toBeGreaterThan(10)
    expect(runs).toBeLessThan(1_000)
    for (const each of wallets) {
      expect(states.get(each.name)?.high).toEqual({
        ts: each.count,
        tx: walletTx(each.index, each.count),
      })
    }
  })

  it("leads with the wallet that waited longest, and backfills with the rest", () => {
    const first = `0x${"1".repeat(40)}`
    const second = `0x${"2".repeat(40)}`
    const window = { events: events(1_000, 10), truncated: true }
    const gapped = (updatedAt: number) => state(10, 500, false, updatedAt)
    const allocated = allocateHistory({
      windows: new Map([
        [first, window],
        [second, window],
      ]),
      states: new Map([
        [first, gapped(9)],
        [second, gapped(2)],
      ]),
      backfill: { wallet, state: state(100, 200) },
      backfillTxs: 100,
      budget: 250,
    })
    // The second waited longer: a full gap read and its window (210),
    // then the first fits 30 of its gap with its window, and nothing is
    // left for the backfill.
    expect(
      allocated.requests.map((request) => [request.wallet, request.limit]),
    ).toEqual([
      [second, gapTxs],
      [first, 30],
    ])
    expect(allocated.deferred.size).toBe(0)
    const roomy = allocateHistory({
      windows: new Map(),
      states: new Map(),
      backfill: { wallet, state: state(100, 200) },
      backfillTxs: 100,
      budget: 250,
    })
    expect(roomy.requests).toEqual([
      { wallet, direction: "older", from: state(100, 200).low, limit: 100 },
    ])
  })

  it("moves the read wallets back in line after a failed read", () => {
    const allocated = allocateHistory({
      windows: new Map(),
      states: new Map(),
      backfill: { wallet, state: state(100, 200, false, 3) },
      backfillTxs: 100,
      budget: 250,
    })
    expect(postponedStates(allocated, 77).get(wallet)).toEqual(
      state(100, 200, false, 77),
    )
  })
})
