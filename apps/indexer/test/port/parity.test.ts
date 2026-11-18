import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import {
  BOOST_VOTER_EVENTS_ABI,
  GAUGE_EVENTS_ABI,
  MERKLE_DISTRIBUTOR_EVENTS_ABI,
  MEZO_MINTER_EVENTS_ABI,
  MUSD_SAVINGS_RATE_EVENTS_ABI,
  MUSD_TROVE_UPDATED_EVENTS_ABI,
  NON_POOLS_VOTER_EVENTS_ABI,
  PCV_EVENTS_ABI,
  POOL_EVENTS_ABI,
  POOL_FACTORY_EVENTS_ABI,
  POOLS_VOTER_EVENTS_ABI,
  REBASE_DISTRIBUTOR_EVENTS_ABI,
  SPLITTER_EVENTS_ABI,
  VOTING_ESCROW_EVENTS_ABI,
  VOTING_REWARD_EVENTS_ABI,
} from "@matchbox/chain"
import { type Abi, type AbiEvent, toEventSelector } from "viem"
import { describe, expect, it } from "vitest"
import { migrationChecksum, readMigrations } from "../../scripts/migration-lib"
import boostVoter from "../fixtures/matchbox-main-abis/boost-voter"
import bribeVotingReward from "../fixtures/matchbox-main-abis/bribe-voting-reward"
import feeVotingReward from "../fixtures/matchbox-main-abis/fee-voting-reward"
import gauge from "../fixtures/matchbox-main-abis/gauge"
import merkleDistributor from "../fixtures/matchbox-main-abis/merkle-distributor"
import mezoMinter from "../fixtures/matchbox-main-abis/mezo-minter"
import musdSavingsRate from "../fixtures/matchbox-main-abis/musd-savings-rate"
import musdTroves from "../fixtures/matchbox-main-abis/musd-troves"
import nonPoolsVoter from "../fixtures/matchbox-main-abis/non-pools-voter"
import pcv from "../fixtures/matchbox-main-abis/pcv"
import pool from "../fixtures/matchbox-main-abis/pool"
import poolFactory from "../fixtures/matchbox-main-abis/pool-factory"
import poolsVoter from "../fixtures/matchbox-main-abis/pools-voter"
import rebaseDistributor from "../fixtures/matchbox-main-abis/rebase-distributor"
import splitter from "../fixtures/matchbox-main-abis/splitter"
import votingEscrow from "../fixtures/matchbox-main-abis/voting-escrow"

// The port decodes with @matchbox/chain's ABIs instead of the indexer's own
// src/decode/abis (kept under test/fixtures/matchbox-main-abis as they were
// on Matchbox main). Handlers read decoded args by name, so every original
// event must survive the merge with its name, types, indexed flags and
// argument names, not just its topic.

function events(abi: Abi): AbiEvent[] {
  return abi.filter((item): item is AbiEvent => item.type === "event")
}

function shape(event: AbiEvent) {
  return {
    name: event.name,
    anonymous: event.anonymous ?? false,
    inputs: event.inputs.map((input) => ({
      name: input.name,
      type: input.type,
      indexed: input.indexed ?? false,
    })),
  }
}

