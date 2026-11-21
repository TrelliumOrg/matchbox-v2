import { describe, expect, it } from "vitest"
import { validateVoteSearch } from "./vote-route"

describe("Vote search params", () => {
  it("keeps a page from 2 and drops page 1 and nonsense", () => {
    expect(validateVoteSearch({ page: "3" })).toEqual({ page: 3 })
    expect(validateVoteSearch({ page: 4 })).toEqual({ page: 4 })
    expect(validateVoteSearch({ page: "1" })).toEqual({})
    expect(validateVoteSearch({ page: "0" })).toEqual({})
    expect(validateVoteSearch({ page: "-2" })).toEqual({})
    expect(validateVoteSearch({ page: "2.5" })).toEqual({})
    expect(validateVoteSearch({ page: "two" })).toEqual({})
    expect(validateVoteSearch({ page: 2.5 })).toEqual({})
  })

  it("keeps the search box as typed, up to 80 characters", () => {
    expect(validateVoteSearch({ q: "btc/musd cl200" })).toEqual({
      q: "btc/musd cl200",
    })
    expect(validateVoteSearch({ q: "" })).toEqual({})
    expect(validateVoteSearch({ q: 7 })).toEqual({})
    expect(validateVoteSearch({ q: "x".repeat(200) }).q).toHaveLength(80)
  })

  it("keeps a gauge to pick on arrival, lower case, and drops nonsense", () => {
    const address = "0xAbCDEF0123456789abcdef0123456789ABCDEF01"
    expect(validateVoteSearch({ pick: address })).toEqual({
      pick: address.toLowerCase(),
    })
    expect(validateVoteSearch({ pick: "0x1234" })).toEqual({})
    expect(validateVoteSearch({ pick: `${address}00` })).toEqual({})
    expect(validateVoteSearch({ pick: 7 })).toEqual({})
  })

  it("sets every key, so an unknown or empty one never reaches Vote", () => {
    for (const raw of [{ tab: "" }, { tab: "bogus" }, { sort: "" }]) {
      const search = validateVoteSearch(raw)
      expect(Object.keys(search).sort()).toEqual(
        ["page", "pick", "q", "sort", "tab"].sort(),
      )
      // Laid over the raw query as the router does.
      const merged = { ...raw, ...search }
      expect(merged.tab).toBeUndefined()
      expect(merged.sort).toBeUndefined()
    }
  })

  it("leaves the defaults out of the URL", () => {
    expect(
      validateVoteSearch({ tab: "all", sort: "incentives", page: "1" }),
    ).toEqual({})
    expect(
      validateVoteSearch({ tab: "funded", sort: "apy", page: "2", q: "kiln" }),
    ).toEqual({ tab: "funded", sort: "apy", page: 2, q: "kiln" })
  })
})
