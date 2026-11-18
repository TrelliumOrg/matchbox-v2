import { describe, expect, it } from "vitest"
import { pickCursor } from "./cursors"

describe("keyset cursors from the URL", () => {
  it("passes a complete cursor and nothing else", () => {
    expect(
      pickCursor("transactions", {
        block_number: 13116321,
        index: "0",
        utm_source: "x",
      }),
    ).toEqual({ block_number: "13116321", index: "0" })
  })

  it("starts from the first page on a partial or hostile cursor", () => {
    expect(pickCursor("transactions", { block_number: "1" })).toBeNull()
    expect(pickCursor("blocks", { block_number: "1&evil=2" })).toBeNull()
    expect(pickCursor("blocks", { block_number: "x".repeat(200) })).toBeNull()
    expect(pickCursor("blocks", {})).toBeNull()
  })

  it("keeps address cursors' timestamps and hashes", () => {
    expect(
      pickCursor("addressTransactions", {
        block_number: "13103993",
        index: "0",
        value: "0",
        hash: "0x521afb71",
        inserted_at: "2026-11-09T07:00:52.098808Z",
        fee: "868176562500",
      }),
    ).not.toBeNull()
  })
})
