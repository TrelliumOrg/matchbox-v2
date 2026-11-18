/**
 * Keyset cursors in Scan's URLs: the proxy's `next_page_params`, field for
 * field (README, Queries). Each list names its fields; a cursor is passed
 * on only when every field is present, since the proxy answers a partial
 * cursor with a 400. Anything else in the query is dropped, so it can
 * neither reach the proxy nor fork the page cache.
 */

export const cursorFields = {
  transactions: ["block_number", "index"],
  blocks: ["block_number"],
  blockTransactions: ["block_number", "index"],
  addressTransactions: [
    "block_number",
    "index",
    "value",
    "hash",
    "inserted_at",
    "fee",
  ],
  addressTransfers: ["block_number", "index"],
  tokenTransfers: ["block_number", "index"],
} as const

export type CursorList = keyof typeof cursorFields

const safeValue = /^[0-9A-Za-z_.:+-]{1,100}$/

/** The complete cursor for `list` in `search`, or null for the first page. */
export function pickCursor(
  list: CursorList,
  search: Readonly<Record<string, unknown>>,
): Record<string, string> | null {
  const cursor: Record<string, string> = {}
  for (const field of cursorFields[list]) {
    const value = search[field]
    const text =
      typeof value === "number" && Number.isSafeInteger(value)
        ? String(value)
        : typeof value === "string"
          ? value
          : null
    if (text === null || !safeValue.test(text)) return null
    cursor[field] = text
  }
  return cursor
}
