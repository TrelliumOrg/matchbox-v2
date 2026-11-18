import type { NetworkSlug } from "@matchbox/contracts/network"
import {
  gaugeDirectorySchema,
  gaugeFundingSchema,
  gaugeHistorySchema,
  gaugeProfileReadModelSchema,
  protocolActivitySchema,
  protocolEpochSchema,
  protocolHistorySchema,
  protocolSchema,
  type ReadModelMeta,
  type ReadModelSource,
  walletActivitySchema,
  walletOverviewSchema,
  walletRewardsSchema,
} from "@matchbox/contracts/read-models"
import { z } from "zod"

// The `read_models` table: one validated JSON document per read model.
// matchbox-jobs (and the API's market cron, for gauges) write; the API's
// request path reads. Shared by both Workers through `@matchbox/api/read-store`. The table
// itself is created by apps/jobs/migrations.

export const readModelSchemas = {
  "wallet-overview": walletOverviewSchema,
  "wallet-rewards": walletRewardsSchema,
  "wallet-activity": walletActivitySchema,
  protocol: protocolSchema,
  "protocol-epoch": protocolEpochSchema,
  "protocol-activity": protocolActivitySchema,
  "protocol-history": protocolHistorySchema,
  gauges: gaugeDirectorySchema,
  "gauge-profile": gaugeProfileReadModelSchema,
  "gauge-history": gaugeHistorySchema,
  "gauge-funding": gaugeFundingSchema,
} as const

export type ReadModelKind = keyof typeof readModelSchemas

export type ReadModelData<Kind extends ReadModelKind> = z.output<
  (typeof readModelSchemas)[Kind]
>

/** The schema of one kind, typed by that kind (TypeScript cannot narrow a
 * union of schemas by a generic key on its own). */
function schemaFor<Kind extends ReadModelKind>(
  kind: Kind,
): z.ZodType<ReadModelData<Kind>> {
  const schema: z.ZodType = readModelSchemas[kind]
  return schema as z.ZodType<ReadModelData<Kind>>
}

/** Singletons use this key; wallet and gauge documents use the address. */
export const currentKey = "current"

/** The slice of D1 the store needs (a real D1Database satisfies it). */
export type ReadDatabase = Pick<D1Database, "prepare" | "batch">

export type StoredReadModel<Kind extends ReadModelKind> = {
  data: ReadModelData<Kind>
  meta: ReadModelMeta
  etag: string
}

export type ReadModelWrite<Kind extends ReadModelKind> = {
  network: NetworkSlug
  kind: Kind
  key: string
  data: ReadModelData<Kind>
  block: number
  source: ReadModelSource
  updatedAt: number
}

/** True for keys that hold a USD value ("usd", "totalUsd", "changeUsd"). */
function isUsdKey(key: string): boolean {
  return key === "usd" || key.endsWith("Usd")
}

/**
 * The document without its USD values, in a stable key order. USD values
 * move with every price tick; the API reprices current values at read time,
 * so they never force a rewrite on their own.
 */
