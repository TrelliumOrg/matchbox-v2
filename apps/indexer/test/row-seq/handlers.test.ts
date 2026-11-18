import { PGlite } from "@electric-sql/pglite"
import { VOTING_ESCROW_EVENTS_ABI as votingEscrowAbi } from "@matchbox/chain"
import type { Address } from "viem"
import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import type { LogWithTx } from "../../src/decode/projection"
import { runProjection } from "../../src/decode/projection"
import { STATIC_CONTRACTS } from "../../src/ingest/static-contracts"
import { PgIngestStore } from "../../src/ingest/store"
import { logEntry } from "../decode/entries"
import { applyMigrations, pgClient, pgPool } from "./pglite"

// The real write paths (the projection's upserts through PgStore.flush, the
// ingest store's contract upserts and pool links) against the triggers: a
// write that changes nothing must keep the row's stamp, or every tick would
// hand the reader rows it already has.

const VEBTC = "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279"
const LOCK = `${VEBTC}-42`
const EPOCH = 1_790_208_000n

const stampSchema = z.object({ row_seq: z.string() })

async function stamp(db: PGlite, sql: string): Promise<bigint> {
  const result = await db.query(sql)
  const row = z.array(stampSchema).parse(result.rows)[0]
  if (row === undefined) throw new Error(`No row for ${sql}`)
  return BigInt(row.row_seq)
}

const lockStamp = (db: PGlite) =>
  stamp(
    db,
    `SELECT row_seq::text AS row_seq FROM matchbox.lock_positions WHERE id = '${LOCK}'`,
  )

async function ingestRaw(
  db: PGlite,
  entries: LogWithTx[],
  through: bigint,
): Promise<void> {
  for (const { log, tx } of entries) {
    await db.query(
      `INSERT INTO matchbox_raw.logs (id, network, block_number, block_hash,
         block_timestamp, transaction_hash, transaction_index, log_index,
         address, topics, data)
       VALUES ($1, 'mezo', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        `${log.txHash}-${log.logIndex}`,
        log.blockNumber.toString(),
        log.blockHash,
        log.blockTimestamp.toString(),
        log.txHash,
        log.txIndex,
        log.logIndex,
        log.address,
        log.topics.join(","),
        log.data,
      ],
    )
    if (tx === null) continue
    await db.query(
      `INSERT INTO matchbox_raw.transactions (network, hash, block_number,
         transaction_index, from_address, to_address, input)
       VALUES ('mezo', $1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [
        tx.hash,
        tx.blockNumber.toString(),
        tx.txIndex,
        tx.from,
        tx.to,
        tx.input,
      ],
    )
  }
  await db.query(
    `INSERT INTO matchbox.indexer_checkpoints (network, stream, last_block)
     VALUES ('mezo', 'logs', $1)
     ON CONFLICT (network, stream) DO UPDATE SET last_block = EXCLUDED.last_block`,
    [through.toString()],
  )
}

function boost(block: bigint, value: bigint): LogWithTx {
  return logEntry(
    votingEscrowAbi,
    "UpdateBoost",
    { _tokenId: 42n, _boost: value },
    { address: VEBTC, block, timestamp: EPOCH + block },
  )
}

describe("stamps under the real handlers", { timeout: 60_000 }, () => {
  let db: PGlite

  beforeEach(async () => {
    db = new PGlite()
    await applyMigrations(db, () => true)
  }, 60_000)

  it("keeps a lock's stamp when its upsert changes nothing", async () => {
    const created = logEntry(
      votingEscrowAbi,
      "Deposit",
      {
        provider: "0x000000000000000000000000000000000000a11c",
        tokenId: 42n,
        depositType: 1,
        value: 5n * 10n ** 18n,
        locktime: EPOCH + 4n * 365n * 86_400n,
        ts: EPOCH,
      },
      { address: VEBTC, block: 8_000_000n, timestamp: EPOCH },
    )
    await ingestRaw(db, [created, boost(8_000_001n, 5n)], 8_000_001n)
    await runProjection(pgClient(db), "mezo", 8_000_001n)
    const first = await lockStamp(db)

    // The same boost again: the handler rewrites the lock with the values
    // it already has, and the upsert is a no-op.
    await ingestRaw(db, [boost(8_000_010n, 5n)], 8_000_010n)
    await runProjection(pgClient(db), "mezo", 8_000_010n)
    expect(await lockStamp(db)).toBe(first)

    // UpdateBoost writes no activity row (decoder v2), so only the stamp
    // tells a reader the boost moved.
    await ingestRaw(db, [boost(8_000_020n, 9n)], 8_000_020n)
    await runProjection(pgClient(db), "mezo", 8_000_020n)
    expect(await lockStamp(db)).toBeGreaterThan(first)
  })

  it("keeps contract stamps across a tick's re-seed and a repeated pool link", async () => {
    const store = new PgIngestStore(pgPool(db))
    const contracts = STATIC_CONTRACTS.mezo
    await store.upsertContracts(contracts, [])
    const stampsOf = async () =>
      (
        await db.query(
          `SELECT address, row_seq::text AS row_seq FROM matchbox.contracts
           ORDER BY address`,
        )
      ).rows
    const seeded = await stampsOf()
    expect(seeded).toHaveLength(new Set(contracts.map((c) => c.address)).size)
    await store.upsertContracts(contracts, [])
    expect(await stampsOf()).toEqual(seeded)

    const pool: Address = "0x00000000000000000000000000000000000000c4"
    const gauge: Address = "0x00000000000000000000000000000000000aa0e0"
    await store.upsertContracts(
      [
        {
          network: "mezo",
          address: pool,
          kind: "pool",
          template: "Pool",
          parent: null,
          pool,
          gauge: null,
          createdBlock: 8_000_000n,
          createdTx: null,
        },
      ],
      [],
    )
    const poolStamp = () =>
      stamp(
        db,
        `SELECT row_seq::text AS row_seq FROM matchbox.contracts WHERE address = '${pool}'`,
      )
    const unlinked = await poolStamp()
    const link = { network: "mezo" as const, pool, gauge }
    await store.upsertContracts([], [link])
    const linked = await poolStamp()
    expect(linked).toBeGreaterThan(unlinked)
    await store.upsertContracts([], [link])
    expect(await poolStamp()).toBe(linked)
  })
})
