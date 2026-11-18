import { afterEach, describe, expect, it } from "vitest"
import {
  listIsPrevious,
  parseVoteReturn,
  readVoteReturn,
  rememberVoteList,
} from "./vote-return"

afterEach(() => {
  window.sessionStorage.clear()
  window.history.replaceState(null, "")
})

describe("the gauge page's way back to Vote", () => {
  it("records the list's type, search, page and history entry", () => {
    window.history.replaceState({ __TSR_index: 4 }, "")
    rememberVoteList("pool", {
      tab: "all",
      sort: "apy",
      page: 3,
      q: "btc/musd",
    })
    expect(readVoteReturn()).toEqual({
      kind: "pool",
      search: { sort: "apy", page: 3, q: "btc/musd" },
      index: 4,
    })
  })

  it("records nothing outside the router's history", () => {
    window.history.replaceState(null, "")
    rememberVoteList("vebtc", { page: 2 })
    expect(readVoteReturn()).toBeNull()
  })

  it("steps back only when the list is the entry just before", () => {
    const entry = { kind: "vebtc" as const, search: {}, index: 4 }
    expect(listIsPrevious(entry, 5)).toBe(true)
    expect(listIsPrevious(entry, 6)).toBe(false)
    expect(listIsPrevious(entry, 4)).toBe(false)
    expect(listIsPrevious(null, 5)).toBe(false)
    expect(listIsPrevious(entry, null)).toBe(false)
  })

  it("does not trust what was stored", () => {
    expect(parseVoteReturn("{")).toBeNull()
    expect(parseVoteReturn("null")).toBeNull()
    expect(
      parseVoteReturn(JSON.stringify({ kind: "nope", search: {}, index: 1 })),
    ).toBeNull()
    expect(
      parseVoteReturn(JSON.stringify({ kind: "pool", search: {}, index: 1.5 })),
    ).toBeNull()
    expect(
      parseVoteReturn(
        JSON.stringify({
          kind: "pool",
          search: { page: "javascript:", sort: "evil", tab: "funded" },
          index: 2,
        }),
      ),
    ).toEqual({ kind: "pool", search: { tab: "funded" }, index: 2 })
  })
})
