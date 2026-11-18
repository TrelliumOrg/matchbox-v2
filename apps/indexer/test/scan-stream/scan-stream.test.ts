import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { PGlite } from "@electric-sql/pglite"
import {
  ACTIVE_POOL_DEBT_UPDATED_TOPIC,
  ERC20_TRANSFER_TOPIC,
  MUSD_FEE_SOURCES,
  SCAN_STREAM_TOKENS,
} from "@matchbox/chain"
import { type Address, type Hex, isAddress, isHex } from "viem"
import { beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import type { SqlPool } from "../../src/borrow/pg-store"
import {
  lowerAddressSchema,
  type RawLog,
  RpcClient,
} from "../../src/ingest/rpc"
import { LIVE_ROW_SEQ_START } from "../../src/row-seq"
import { decodeScanLogs, utcDay } from "../../src/scan-stream/decoder"
import {
  fetchScanWindow,
  ingestScanToHead,
  type ScanDeps,
} from "../../src/scan-stream/ingest"
import { PgScanStore } from "../../src/scan-stream/pg-store"
import {
  MemoryScanStore,
  ScanCheckpointMovedError,
} from "../../src/scan-stream/store"
import { RecordedChain } from "../borrow/recorded-chain"
import { applyMigrations } from "../row-seq/pglite"

// The scan stream against real mainnet logs (test/fixtures/scan-stream,
// recorded by scripts/record-scan-fixtures.ts): four windows holding
// mbhBTC's first mint, borrowing and refinancing fees, redemptions and
// interest-only PCV mints, with each token's totalSupply() at the windows'
// ends as the on-chain oracle for mints and burns.

const hexSchema = z.custom<Hex>(
  (value) => typeof value === "string" && isHex(value),
)
const addressSchema = z.custom<Address>(
  (value) => typeof value === "string" && isAddress(value, { strict: false }),
)
const digits = z.string().regex(/^\d+$/)

const fixtureSchema = z.object({
  source: z.string(),
  windows: z.array(digits),
  windowSize: digits,
  logs: z.array(
    z.tuple([
      digits,
      hexSchema,
      digits,
      hexSchema,
      z.number().int(),
      z.number().int(),
      addressSchema,
      z.array(hexSchema),
      hexSchema,
    ]),
  ),
  supply: z.record(z.string(), z.record(z.string(), digits)),
})

const fixture = fixtureSchema.parse(
  JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "../fixtures/scan-stream/mainnet-scan.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  ),
)

const logs: RawLog[] = fixture.logs.map(
  ([
    block,
    blockHash,
    timestamp,
    txHash,
    txIndex,
    logIndex,
    address,
    topics,
    data,
  ]) => ({
    network: "mezo",
    blockNumber: BigInt(block),
    blockHash,
    blockTimestamp: BigInt(timestamp),
    txHash,
    txIndex,
    logIndex,
    address: lowerAddressSchema.parse(address),
    topics,
    data,
  }),
)

const WINDOW = BigInt(fixture.windowSize)
const windows = fixture.windows.map((from) => ({
  from: BigInt(from),
  to: BigInt(from) + WINDOW - 1n,
}))
const firstBlock = windows[0]?.from ?? 0n
const lastBlock = windows[windows.length - 1]?.to ?? 0n

const CONFIG = {
  network: "mezo" as const,
  chainId: 31612,
  startBlock: 5_000_000n,
  confirmations: 2n,
  windowSize: WINDOW,
  endpoints: [
    { url: "https://recorded.test", maxAddresses: 100, maxBlockRange: 10_000 },
  ],
}

function recordedRpc(): { rpc: RpcClient; chain: RecordedChain } {
  const chain = new RecordedChain(logs, {}, lastBlock + CONFIG.confirmations)
  return {
    chain,
    rpc: new RpcClient({
      network: "mezo",
      endpoints: CONFIG.endpoints,
      fetch: chain.fetch,
      sleep: async () => {},
    }),
  }
}

function pool(db: PGlite): SqlPool {
  async function query(text: string, values?: unknown[]) {
    const result = await db.query(text, values)
    return { rows: result.rows }
  }
  return {
    query,
    async connect() {
      return { query, release() {} }
    },
  }
}

describe("scan stream decoding of real logs", () => {
  const decoded = windows.map((window) =>
    decodeScanLogs(
      logs.filter(
        (log) => log.blockNumber >= window.from && log.blockNumber <= window.to,
      ),
    ),
  )
  const fees = decoded.flatMap((rows) => rows.fees)
  const days = decoded.flatMap((rows) => rows.days)

  it("covers every fee type", () => {
    const types = new Set(fees.map((fee) => fee.feeType))
    expect([...types].sort()).toEqual([
      "BORROWING",
      "ENCLAVE",
      "INTEREST",
      "REDEMPTION",
      "REFINANCING",
    ])
  })

  it("counts every token Transfer once, on its UTC day", () => {
    const tokens = new Set<string>(SCAN_STREAM_TOKENS.map((t) => t.address))
    const transfers = logs.filter(
      (log) =>
        tokens.has(log.address) && log.topics[0] === ERC20_TRANSFER_TOPIC,
    )
    expect(days.reduce((sum, day) => sum + day.transfers, 0n)).toBe(
      BigInt(transfers.length),
    )
    const sample = transfers[0]
    if (sample === undefined) throw new Error("No transfers in the fixture")
    expect(
      days.some(
        (day) =>
          day.token === sample.address &&
          day.day === utcDay(sample.blockTimestamp),
      ),
    ).toBe(true)
  })

  it("matches totalSupply() for the token whose supply moves by Transfer", () => {
    for (const token of SCAN_STREAM_TOKENS) {
      const bounds = fixture.supply[token.address] ?? {}
      for (const [index, window] of windows.entries()) {
        const before = BigInt(bounds[(window.from - 1n).toString()] ?? "0")
        const after = BigInt(bounds[window.to.toString()] ?? "0")
        const rows = (decoded[index]?.days ?? []).filter(
          (day) => day.token === token.address,
        )
        const net = rows.reduce((sum, day) => sum + day.minted - day.burned, 0n)
        if (token.supplyFromTransfers === "candidate") {
          expect(net, `${token.symbol} ${window.from}`).toBe(after - before)
        }
      }
    }
    // mbhBTC's first supply (block 7,638,288).
    const index = windows.findIndex(
      (window) => window.from <= 7_638_288n && window.to >= 7_638_288n,
    )
    const first = decoded[index]?.days.find(
      (day) => day.token === "0xe2232789d4cf5bb1ffada1a105cc59b18d639318",
    )
    expect(first?.minted).toBe(100_132_222_680_456_961_584n)
  })

  it("derives trove interest as the PCV mints beyond each debt transaction's fees", () => {
    const debtTxs = new Set(
      logs
        .filter(
          (log) =>
            log.address === MUSD_FEE_SOURCES.activePool &&
            log.topics[0] === ACTIVE_POOL_DEBT_UPDATED_TOPIC,
        )
        .map((log) => log.txHash),
    )
    const mints = new Map<string, bigint>()
    for (const log of logs) {
      if (log.address !== MUSD_FEE_SOURCES.musd) continue
      if (!debtTxs.has(log.txHash)) continue
      mints.set(log.txHash, (mints.get(log.txHash) ?? 0n) + BigInt(log.data))
    }
    const paid = new Map<string, bigint>()
    for (const fee of fees) {
      if (fee.feeType === "BORROWING" || fee.feeType === "REFINANCING") {
        paid.set(fee.txHash, (paid.get(fee.txHash) ?? 0n) + fee.amount)
      }
    }
    const interest = fees.filter((row) => row.feeType === "INTEREST")
    for (const fee of interest) {
      expect(fee.amount).toBe(
        (mints.get(fee.txHash) ?? 0n) - (paid.get(fee.txHash) ?? 0n),
      )
      expect(fee.contractAddress).toBe(MUSD_FEE_SOURCES.musd)
    }
    expect(interest.length).toBe(
      [...mints].filter(([tx, minted]) => minted > (paid.get(tx) ?? 0n)).length,
    )
    // A collateral-surplus claim pays interest with no TroveUpdated.
    expect(
      interest.find(
        (fee) =>
          fee.txHash ===
          "0xa260a3460ab6ea87e6e4b63002c696b81e7f814556a1c1ec4de9a3816bcc6612",
      )?.amount,
    ).toBe(6_102_080_029_090_056_813n)
  })

  it("attributes Enclave debt mints to ENCLAVE, not trove interest", () => {
    const enclave = fees.filter((row) => row.feeType === "ENCLAVE")
    const repaid = enclave.find(
      (fee) =>
        fee.txHash ===
        "0x5a3dc42919bc002a487ecc9d4165db45eed10687d5d5d2666e8d455c35027105",
    )
    // 1,977.04 MUSD minted to PCV when the Enclave position repaid.
    expect(repaid?.amount).toBe(1_977_042_174_415_323_761_306n)
    expect(repaid?.asset).toBe("MUSD")
  })

  it("does not count the PCV bootstrap loan as interest", () => {
    const bootstrap =
      "0xa3a6529b555dfd7be3b9876b70e854a293664bc3db07cf58dbe1bc41776ec7fa"
    const minted = logs.filter(
      (log) =>
        log.txHash === bootstrap && log.address === MUSD_FEE_SOURCES.musd,
    )
    expect(minted.map((log) => BigInt(log.data))).toEqual([
      100_000_000n * 10n ** 18n,
    ])
    expect(fees.filter((fee) => fee.txHash === bootstrap)).toEqual([])
  })

  it("refuses a log the filters should not return", () => {
    const stray = {
      ...logs[0],
      address: "0x00000000000000000000000000000000000000aa",
    }
    expect(() => decodeScanLogs([stray as RawLog])).toThrow(/unexpected log/)
  })
})

describe("scan stream on Postgres", { timeout: 120_000 }, () => {
  let db: PGlite
  let deps: ScanDeps
  let requests: RecordedChain

  beforeAll(async () => {
    db = new PGlite()
    await applyMigrations(db, () => true)
    const { rpc, chain } = recordedRpc()
    requests = chain
    deps = {
      config: CONFIG,
      rpc,
      store: new PgScanStore(pool(db)),
      historyStart: firstBlock,
    }
    await ingestScanToHead(deps, lastBlock - firstBlock + 1n)
  }, 120_000)

  it("writes the decoded rows and its checkpoint", async () => {
    const memory = new MemoryScanStore()
    const { rpc } = recordedRpc()
    await ingestScanToHead(
      { config: CONFIG, rpc, store: memory, historyStart: firstBlock },
      lastBlock - firstBlock + 1n,
    )
    const stored = await db.query(
      `SELECT token, day::text AS day, transfers::text AS transfers,
              volume::text AS volume, minted::text AS minted,
              burned::text AS burned, row_seq::text AS row_seq
       FROM matchbox.token_transfer_days ORDER BY token, day`,
    )
    const rows = z
      .array(
        z.object({
          token: z.string(),
          day: z.string(),
          transfers: digits,
          volume: digits,
          minted: digits,
          burned: digits,
          row_seq: digits,
        }),
      )
      .parse(stored.rows)
    expect(rows.length).toBe(memory.days.size)
    for (const row of rows) {
      const expected = memory.days.get(`${row.token}|${row.day}`)
      expect(expected, `${row.token} ${row.day}`).toBeDefined()
      expect(BigInt(row.transfers)).toBe(expected?.transfers)
      expect(BigInt(row.volume)).toBe(expected?.volume)
      expect(BigInt(row.minted)).toBe(expected?.minted)
      expect(BigInt(row.burned)).toBe(expected?.burned)
      expect(BigInt(row.row_seq)).toBeGreaterThanOrEqual(LIVE_ROW_SEQ_START)
    }
    const feeCount = await db.query(
      "SELECT count(*)::int AS count FROM matchbox.musd_fees",
    )
    expect(feeCount.rows).toEqual([{ count: memory.fees.size }])
    expect(await deps.store.getCheckpoint("mezo")).toBe(lastBlock)
    // Two eth_getLogs per window, gaps included, and headers only for
    // blocks with logs.
    const calls = requests.methods.filter((method) => method === "eth_getLogs")
    expect(calls.length).toBe(
      Number(((lastBlock - firstBlock + 1n) / WINDOW) * 2n),
    )
  })

  it("never applies a window twice", async () => {
    await expect(
      deps.store.commitWindow({
        network: "mezo",
        fromBlock: firstBlock,
        toBlock: firstBlock + WINDOW - 1n,
        expectedCheckpoint: firstBlock - 1n,
        days: [],
        fees: [],
      }),
    ).rejects.toThrow(ScanCheckpointMovedError)
  })

  it("restamps a day row when a later window adds to it", async () => {
    const day = utcDay(logs[logs.length - 1]?.blockTimestamp ?? 0n)
    const token = SCAN_STREAM_TOKENS[0]?.address ?? ""
    const before = await db.query(
      `SELECT row_seq::text AS row_seq, transfers::text AS transfers
       FROM matchbox.token_transfer_days WHERE token = $1 AND day = $2`,
      [token, day],
    )
    const next = lastBlock + 1n
    await deps.store.commitWindow({
      network: "mezo",
      fromBlock: next,
      toBlock: next,
      expectedCheckpoint: lastBlock,
      days: [
        {
          token: lowerAddressSchema.parse(token),
          day,
          transfers: 1n,
          volume: 5n,
          minted: 0n,
          burned: 0n,
        },
      ],
      fees: [],
    })
    const after = await db.query(
      `SELECT row_seq::text AS row_seq, transfers::text AS transfers
       FROM matchbox.token_transfer_days WHERE token = $1 AND day = $2`,
      [token, day],
    )
    const parse = z.array(z.object({ row_seq: digits, transfers: digits }))
    const [old] = parse.parse(before.rows)
    const [updated] = parse.parse(after.rows)
    expect(BigInt(updated?.transfers ?? "0")).toBe(
      BigInt(old?.transfers ?? "0") + 1n,
    )
    expect(BigInt(updated?.row_seq ?? "0")).toBeGreaterThan(
      BigInt(old?.row_seq ?? "0"),
    )
  })

  it("leaves one reset tombstone per table on a replay", async () => {
    await deps.store.reset("mezo")
    const tombstones = await db.query(
      `SELECT table_name, network, kind FROM matchbox.deleted_rows
       ORDER BY row_seq`,
    )
    expect(tombstones.rows).toEqual([
      { table_name: "token_transfer_days", network: "mezo", kind: "reset" },
      { table_name: "musd_fees", network: "mezo", kind: "reset" },
    ])
    expect(await deps.store.getCheckpoint("mezo")).toBeNull()
  })
})

describe("RpcClient topic filters", () => {
  it("sends topics 1 to 3 only for a filter that names them", async () => {
    const bodies: unknown[] = []
    const rpc = new RpcClient({
      network: "mezo",
      endpoints: CONFIG.endpoints,
      sleep: async () => {},
      async fetch(_input, init) {
        const body: unknown = JSON.parse(String(init?.body))
        bodies.push(body)
        return Response.json({ jsonrpc: "2.0", id: 1, result: [] })
      },
    })
    await fetchScanWindow({ rpc }, { from: 1n, to: 2n })
    const topics = z
      .array(z.object({ params: z.array(z.object({ topics: z.unknown() })) }))
      .parse(bodies)
      .map((body) => body.params[0]?.topics)
    expect(topics).toContainEqual([
      [ERC20_TRANSFER_TOPIC],
      `0x${"0".repeat(64)}`,
      `0x${"0".repeat(24)}${MUSD_FEE_SOURCES.pcv.slice(2)}`,
    ])
    // The other filter sends topic0 alone, exactly as before.
    expect(topics.some((t) => Array.isArray(t) && t.length === 1)).toBe(true)
  })
})
