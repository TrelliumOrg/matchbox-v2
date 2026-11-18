import { fileURLToPath } from "node:url"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import { readMigrations } from "../../scripts/migration-lib"
import { ROLE_SQL } from "../../scripts/role-sql"

// The sequence-visibility hazard needs two connections with transactions in
// flight at once, so it runs on a real Postgres, never Neon:
//
//   MATCHBOX_TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres \
//     pnpm --filter @matchbox/indexer exec vitest run test/row-seq
//
// The URL names a server where the test may create (and then drops) a
// scratch database and two login roles, which log in without a password
// (trust auth). Without it the suite is skipped; CI runs it against a
// Postgres 18 service in the check job (.github/workflows/ci.yml).

const ADMIN_URL = process.env.MATCHBOX_TEST_DATABASE_URL
// CI sets this with the URL (.github/workflows/ci.yml), so a lost URL fails
// the step instead of skipping the suite.
if (process.env.MATCHBOX_REQUIRE_PG_TESTS === "1" && ADMIN_URL === undefined) {
  throw new Error(
    "MATCHBOX_REQUIRE_PG_TESTS is set but MATCHBOX_TEST_DATABASE_URL is not",
  )
}
const DATABASE = `matchbox_row_seq_${process.pid}`
const MIGRATIONS = fileURLToPath(
  new URL("../../db/migrations/matchbox/", import.meta.url),
)

function urlFor(database: string, user?: string): string {
  const url = new URL(ADMIN_URL ?? "postgres://localhost/postgres")
  url.pathname = `/${database}`
  if (user !== undefined) {
    url.username = user
    url.password = ""
  }
  return url.toString()
}

async function connect(user?: string): Promise<Client> {
  const client = new Client({ connectionString: urlFor(DATABASE, user) })
  await client.connect()
  return client
}

const seqRowSchema = z.object({ key: z.string(), row_seq: z.string() })

/** A reader that keeps one checkpoint, as the copy step does. */
class Reader {
  checkpoint = 0n
  readonly seen = new Map<string, bigint>()

  constructor(
    private readonly client: Client,
    private readonly sql: string,
  ) {}

  async read(): Promise<string[]> {
    const result = await this.client.query(this.sql, [
      this.checkpoint.toString(),
    ])
    const rows = z.array(seqRowSchema).parse(result.rows)
    for (const row of rows) {
      const seq = BigInt(row.row_seq)
      this.seen.set(row.key, seq)
      if (seq > this.checkpoint) this.checkpoint = seq
    }
    return rows.map((row) => row.key)
  }
}

async function waitingOnAdvisoryLock(admin: Client): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await admin.query(
      `SELECT count(*)::int AS waiting FROM pg_locks
       WHERE locktype = 'advisory' AND NOT granted
         AND classid = 1835167608 AND objid = 1919907699`,
    )
    if (
      z.array(z.object({ waiting: z.number() })).parse(result.rows)[0]?.waiting
    ) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return false
}

