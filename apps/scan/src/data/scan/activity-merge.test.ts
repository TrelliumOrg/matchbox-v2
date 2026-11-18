import { describe, expect, it } from "vitest"
import {
  compareRows,
  decodePlaces,
  encodePlaces,
  type MergeRow,
  mergePages,
  readLimit,
  type SourcePage,
  type SourcePlace,
  startPlaces,
} from "./activity-merge"

/**
 * Merged paging over several keyset lists: every row once, newest first,
 * whatever the page size and however the lists interleave.
 */

function rows(prefix: string, times: readonly number[]): MergeRow[] {
  return times.map((timestamp, index) => ({
    id: `${prefix}${index}`,
    timestamp,
    block_number: timestamp,
    log_index: 0,
  }))
}

/** A fake API list: pages of `size` with "c<offset>" cursors. */
function serve(
  list: readonly MergeRow[],
  place: SourcePlace,
  limit: number,
): SourcePage<MergeRow> {
  const offset = place.cursor === null ? 0 : Number(place.cursor.slice(1))
  const page = list.slice(offset, offset + limit)
  const end = offset + limit
  return {
    rows: page,
    next: end < list.length ? `c${String(end).padStart(4, "0")}` : null,
  }
}

function walk(lists: readonly MergeRow[][], limit: number): MergeRow[][] {
  let places: SourcePlace[] | null = startPlaces(lists.length)
  const pages: MergeRow[][] = []
  for (let guard = 0; places !== null && guard < 200; guard++) {
    const current: SourcePlace[] = places
    const read = current.map((place, index) =>
      place.done
        ? null
        : serve(lists[index] ?? [], place, readLimit(place, limit)),
    )
    const merged = mergePages(current, read, limit)
    pages.push(merged.rows)
    places =
      merged.next === null
        ? null
        : (decodePlaces(encodePlaces(merged.next), lists.length) ?? null)
  }
  return pages
}

describe("merged activity pages", () => {
  const votes = rows("v", [100, 97, 96, 90, 80, 79, 78, 50, 40, 10])
  const claims = rows("c", [99, 98, 60, 55, 54, 53, 52, 51, 5])
  const swaps = rows("s", [])

  for (const limit of [1, 2, 3, 4, 7, 25]) {
    it(`shows every row once, newest first, ${limit} a page`, () => {
      const pages = walk([votes, claims, swaps], limit)
      const all = pages.flat()
      const expected = [...votes, ...claims].sort(compareRows)
      expect(all.map((row) => row.id)).toEqual(expected.map((row) => row.id))
      expect(pages.every((page) => page.length <= limit)).toBe(true)
      expect(pages.every((page) => page.length > 0)).toBe(true)
    })
  }

  it("ends when every list is read", () => {
    const merged = mergePages(
      startPlaces(2),
      [
        { rows: votes.slice(0, 2), next: null },
        { rows: [], next: null },
      ],
      25,
    )
    expect(merged.next).toBeNull()
    expect(merged.rows.map((row) => row.id)).toEqual(["v0", "v1"])
  })

  it("refuses a cursor that is not one, or for another tab", () => {
    expect(decodePlaces("not a cursor", 2)).toBeNull()
    expect(decodePlaces(encodePlaces(startPlaces(3)), 2)).toBeNull()
  })
})
