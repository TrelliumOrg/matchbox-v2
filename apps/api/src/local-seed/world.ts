import type { NetworkSlug } from "@matchbox/contracts/network"
import type { ActivityRow } from "@matchbox/contracts/read-models"
import {
  demoActivityRows,
  demoBlock,
  demoGaugeDirectory,
  demoGaugeProfile,
  demoNow,
  demoPrices,
  demoProtocol,
  demoProtocolEpoch,
  demoProtocolHistory,
  demoWallet,
  demoWalletOverview,
  demoWalletRewards,
  demoWatchList,
} from "@matchbox/contracts/read-models/fixtures"
import { pricesKvKey } from "../read-models/prices-kv"
import {
  currentKey,
  type ReadModelKind,
  type ReadModelWrite,
  writeReadModels,
} from "../read-models/store"
import {
  type HistoryState,
  historyRowStatements,
  historyStateStatement,
} from "../read-models/wallet-history"
import { addWatchItem } from "../read-models/watchlist"
import {
  recordRun,
  scanNow,
  seedRead,
  seedScan,
  writeStatus,
} from "../scan/fixtures"

// The local fixture world: what `pnpm db:seed:local` writes into the API's
// local D1 databases and KV so `/internal/pro/*` and `/internal/scan/*`
// answer from data on a machine with no credentials. Nothing here is new
// data:
//
// - READ_DB documents are the shared "Epoch 47" demo read models
//   (@matchbox/contracts/read-models/fixtures), the ones Pro
//   (PRO_DATA=fixtures), Matchscan (SCAN_DATA=fixtures) and Stuart's tests
//   render.
// - The demo wallet's stored history (wallet_activity_rows), so its
//   Activity pages past its document as a busy wallet's do: the same demo
//   rows, written with the statements the jobs Worker's warehouse
//   snapshot uses (apps/jobs/src/warehouse/history.ts).
// - SCAN_DB rows, and the READ_DB trove, Morpho and Stability Pool rows,
//   are the /internal/scan test fixtures (src/scan/fixtures.ts).
// - PRICES holds the demo prices under the key matchbox-jobs writes.
//
// Every step clears what it writes first, so a second run gives the same
// state. Local tooling and tests only; never imported by the Worker.

/** The network every fixture document is written for. */
export const seedNetwork: NetworkSlug = "mezo"

/** The client id the seeded watch list items carry. */
export const seedClientId = "local-seed"

/**
 * The demo wallet's rows its stored `wallet-activity` document holds: all
 * but the two oldest (the Epoch 44 and 43 claims), which are only in the
 * stored history, so the document's last page offers the earlier epochs.
 */
export const seedDocumentRows: ActivityRow[] = demoActivityRows.slice(0, -2)

/**
 * The demo wallet's stored history: every mined row, newest first. The
 * pending vote has no block yet, and the warehouse stores mined rows only.
 */
export const seedHistoryRows: ActivityRow[] = demoActivityRows.filter(
  (row) => row.block !== null,
)

/** Every read model document of the fixture world. */
export function fixtureReadModels(): ReadModelWrite<ReadModelKind>[] {
  const base = {
    network: seedNetwork,
    block: demoBlock,
    source: "fixture" as const,
    updatedAt: demoNow,
  }
  return [
    {
      ...base,
      kind: "wallet-overview",
      key: demoWallet,
      data: demoWalletOverview,
    },
    {
      ...base,
      kind: "wallet-rewards",
      key: demoWallet,
      data: demoWalletRewards,
    },
    {
      ...base,
      kind: "wallet-activity",
      key: demoWallet,
      data: { address: demoWallet, rows: seedDocumentRows, nextCursor: null },
    },
    { ...base, kind: "protocol", key: currentKey, data: demoProtocol },
    {
      ...base,
      kind: "protocol-activity",
      key: currentKey,
      data: { rows: demoProtocol.feed.rows },
    },
    {
      ...base,
      kind: "protocol-history",
      key: currentKey,
      data: demoProtocolHistory,
    },
    {
      ...base,
      kind: "protocol-epoch",
      key: String(demoProtocolEpoch.epoch.number),
      data: demoProtocolEpoch,
    },
    { ...base, kind: "gauges", key: currentKey, data: demoGaugeDirectory },
    {
      ...base,
      kind: "gauge-profile",
      key: demoGaugeProfile.card.gauge.address,
      data: demoGaugeProfile,
    },
  ]
}

/** The bindings the seed writes, as the API's wrangler config names them. */
export type SeedBindings = {
  READ_DB: D1Database
  SCAN_DB: D1Database
  PRICES: KVNamespace
}

export type SeedSummary = {
  readModels: number
  watchItems: number
  historyRows: number
  scanActivityRows: number
}

/** Where the demo wallet's stored history starts and ends: all of it. */
export function seedHistoryState(): HistoryState {
  const newest = seedHistoryRows.at(0)
  const oldest = seedHistoryRows.at(-1)
  if (newest === undefined || oldest === undefined) {
    throw new Error("the demo wallet has no mined activity")
  }
  return {
    low: { ts: oldest.timestamp, tx: oldest.txHash },
    high: { ts: newest.timestamp, tx: newest.txHash },
    complete: true,
    updatedAt: demoNow,
  }
}

/**
 * Writes the fixture world. Assumes the migrations are applied
 * (apps/jobs/migrations, with 0007's wallet history tables, and
 * apps/api/read-db-migrations on READ_DB,
 * apps/jobs/scan-migrations on SCAN_DB).
 */
export async function seedLocalWorld(
  bindings: SeedBindings,
): Promise<SeedSummary> {
  const { READ_DB: readDb, SCAN_DB: scanDb, PRICES: prices } = bindings

  // Matchscan: the scan test rows, a finished copy run and a healthy status
  // row, as the jobs Worker leaves them.
  await seedScan(scanDb)
  await recordRun(scanDb, scanNow)
  await writeStatus(scanDb)

  // Trove, Morpho and Stability Pool rows for /internal/scan/borrow. It
  // also writes two read models as "warehouse"; they are replaced below so
  // every document says where it came from.
  await seedRead(readDb)
  await readDb.prepare("DELETE FROM read_models").run()
  const readModels = await writeReadModels(readDb, fixtureReadModels())

  await readDb
    .prepare("DELETE FROM watch_items WHERE network = ?1 AND owner = ?2")
    .bind(seedNetwork, demoWatchList.owner)
    .run()
  for (const item of demoWatchList.items) {
    await addWatchItem(readDb, {
      network: seedNetwork,
      owner: demoWatchList.owner,
      kind: item.kind,
      address: item.address,
      clientId: seedClientId,
      nowSeconds: item.addedAt,
    })
  }

  // The demo wallet's stored history, replaced whole.
  await readDb.batch([
    readDb
      .prepare(
        "DELETE FROM wallet_activity_rows WHERE network = ?1 AND wallet = ?2",
      )
      .bind(seedNetwork, demoWallet),
    ...(await historyRowStatements(
      readDb,
      seedNetwork,
      demoWallet,
      seedHistoryRows,
      demoNow,
    )),
    historyStateStatement(readDb, seedNetwork, demoWallet, seedHistoryState()),
  ])

  await prices.put(pricesKvKey, JSON.stringify(demoPrices))

  const activity = await scanDb
    .prepare("SELECT count(*) AS n FROM activity")
    .first<{ n: number }>()
  return {
    readModels,
    watchItems: demoWatchList.items.length,
    historyRows: seedHistoryRows.length,
    scanActivityRows: activity?.n ?? 0,
  }
}
