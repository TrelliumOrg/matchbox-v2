import { z } from "zod"
import type { ReadDatabase } from "../store"

// The `avatar_colors` table (apps/api/read-db-migrations): one row per
// avatar URL and profile `updated_at`, so each picture is decoded once and
// again only when either changes.

export type AvatarColorKey = { url: string; profileUpdatedAt: string }

export type AvatarColorRow = AvatarColorKey &
  (
    | { status: "ok"; color: string; detail: "brand" | "dominant" }
    | { status: "failed"; color: null; detail: string }
  ) & {
    /** Unix seconds. */
    extractedAt: number
  }

const rowSchema = z.object({
  url: z.string(),
  profile_updated_at: z.string(),
  status: z.enum(["ok", "failed"]),
  color: z
    .string()
    .regex(/^#[0-9A-F]{6}$/)
    .nullable(),
  detail: z.string(),
  extracted_at: z.number().int(),
})

export function cacheKey({ url, profileUpdatedAt }: AvatarColorKey): string {
  return `${profileUpdatedAt} ${url}`
}

/** Every cached row; malformed rows are dropped. */
export async function readAvatarColors(
  db: ReadDatabase,
): Promise<AvatarColorRow[]> {
  const result = await db
    .prepare(
      "SELECT url, profile_updated_at, status, color, detail, extracted_at FROM avatar_colors",
    )
    .all()
  const rows: AvatarColorRow[] = []
  for (const raw of result.results) {
    const parsed = rowSchema.safeParse(raw)
    if (!parsed.success) continue
    const row = parsed.data
    const key = { url: row.url, profileUpdatedAt: row.profile_updated_at }
    if (row.status === "ok") {
      if (row.color === null) continue
      if (row.detail !== "brand" && row.detail !== "dominant") continue
      rows.push({
        ...key,
        status: "ok",
        color: row.color,
        detail: row.detail,
        extractedAt: row.extracted_at,
      })
    } else {
      rows.push({
        ...key,
        status: "failed",
        color: null,
        detail: row.detail,
        extractedAt: row.extracted_at,
      })
    }
  }
  return rows
}

/** Upserts `rows` and deletes `stale` keys in one batch. */
export async function writeAvatarColors(
  db: ReadDatabase,
  rows: readonly AvatarColorRow[],
  stale: readonly AvatarColorKey[],
): Promise<void> {
  const statements = [
    ...rows.map((row) =>
      db
        .prepare(
          "INSERT OR REPLACE INTO avatar_colors (url, profile_updated_at, status, color, detail, extracted_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(
          row.url,
          row.profileUpdatedAt,
          row.status,
          row.color,
          row.detail,
          row.extractedAt,
        ),
    ),
    ...stale.map((key) =>
      db
        .prepare(
          "DELETE FROM avatar_colors WHERE url = ? AND profile_updated_at = ?",
        )
        .bind(key.url, key.profileUpdatedAt),
    ),
  ]
  if (statements.length > 0) await db.batch(statements)
}