const PAIRS: [string, Abi, Abi][] = [
  ["boost-voter", boostVoter, BOOST_VOTER_EVENTS_ABI],
  ["bribe-voting-reward", bribeVotingReward, VOTING_REWARD_EVENTS_ABI],
  ["fee-voting-reward", feeVotingReward, VOTING_REWARD_EVENTS_ABI],
  ["gauge", gauge, GAUGE_EVENTS_ABI],
  ["merkle-distributor", merkleDistributor, MERKLE_DISTRIBUTOR_EVENTS_ABI],
  ["mezo-minter", mezoMinter, MEZO_MINTER_EVENTS_ABI],
  ["musd-savings-rate", musdSavingsRate, MUSD_SAVINGS_RATE_EVENTS_ABI],
  ["musd-troves", musdTroves, MUSD_TROVE_UPDATED_EVENTS_ABI],
  ["non-pools-voter", nonPoolsVoter, NON_POOLS_VOTER_EVENTS_ABI],
  ["pcv", pcv, PCV_EVENTS_ABI],
  ["pool", pool, POOL_EVENTS_ABI],
  ["pool-factory", poolFactory, POOL_FACTORY_EVENTS_ABI],
  ["pools-voter", poolsVoter, POOLS_VOTER_EVENTS_ABI],
  ["rebase-distributor", rebaseDistributor, REBASE_DISTRIBUTOR_EVENTS_ABI],
  ["splitter", splitter, SPLITTER_EVENTS_ABI],
  ["voting-escrow", votingEscrow, VOTING_ESCROW_EVENTS_ABI],
]

describe("@matchbox/chain ABIs", () => {
  it.each(PAIRS)(
    "decode every %s event as before",
    (_name, original, ported) => {
      const byTopic = new Map(
        events(ported).map((event) => [toEventSelector(event), event]),
      )
      for (const event of events(original)) {
        const match = byTopic.get(toEventSelector(event))
        expect(match, event.name).toBeDefined()
        if (match) expect(shape(match)).toEqual(shape(event))
      }
    },
  )
})

// sha256 of each migration on Matchbox main (apps/matchbox-indexer). The
// live database's schema_migrations ledger holds these checksums, so a single
// changed byte would make scripts/migrate.ts refuse to run against it.
const MAIN_CHECKSUMS: Record<string, string> = {
  "matchbox-pro/0001_reserved_schema.sql":
    "e87287ddbe61aa788aad7b7fea57cfadefc02b2527173fd7bc1d0132deeda5ed",
  "matchbox/0001_schemas_and_foundation.sql":
    "7efdaa43661cf74906cde345d048e8615275672cf2e472bef15173a17b536438",
  "matchbox/0002_raw_logs.sql":
    "96e4c4768e91c0f1ffbaf067a197f6776f03a86036348a20ba7850f36bd8644f",
  "matchbox/0003_ingest.sql":
    "2719bb9e6f08f8ed3563779eabe8496634f3f7b8573d4d353625c3df2b622b3d",
  "matchbox/0004_projections.sql":
    "f164815b6389fc3faaef7297b920b2ba7716afe06a7cec57768870bae0fdbe9d",
  "matchbox/0005_slim_raw.sql":
    "d509850f1fc94ced161782adbba236fac0b7b7ff8377d7489653a4278f4ebde4",
  "matchbox/0006_trim_projection_indexes.sql":
    "c4d4e69b24f1e90c8a9742203b073e7d0da8adfd75f4d28d0d65d4d778c1a54b",
  "matchbox/0007_warehouse_only_rows.sql":
    "7d720dc822b5f3c761c361fd6940497ae9f8058408ea3e70ceb8819a3232a5bd",
  "matchbox/0008_reward_deposits.sql":
    "9e1de98bc98576071e5c66212ee3efc6c97150f65fe0f5751cc8f1a46e79a63c",
  "matchbox/0009_trove_updates.sql":
    "65b0d481c191f2a1f8008d0bac35a300886db8a33783b284eca602437202b7f9",
  "matchbox/0010_activity_lookup_indexes.sql":
    "54971988151a13ad26b30813ddb2a3cc9aaa0539ced2570f1d7b157ab99a29e1",
  "matchbox/0011_trove_interest_comment.sql":
    "2fd37fb5bfc48df22a12893a4ffcb9733ba906ddca120112f33fb5630e899397",
}

// Migrations after the port that do more than add tables and indexes, each
// reviewed: they add a nullable column, triggers or a NOT NULL on that
// column, never rewrite or delete a row, and the Worker before them keeps
// running on the result (its inserts name no row_seq, and the triggers
// stamp it).
const BEYOND_ADDITIVE: Record<string, string> = {
  "0013_row_seq.sql":
    "row_seq change markers and tombstone triggers on the copied tables",
  "0014_row_seq_finish.sql":
    "row_seq NOT NULL and its indexes, once every row is stamped",
  "0015_scan_stream.sql":
    "new scan stream tables, with the 0013 triggers built in a DO block",
}

