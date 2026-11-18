import { z } from "zod"

/**
 * Several of the API's activity-by-action lists (`/activity/action/{a}`,
 * newest first, each with its own opaque cursor) as one newest-first list,
 * paged without gaps or repeats. The API's cursors cannot start mid-page,
 * so each list's place is its cursor plus how many rows of that page were
 * already shown (`skip`): a page re-reads from the cursor and drops them.
 *
 * Rows are merged only down to the newest of the "last rows read" among
 * lists that have more: anything older could sit after rows of that list
 * not read yet, so it waits for the next page. Every page shows at least
 * one row while any list has rows.
 */

/** One list's place: its cursor (null at its start), rows of that page shown. */
export type SourcePlace = { cursor: string | null; skip: number; done: boolean }

export type MergeRow = {
  id: string
  timestamp: number
  block_number: number
  log_index: number
}

/** One list's page, read from its place's cursor. */
export type SourcePage<Row> = { rows: readonly Row[]; next: string | null }

/** Newest first: time, block, log, then id so the order is total. */
export function compareRows(a: MergeRow, b: MergeRow): number {
  return (
    b.timestamp - a.timestamp ||
    b.block_number - a.block_number ||
    b.log_index - a.log_index ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  )
}

/** Rows to read from a place so a page still has `limit` after the skip. */
export function readLimit(place: SourcePlace, limit: number): number {
  return Math.min(100, limit + place.skip)
}

export function startPlaces(count: number): SourcePlace[] {
  return Array.from({ length: count }, () => ({
    cursor: null,
    skip: 0,
    done: false,
  }))
}

export function mergePages<Row extends MergeRow>(
  places: readonly SourcePlace[],
  pages: readonly (SourcePage<Row> | null)[],
  limit: number,
): { rows: Row[]; next: SourcePlace[] | null } {
  const available = places.map((place, index) => {
    const page = pages[index]
    if (place.done || page === null || page === undefined) return []
    return page.rows.slice(place.skip)
  })
  // The newest "last row read" among lists with more rows to read.
  let cut: MergeRow | null = null
  places.forEach((place, index) => {
    const page = pages[index]
    if (place.done || page === null || page === undefined) return
    if (page.next === null) return
    const last = page.rows.at(-1)
    if (last === undefined) return
    if (cut === null || compareRows(last, cut) < 0) cut = last
  })
  const tagged = available.flatMap((rows, source) =>
    rows.map((row) => ({ row, source })),
  )
  tagged.sort((a, b) => compareRows(a.row, b.row))
  const safe =
    cut === null
      ? tagged
      : tagged.filter(({ row }) => cut === null || compareRows(row, cut) <= 0)
  const taken = safe.slice(0, limit)
  const consumed = places.map(() => 0)
  for (const { source } of taken) consumed[source] = (consumed[source] ?? 0) + 1
  const next = places.map((place, index): SourcePlace => {
    const page = pages[index]
    if (place.done || page === null || page === undefined) return place
    const skip = place.skip + (consumed[index] ?? 0)
    if (skip < page.rows.length)
      return { cursor: place.cursor, skip, done: false }
    return page.next === null
      ? { cursor: place.cursor, skip, done: true }
      : { cursor: page.next, skip: 0, done: false }
  })
  return {
    rows: taken.map(({ row }) => row),
    next: next.every((place) => place.done) ? null : next,
  }
}

const placesSchema = z.array(
  z.tuple([
    z
      .string()
      .regex(/^[A-Za-z0-9_-]{4,512}$/)
      .nullable(),
    z.number().int().min(0).max(100),
    z.boolean(),
  ]),
)

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** The places as one URL-safe cursor. */
export function encodePlaces(places: readonly SourcePlace[]): string {
  return toBase64Url(
    JSON.stringify(
      places.map((place) => [place.cursor, place.skip, place.done]),
    ),
  )
}

/** The places a cursor names for `count` lists; null when it is not one. */
export function decodePlaces(
  cursor: string,
  count: number,
): SourcePlace[] | null {
  if (!/^[A-Za-z0-9_-]{4,2048}$/.test(cursor)) return null
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/")
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (char) => char.charCodeAt(0)),
    )
    const parsed = placesSchema.safeParse(JSON.parse(text))
    if (!parsed.success || parsed.data.length !== count) return null
    return parsed.data.map(([placeCursor, skip, done]) => ({
      cursor: placeCursor,
      skip,
      done,
    }))
  } catch {
    return null
  }
}