function contractInsert(address: string): string {
  return `INSERT INTO matchbox.contracts (network, address, kind, template, created_block)
          VALUES ('mezo', '${address}', 'pool', 'Pool', 1)`
}

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`

describe.skipIf(ADMIN_URL === undefined)("row_seq on a real Postgres", () => {
  let admin: Client

  beforeAll(async () => {
    const server = new Client({ connectionString: ADMIN_URL })
    await server.connect()
    await server.query(`DROP DATABASE IF EXISTS ${DATABASE}`)
    await server.query(`CREATE DATABASE ${DATABASE}`)
    await server.end()
    admin = await connect()
    for (const migration of await readMigrations(MIGRATIONS)) {
      await admin.query("BEGIN")
      await admin.query(migration.sql)
      await admin.query("COMMIT")
    }
    // The runner's ledger (scripts/migrate.ts), which ROLE_SQL revokes.
    await admin.query(
      `CREATE TABLE matchbox.schema_migrations (filename text PRIMARY KEY,
         checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
    )
    await admin.query(ROLE_SQL)
    for (const [login, group] of [
      ["matchbox_test_writer", "matchbox_indexer"],
      ["matchbox_test_reader", "matchbox_api_ro"],
    ] as const) {
      await admin.query(
        `DO $$ BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${login}') THEN
             CREATE ROLE ${login} LOGIN IN ROLE ${group};
           END IF;
         END $$`,
      )
    }
    await admin.query(`GRANT CONNECT ON DATABASE ${DATABASE} TO PUBLIC`)
  })

  afterAll(async () => {
    await admin?.end()
    const server = new Client({ connectionString: ADMIN_URL })
    await server.connect()
    await server.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`)
    await server.end()
  })

  it("loses a row with a bare sequence: the hazard the lock prevents", async () => {
    await admin.query("CREATE SEQUENCE public.bare_seq")
    await admin.query(
      `CREATE TABLE public.bare (key text PRIMARY KEY,
         row_seq bigint NOT NULL DEFAULT nextval('public.bare_seq'))`,
    )
    const first = await connect()
    const second = await connect()
    const reader = new Reader(
      admin,
      `SELECT key, row_seq::text AS row_seq FROM public.bare
       WHERE row_seq > $1::bigint ORDER BY row_seq`,
    )
    await first.query("BEGIN")
    await first.query("INSERT INTO public.bare (key) VALUES ('early')")
    await second.query("BEGIN")
    await second.query("INSERT INTO public.bare (key) VALUES ('late')")
    await second.query("COMMIT")
    expect(await reader.read()).toEqual(["late"])
    await first.query("COMMIT")
    expect(await reader.read()).toEqual([])
    expect(reader.seen.has("early")).toBe(false)
    await first.end()
    await second.end()
  })

  it("serializes stamping writers, so a reader never skips an in-flight stamp", async () => {
    const first = await connect("matchbox_test_writer")
    const second = await connect("matchbox_test_writer")
    const reader = new Reader(
      admin,
      `SELECT address AS key, row_seq::text AS row_seq FROM matchbox.contracts
       WHERE network = 'mezo' AND row_seq > $1::bigint ORDER BY row_seq`,
    )
    await first.query("BEGIN")
    await first.query(contractInsert(address(1)))
    await second.query("BEGIN")
    const blocked = second.query(contractInsert(address(2)))
    expect(await waitingOnAdvisoryLock(admin)).toBe(true)
    expect(await reader.read()).toEqual([])
    await first.query("COMMIT")
    await blocked
    // Between the two commits the reader sees the first row only, and its
    // checkpoint stays below the second's stamp.
    expect(await reader.read()).toEqual([address(1)])
    await second.query("COMMIT")
    expect(await reader.read()).toEqual([address(2)])
    await first.end()
    await second.end()
  })

  it("hands an interleaved stress run's every final row to a polling reader", async () => {
    const writers = await Promise.all(
      [0, 1, 2, 3].map(() => connect("matchbox_test_writer")),
    )
    const reader = new Reader(
      admin,
      `SELECT address AS key, row_seq::text AS row_seq FROM matchbox.contracts
       WHERE network = 'mezo' AND row_seq > $1::bigint ORDER BY row_seq`,
    )
    let done = false
    const polling = (async () => {
      while (!done) await reader.read()
    })()
    const pause = () =>
      new Promise((resolve) => setTimeout(resolve, Math.random() * 4))
    await Promise.all(
      writers.map(async (writer, w) => {
        for (let t = 0; t < 40; t++) {
          await writer.query("BEGIN")
          const base = 1000 + w * 1000 + t * 2
          await writer.query(contractInsert(address(base)))
          await pause()
          // Change a row another writer may have stamped already.
          await writer.query(
            `UPDATE matchbox.contracts SET gauge = $1
             WHERE address = $2`,
            [address(base), address(1000 + ((w + 1) % 4) * 1000 + t * 2)],
          )
          await pause()
          await writer.query(contractInsert(address(base + 1)))
          await writer.query("COMMIT")
        }
      }),
    )
    done = true
    await polling
    await reader.read()
    const final = await admin.query(
      `SELECT address AS key, row_seq::text AS row_seq FROM matchbox.contracts
       WHERE network = 'mezo'`,
    )
    const missed = z
      .array(seqRowSchema)
      .parse(final.rows)
      .filter((row) => reader.seen.get(row.key) !== BigInt(row.row_seq))
    expect(missed).toEqual([])
    await Promise.all(writers.map((writer) => writer.end()))
  })

  it("lets the indexer role stamp and tombstone, and the reader role only read", async () => {
    const writer = await connect("matchbox_test_writer")
    await writer.query(contractInsert(address(99)))
    await writer.query(
      `DELETE FROM matchbox.contracts WHERE address = '${address(99)}'`,
    )
    await writer.end()
    const reader = await connect("matchbox_test_reader")
    const tombstones = await reader.query(
      `SELECT row_key FROM matchbox.deleted_rows
       WHERE table_name = 'contracts' AND kind = 'row'`,
    )
    expect(tombstones.rows).toEqual([{ row_key: { address: address(99) } }])
    await expect(
      reader.query("SELECT nextval('matchbox.row_seq')"),
    ).rejects.toThrow(/permission denied/)
    await expect(
      reader.query(
        "INSERT INTO matchbox.deleted_rows (table_name, kind) VALUES ('x', 'reset')",
      ),
    ).rejects.toThrow(/permission denied/)
    await reader.end()
  })
})
