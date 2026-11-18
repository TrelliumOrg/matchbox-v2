import { describe, expect, it } from "vitest"
import {
  type IndexerTickHook,
  type IndexerTickSummary,
  runTickHook,
} from "../src/hook"

const SUMMARY: IndexerTickSummary = {
  kind: "matchbox-indexer-tick",
  version: 1,
  network: "mezo",
  cron: "*/15 * * * *",
  startedAt: "2026-11-09T00:00:00.000Z",
  finishedAt: "2026-11-09T00:00:09.000Z",
  neonAwakeUntil: "2026-11-09T00:05:09.000Z",
  database: { bytes: "285000000", capBytes: "1000000000", writable: true },
  ingest: {
    status: "advanced",
    lastBlock: "13098469",
    from: "13098235",
    to: "13098469",
    logs: 41,
  },
  projection: { status: "advanced", lastBlock: "13098469", decoderVersion: 2 },
  borrow: {
    status: "at-head",
    lastBlock: "13098469",
    morphoEvents: 0,
    enclaveEvents: 0,
    decoderVersion: 1,
  },
}

function recorder() {
  const entries: { level: string; message: string }[] = []
  return {
    entries,
    logger: {
      info(entry: { message: string }) {
        entries.push({ level: "info", message: entry.message })
      },
      error(entry: { message: string }) {
        entries.push({ level: "error", message: entry.message })
      },
    },
  }
}

describe("runTickHook", () => {
  it("hands the hook the tick summary", async () => {
    const received: IndexerTickSummary[] = []
    const hook: IndexerTickHook = {
      async warehouseSnapshot(summary) {
        received.push(summary)
        return { status: "ok" }
      },
    }
    const { logger, entries } = recorder()
    expect(await runTickHook(hook, SUMMARY, logger)).toBe(true)
    expect(received).toEqual([SUMMARY])
    expect(entries).toEqual([{ level: "info", message: "Tick hook finished" }])
  })

  it("never fails the tick when the hook throws", async () => {
    const { logger, entries } = recorder()
    const hook: IndexerTickHook = {
      async warehouseSnapshot() {
        throw new Error("D1 unavailable")
      },
    }
    expect(await runTickHook(hook, SUMMARY, logger)).toBe(false)
    expect(entries[0]?.level).toBe("error")
  })

  it("does nothing without a binding", async () => {
    const { logger, entries } = recorder()
    expect(await runTickHook(undefined, SUMMARY, logger)).toBe(false)
    expect(entries).toEqual([])
  })

  it("sends only JSON-safe values", () => {
    expect(JSON.parse(JSON.stringify(SUMMARY))).toEqual(SUMMARY)
  })
})
