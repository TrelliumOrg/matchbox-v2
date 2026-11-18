import { PGlite } from "@electric-sql/pglite"
import { VOTING_ESCROW_EVENTS_ABI as votingEscrowAbi } from "@matchbox/chain"
import type { Address } from "viem"
import { describe, expect, it } from "vitest"
import {
  ProjectionReplayRequiredError,
  projectBlock,
  projectionStatus,
  runProjection,
} from "../../src/decode/projection"
import { InMemoryStore } from "../../src/decode/store"
import { DECODER_VERSION } from "../../src/decode/version"
import { applyMigrations, pgClient } from "../row-seq/pglite"
import { logEntry } from "./entries"

// Decoder versions: a database keeps projecting with the supported version
// it was built with (no halt on deploy), a replay builds DECODER_VERSION,
// and v3 adds LOCK_BOOST_UPDATED rows.

const VEBTC: Address = "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279"
const ALICE: Address = "0x000000000000000000000000000000000000a11c"
const EPOCH = 1_790_208_000n

function lock(block: bigint) {
  return logEntry(
    votingEscrowAbi,
    "Deposit",
    {
      provider: ALICE,
      tokenId: 42n,
      depositType: 1,
      value: 10n ** 18n,
      locktime: EPOCH + 365n * 86_400n,
      ts: EPOCH,
    },
    { address: VEBTC, block, timestamp: EPOCH },
  )
}

// The escrow mints the NFT with a Transfer from 0x0; that sets the owner.
function minted(block: bigint) {
  return logEntry(
    votingEscrowAbi,
    "Transfer",
    {
      from: "0x0000000000000000000000000000000000000000",
      to: ALICE,
      tokenId: 42n,
    },
    { address: VEBTC, block, timestamp: EPOCH },
  )
}

function boost(block: bigint, value: bigint) {
  return logEntry(
    votingEscrowAbi,
    "UpdateBoost",
    { _tokenId: 42n, _boost: value },
    { address: VEBTC, block, timestamp: EPOCH + 1n },
  )
}

describe("LOCK_BOOST_UPDATED", () => {
  it("is a warehouse-only row in v3, outside the lock's activity count", () => {
    const store = new InMemoryStore(3)
    projectBlock([minted(8_000_000n), lock(8_000_000n)], store)
    projectBlock([boost(8_000_001n, 7n)], store)
    const rows = [...store.activities.values()].filter(
      (row) => row.actionType === "LOCK_BOOST_UPDATED",
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      tokenId: 42n,
      boost: 7n,
      actor: ALICE,
      explorerParity: false,
      contractAddress: VEBTC,
    })
    // As in the explorer, only the Deposit counts: not the mint Transfer,
    // and not the boost.
    expect(store.locks.get(`${VEBTC}-42`)).toMatchObject({
      boost: 7n,
      activityCount: 1n,
    })
  })

  it("is not written by v2 tables", () => {
    const store = new InMemoryStore(2)
    projectBlock([lock(8_000_000n)], store)
    projectBlock([boost(8_000_001n, 7n)], store)
    expect([...store.activities.values()].map((row) => row.actionType)).toEqual(
      ["LOCK_CREATED"],
    )
    expect(store.locks.get(`${VEBTC}-42`)?.boost).toBe(7n)
  })
})

async function rawDatabase(builtWith: number | null): Promise<PGlite> {
  const db = new PGlite()
  await applyMigrations(db, () => true)
  for (const { log, tx } of [lock(8_000_000n), boost(8_000_001n, 7n)]) {
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
       VALUES ('mezo', $1, $2, $3, $4, $5, $6)`,
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
     VALUES ('mezo', 'logs', 8000001)`,
  )
  if (builtWith !== null) {
    await db.query(
      `INSERT INTO matchbox.projection_state (network, decoder_version)
       VALUES ('mezo', $1)`,
      [builtWith],
    )
  }
  return db
}

async function actionTypes(db: PGlite): Promise<unknown[]> {
  const result = await db.query(
    "SELECT action_type, decoder_version FROM matchbox.activity_events ORDER BY block_number",
  )
  return result.rows
}

