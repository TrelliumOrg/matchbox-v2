import type { NetworkSlug } from "@matchbox/contracts/network"
import {
  type WatchKind,
  type WatchList,
  watchKindSchema,
  watchListLimit,
} from "@matchbox/contracts/read-models"
import { z } from "zod"
import type { ReadDatabase } from "./store"

// Watch lists in READ_DB (`watch_items`, apps/jobs/migrations/0002). Reads
// and writes are single statements; a write costs one D1 row write.
// TODO(matchbox-id): writes carry an unsigned client id; require a signed-in
// Matchbox ID session and key lists by account once ID ships.

const itemRowSchema = z.object({
  kind: watchKindSchema,
  address: z.string(),
  added_at: z.number().int(),
})

export async function readWatchList(
  db: ReadDatabase,
  network: NetworkSlug,
  owner: string,
): Promise<WatchList> {
  const result = await db
    .prepare(
      `SELECT kind, address, added_at FROM watch_items
       WHERE network = ?1 AND owner = ?2
       ORDER BY added_at DESC, address
       LIMIT ?3`,
    )
    .bind(network, owner, watchListLimit)
    .all()
  const rows = z.array(itemRowSchema).parse(result.results)
  return {
    owner,
    items: rows.map((row) => ({
      kind: row.kind,
      address: row.address,
      addedAt: row.added_at,
    })),
  }
}

export type WatchWrite = {
  network: NetworkSlug
  owner: string
  kind: WatchKind
  address: string
  clientId: string
  nowSeconds: number
}

export type AddWatchResult = "added" | "exists" | "full"

/** Adds an item unless present or the list is full. */
export async function addWatchItem(
  db: ReadDatabase,
  write: WatchWrite,
): Promise<AddWatchResult> {
  const result = await db
    .prepare(
      `INSERT INTO watch_items
         (network, owner, kind, address, added_at, client_id)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE (SELECT count(*) FROM watch_items
              WHERE network = ?1 AND owner = ?2) < ?7
       ON CONFLICT (network, owner, kind, address) DO NOTHING`,
    )
    .bind(
      write.network,
      write.owner,
      write.kind,
      write.address,
      write.nowSeconds,
      write.clientId,
      watchListLimit,
    )
    .run()
  if (result.meta.changes > 0) return "added"
  const exists = await db
    .prepare(
      `SELECT 1 AS present FROM watch_items
       WHERE network = ?1 AND owner = ?2 AND kind = ?3 AND address = ?4`,
    )
    .bind(write.network, write.owner, write.kind, write.address)
    .first()
  return exists === null ? "full" : "exists"
}

export async function removeWatchItem(
  db: ReadDatabase,
  write: Omit<WatchWrite, "clientId" | "nowSeconds">,
): Promise<boolean> {
  const result = await db
    .prepare(
      `DELETE FROM watch_items
       WHERE network = ?1 AND owner = ?2 AND kind = ?3 AND address = ?4`,
    )
    .bind(write.network, write.owner, write.kind, write.address)
    .run()
  return result.meta.changes > 0
}

/** Queues a wallet for the next warehouse snapshot (once per wallet). */
export async function requestWallet(
  db: ReadDatabase,
  network: NetworkSlug,
  wallet: string,
  nowSeconds: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO wallet_requests (network, wallet, requested_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT (network, wallet) DO NOTHING`,
    )
    .bind(network, wallet, nowSeconds)
    .run()
}