export function priceFreeCanonical(value: unknown): string {
  return JSON.stringify(value, function replacer(key, inner: unknown) {
    if (isUsdKey(key)) return undefined
    if (inner !== null && typeof inner === "object" && !Array.isArray(inner)) {
      const sorted: Record<string, unknown> = {}
      for (const name of Object.keys(inner).sort()) {
        sorted[name] = Reflect.get(inner, name)
      }
      return sorted
    }
    return inner
  })
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

/** Strong ETag value (without quotes) for a document's price-free content. */
export function readModelEtag(data: unknown): Promise<string> {
  return sha256Hex(priceFreeCanonical(data)).then((hex) => hex.slice(0, 32))
}

/**
 * One upsert statement. The row is only rewritten when the etag changed, so
 * an unchanged document costs no D1 row write.
 */
export async function readModelStatement<Kind extends ReadModelKind>(
  db: ReadDatabase,
  write: ReadModelWrite<Kind>,
): Promise<D1PreparedStatement> {
  const data = schemaFor(write.kind).parse(write.data)
  const etag = await readModelEtag(data)
  return db
    .prepare(
      `INSERT INTO read_models
         (network, kind, doc_key, body, etag, block, source, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT (network, kind, doc_key) DO UPDATE SET
         body = excluded.body,
         etag = excluded.etag,
         block = excluded.block,
         source = excluded.source,
         updated_at = excluded.updated_at
       WHERE read_models.etag <> excluded.etag`,
    )
    .bind(
      write.network,
      write.kind,
      write.key,
      JSON.stringify(data),
      etag,
      write.block,
      write.source,
      write.updatedAt,
    )
}

/** D1 accepts this many statements per batch comfortably. */
const batchSize = 50

export type WriteOptions = {
  /**
   * Kinds whose documents rarely change between writes. Their stored etags
   * are read first (one query a kind) and a document whose etag is the
   * same is not sent at all.
   *
   * The upsert already leaves an unchanged row alone, but the statement
   * still goes to D1. The warehouse snapshot wrote 930 documents a run, of
   * which 767 were gauge histories and 49 protocol epochs that had not
   * changed, and that was 8.6 s of a 12.3 s run (12 Nov 2026).
   */
  skipUnchanged?: readonly ReadModelKind[]
}

/** The stored etag of every document of a kind, by key. */
async function storedEtags(
  db: ReadDatabase,
  network: string,
  kind: ReadModelKind,
): Promise<Map<string, string>> {
  const { results } = await db
    .prepare(
      "SELECT doc_key, etag FROM read_models WHERE network = ?1 AND kind = ?2",
    )
    .bind(network, kind)
    .all<{ doc_key: string; etag: string }>()
  return new Map(results.map((row) => [row.doc_key, row.etag]))
}

/**
 * Leaves out the documents of the `skipUnchanged` kinds whose stored etag
 * already matches. If the etags cannot be read, everything is written, as
 * before.
 */
async function withoutUnchanged(
  db: ReadDatabase,
  writes: ReadModelWrite<ReadModelKind>[],
  kinds: readonly ReadModelKind[],
): Promise<ReadModelWrite<ReadModelKind>[]> {
  const stored = new Map<string, Map<string, string>>()
  for (const write of writes) {
    const scope = `${write.network}:${write.kind}`
    if (!kinds.includes(write.kind) || stored.has(scope)) continue
    try {
      stored.set(scope, await storedEtags(db, write.network, write.kind))
    } catch {
      return writes
    }
  }
  const kept: ReadModelWrite<ReadModelKind>[] = []
  for (const write of writes) {
    const known = stored.get(`${write.network}:${write.kind}`)?.get(write.key)
    if (known === undefined) {
      kept.push(write)
      continue
    }
    const data = schemaFor(write.kind).parse(write.data)
    if ((await readModelEtag(data)) !== known) kept.push(write)
  }
  return kept
}

/** Writes documents; returns how many rows actually changed. */
export async function writeReadModels(
  db: ReadDatabase,
  all: ReadModelWrite<ReadModelKind>[],
  options: WriteOptions = {},
): Promise<number> {
  const writes =
    options.skipUnchanged === undefined || options.skipUnchanged.length === 0
      ? all
      : await withoutUnchanged(db, all, options.skipUnchanged)
  let changed = 0
  for (let start = 0; start < writes.length; start += batchSize) {
    const statements = await Promise.all(
      writes
        .slice(start, start + batchSize)
        .map((write) => readModelStatement(db, write)),
    )
    const results = await db.batch(statements)
    for (const result of results) changed += result.meta.changes
  }
  return changed
}

/**
 * Replaces one document, but only if it is still the one that was read
 * (`expectedEtag`). For a writer that patches a document another writer
 * rebuilds: whichever read first does not overwrite the other's work.
 * Returns whether the row was written.
 */
export async function replaceReadModel<Kind extends ReadModelKind>(
  db: ReadDatabase,
  write: ReadModelWrite<Kind>,
  expectedEtag: string,
): Promise<boolean> {
  const data = schemaFor(write.kind).parse(write.data)
  const etag = await readModelEtag(data)
  if (etag === expectedEtag) return false
  const result = await db
    .prepare(
      `UPDATE read_models
         SET body = ?4, etag = ?5, block = ?6, source = ?7, updated_at = ?8
       WHERE network = ?1 AND kind = ?2 AND doc_key = ?3 AND etag = ?9`,
    )
    .bind(
      write.network,
      write.kind,
      write.key,
      JSON.stringify(data),
      etag,
      write.block,
      write.source,
      write.updatedAt,
      expectedEtag,
    )
    .run()
  return result.meta.changes > 0
}

const rowSchema = z.object({
  body: z.string(),
  etag: z.string(),
  block: z.number().int(),
  source: z.enum(["warehouse", "live", "fixture"]),
  updated_at: z.number().int(),
})

/** Reads and validates one document; null when absent. */
export async function readReadModel<Kind extends ReadModelKind>(
  db: ReadDatabase,
  network: NetworkSlug,
  kind: Kind,
  key: string,
): Promise<StoredReadModel<Kind> | null> {
  const row = await db
    .prepare(
      `SELECT body, etag, block, source, updated_at FROM read_models
       WHERE network = ?1 AND kind = ?2 AND doc_key = ?3`,
    )
    .bind(network, kind, key)
    .first()
  if (row === null) return null
  const parsed = rowSchema.parse(row)
  const body: unknown = JSON.parse(parsed.body)
  const data = schemaFor(kind).parse(body)
  return {
    data,
    etag: parsed.etag,
    meta: {
      network,
      source: parsed.source,
      block: parsed.block,
      updatedAt: parsed.updated_at,
    },
  }
}
