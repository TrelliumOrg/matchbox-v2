import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { activityExtraSchema } from "@matchbox/contracts/scan"
import { z } from "zod"
import type { QueryRunner } from "../../warehouse/reader"
import { parseJson } from "../transform"
import {
  activityFixture,
  contractFixture,
  depositFixture,
  enclaveFixture,
  gaugeG,
  lockFixture,
  morphoFixture,
  poolP,
  troveFixture,
} from "./fixture"

// A PGlite warehouse (Postgres in WebAssembly, in process) with the
// indexer's own migrations and the fixture's rows in its tables. Tests use
// it in place of Neon; nothing here talks to a network.

const migrationsDir = path.resolve(
  import.meta.dirname,
  "../../../../indexer/db/migrations/matchbox",
)

const arraySchema = z.array(z.string())

/** READ ONLY transaction, as neonQueryRunner runs them. */
export function pgliteRunner(database: PGlite): QueryRunner {
  return async function run(queries) {
    return database.transaction(async (tx) => {
      await tx.query("SET TRANSACTION READ ONLY")
      const results: unknown[][] = []
      for (const query of queries) {
        const result = await tx.query(query.text, query.params)
        results.push(result.rows)
      }
      return results
    })
  }
}

async function insert(db: PGlite, table: string, row: Record<string, unknown>) {
  const columns = Object.keys(row)
  await db.query(
    `INSERT INTO ${table} (${columns.join(", ")})
     VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})`,
    Object.values(row),
  )
}

/** Extra columns the activity fixture carries in its JSON. */
const extraColumns = [
  "metadata",
  "first_recipient_amount",
  "second_recipient_amount",
  "period",
  "emission",
  "rebase",
  "rewards",
  "total_supply",
]

/** A fresh warehouse holding the fixture. */
export async function fixtureWarehouse(): Promise<PGlite> {
  const db = new PGlite()
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
  for (const file of files) {
    await db.exec(readFileSync(path.join(migrationsDir, file), "utf8"))
  }
  for (const row of activityFixture) {
    const extra = parseJson(activityExtraSchema, row.extra)
    await insert(db, "matchbox.activity_events", {
      network: "mezo",
      id: row.id,
      action_type: row.action_type,
      boost_context:
        typeof extra.boost_context === "string"
          ? extra.boost_context
          : "UNKNOWN",
      source: row.source,
      tx_hash: row.tx_hash,
      tx_from: row.tx_from,
      log_index: row.log_index,
      block_number: row.block_number,
      timestamp: row.timestamp,
      actor: row.actor,
      recipient: row.recipient,
      token_id: row.token_id,
      amount: row.amount,
      token: row.token,
      gauge: row.raw_gauge,
      // A vote names its pool in `gauge`; the SQL maps it back.
      pool: row.raw_gauge === poolP && row.gauge === gaugeG ? null : row.pool,
      reward_contract: row.reward_contract,
      weight: row.weight,
      contract_address: row.contract_address,
      decoder_version: 2,
      ...Object.fromEntries(
        extraColumns.flatMap((column) => {
          const value = extra[column]
          return value === undefined ? [] : [[column, value]]
        }),
      ),
    })
  }
  for (const row of lockFixture) {
    await insert(db, "matchbox.lock_positions", {
      network: "mezo",
      id: `${row.contract_address}-${row.token_id}`,
      ...row,
    })
  }
  for (const row of depositFixture) {
    await insert(db, "matchbox.reward_deposits", {
      network: "mezo",
      decoder_version: 2,
      ...row,
    })
  }
  for (const row of troveFixture) {
    await insert(db, "matchbox.trove_updates", {
      network: "mezo",
      decoder_version: 2,
      ...row,
    })
  }
  for (const row of morphoFixture) {
    await insert(db, "matchbox.morpho_events", {
      network: "mezo",
      decoder_version: 1,
      ...row,
    })
  }
  for (const row of enclaveFixture) {
    const { pledged_ve_btc: pledged, ...rest } = row
    await insert(db, "matchbox.enclave_events", {
      network: "mezo",
      decoder_version: 1,
      pledged_ve_btc: parseJson(arraySchema, pledged),
      ...rest,
    })
  }
  for (const row of contractFixture) {
    await insert(db, "matchbox.contracts", {
      network: "mezo",
      address: row.address,
      kind: row.kind,
      template: row.template,
      pool: row.pool,
      gauge: row.gauge,
      created_block: 100,
      discovered_at: row.discovered_at,
    })
  }
  return db
}