describe("projecting with the version the tables were built with", {
  timeout: 60_000,
}, () => {
  it("keeps projecting v2 tables with v2, and reports the upgrade", async () => {
    const db = await rawDatabase(2)
    const result = await runProjection(pgClient(db), "mezo", 8_000_001n)
    expect(result.decoderVersion).toBe(2)
    expect(await actionTypes(db)).toEqual([
      { action_type: "LOCK_CREATED", decoder_version: 2 },
    ])
    expect(await projectionStatus(pgClient(db), "mezo")).toMatchObject({
      builtWithDecoderVersion: 2,
      replayRequired: false,
      upgradeAvailable: true,
    })
  })

  it("builds empty tables with DECODER_VERSION", async () => {
    const db = await rawDatabase(null)
    const result = await runProjection(pgClient(db), "mezo", 8_000_001n)
    expect(result.decoderVersion).toBe(DECODER_VERSION)
    expect(await actionTypes(db)).toEqual([
      { action_type: "LOCK_CREATED", decoder_version: 3 },
      { action_type: "LOCK_BOOST_UPDATED", decoder_version: 3 },
    ])
  })

  it("halts on a version it no longer supports", async () => {
    const db = await rawDatabase(1)
    await expect(
      runProjection(pgClient(db), "mezo", 8_000_001n),
    ).rejects.toThrow(ProjectionReplayRequiredError)
    expect(await projectionStatus(pgClient(db), "mezo")).toMatchObject({
      replayRequired: true,
      upgradeAvailable: false,
    })
  })
})

// Real UnlockPermanent events and the end locked(tokenId) returned at their
// block (mainnet, read 11 Nov 2026).
const UNLOCKS = [
  { escrow: VEBTC, tokenId: 5306n, ts: 1_793_393_780n, end: 1_795_651_200n },
  { escrow: VEBTC, tokenId: 5963n, ts: 1_793_215_610n, end: 1_795_046_400n },
  {
    escrow: "0xb90fdad3dfd180458d62cc6acedc983d78e20122" as Address,
    tokenId: 2348n,
    ts: 1_793_829_201n,
    end: 1_919_030_400n,
  },
  {
    escrow: "0xb90fdad3dfd180458d62cc6acedc983d78e20122" as Address,
    tokenId: 2924n,
    ts: 1_793_801_347n,
    end: 1_919_030_400n,
  },
]

function unlocked(unlock: (typeof UNLOCKS)[number]) {
  return logEntry(
    votingEscrowAbi,
    "UnlockPermanent",
    { _owner: ALICE, _tokenId: unlock.tokenId, amount: 1n, _ts: unlock.ts },
    { address: unlock.escrow, block: 12_900_000n, timestamp: unlock.ts },
  )
}

describe("escrow MAXTIME", () => {
  it("rebuilds the end UnlockPermanent sets exactly as the chain did in v3", () => {
    for (const unlock of UNLOCKS) {
      const store = new InMemoryStore(3)
      projectBlock([unlocked(unlock)], store)
      expect(
        store.locks.get(`${unlock.escrow}-${unlock.tokenId}`)?.unlockAt,
        `token ${unlock.tokenId}`,
      ).toBe(unlock.end)
    }
  })

  it("keeps the explorer's 4 x 365 days in v2 tables", () => {
    const [veMezo] = UNLOCKS.slice(2)
    if (veMezo === undefined) throw new Error("no veMEZO unlock")
    const store = new InMemoryStore(2)
    projectBlock([unlocked(veMezo)], store)
    // One week past the chain's end, as the explorer had it.
    expect(store.locks.get(`${veMezo.escrow}-2348`)?.unlockAt).toBe(
      1_919_635_200n,
    )
  })

  it("gives a permanent veBTC lock the 28-day duration in v3", () => {
    const store = new InMemoryStore(3)
    projectBlock(
      [
        logEntry(
          votingEscrowAbi,
          "LockPermanent",
          { _owner: ALICE, _tokenId: 9n, amount: 1n, _ts: EPOCH },
          { address: VEBTC, block: 8_000_000n, timestamp: EPOCH },
        ),
      ],
      store,
    )
    const row = [...store.activities.values()].find(
      (activity) => activity.actionType === "LOCK_PERMANENT",
    )
    expect(row?.duration).toBe(2_419_200n)
    expect(row?.postDuration).toBe(2_419_200n)
  })
})