// SQL with "--" comments dropped and string literals emptied, in one pass:
// a COMMENT ON string can hold "--" or ";", and a comment an apostrophe.
function withoutCommentsAndStrings(sql: string): string {
  let out = ""
  let index = 0
  while (index < sql.length) {
    const char = sql[index]
    if (char === "-" && sql[index + 1] === "-") {
      while (index < sql.length && sql[index] !== "\n") index++
    } else if (char === "'") {
      index++
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") index += 2
        else if (sql[index] === "'") break
        else index++
      }
      index++
      out += "''"
    } else {
      out += char
      index++
    }
  }
  return out
}

function migrationsDir(schema: string): string {
  return fileURLToPath(
    new URL(`../../db/migrations/${schema}/`, import.meta.url),
  )
}

describe("migrations", () => {
  it("keeps every live migration byte for byte", async () => {
    const actual: Record<string, string> = {}
    for (const schema of ["matchbox", "matchbox-pro"]) {
      for (const file of await readMigrations(migrationsDir(schema))) {
        actual[`${schema}/${file.filename}`] = file.checksum
      }
    }
    for (const [path, checksum] of Object.entries(MAIN_CHECKSUMS)) {
      expect(actual[path], path).toBe(checksum)
    }
  })

  it("only adds tables after the live set", async () => {
    const added = (await readMigrations(migrationsDir("matchbox"))).filter(
      (file) =>
        MAIN_CHECKSUMS[`matchbox/${file.filename}`] === undefined &&
        BEYOND_ADDITIVE[file.filename] === undefined,
    )
    for (const file of added) {
      const statements = withoutCommentsAndStrings(file.sql)
        .split(";")
        .map((statement) => statement.trim().replace(/\s+/g, " "))
        .filter((statement) => statement.length > 0)
      for (const statement of statements) {
        expect(statement, file.filename).toMatch(
          /^(CREATE TABLE IF NOT EXISTS|CREATE INDEX IF NOT EXISTS|COMMENT ON (TABLE|COLUMN)|DO \$grants\$|GRANT|IF|END|ELSE)/,
        )
        // GRANT ... INSERT, UPDATE, DELETE names privileges, not statements.
        if (!/\bGRANT\b/.test(statement)) {
          expect(statement, file.filename).not.toMatch(
            /\b(ALTER|DROP|TRUNCATE|DELETE|UPDATE)\b/i,
          )
        }
      }
    }
  })

  it("never deletes or rewrites rows in the reviewed migrations", async () => {
    const files = (await readMigrations(migrationsDir("matchbox"))).filter(
      (file) => BEYOND_ADDITIVE[file.filename] !== undefined,
    )
    expect(files.map((file) => file.filename)).toEqual(
      Object.keys(BEYOND_ADDITIVE),
    )
    for (const file of files) {
      // Strings kept: 0013 builds its DDL with format().
      const sql = file.sql.replace(/--[^\n]*/g, "")
      expect(sql, file.filename).not.toMatch(
        /\b(DELETE\s+FROM|UPDATE\s+matchbox|TRUNCATE\s+(TABLE\s+)?matchbox|DROP\s+(TABLE|COLUMN|SCHEMA|SEQUENCE)|TYPE\s+\w+\s+USING|SET\s+DATA\s+TYPE)\b/i,
      )
    }
  })

  it("checksums the file contents", async () => {
    const path = `${migrationsDir("matchbox")}0001_schemas_and_foundation.sql`
    expect(migrationChecksum(await readFile(path, "utf8"))).toBe(
      MAIN_CHECKSUMS["matchbox/0001_schemas_and_foundation.sql"],
    )
  })
})
