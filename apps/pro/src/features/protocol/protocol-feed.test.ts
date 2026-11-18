import { describe, expect, it } from "vitest"
import type { ProtocolEvent } from "../../data/view-models"
import {
  categoryFor,
  countLine,
  firstCursor,
  mergeById,
  parseEventFilter,
  shown,
} from "./protocol-feed"

function event(id: string, action: ProtocolEvent["action"]): ProtocolEvent {
  return {
    id,
    at: 0,
    action,
    actor: { kind: "address", label: "0x91fe…22a0" },
    amount: "",
    amountTokens: [],
    where: { label: "", gauge: null },
  }
}

const painted = [
  event("a", "vote"),
  event("b", "boost-refresh"),
  event("c", "lock-create"),
  event("d", "claim"),
  event("e", "boost"),
  event("f", "incentive"),
]

describe("Protocol's live activity", () => {
  it("keeps system rows out of Activity and alone under System", () => {
    expect(shown(painted, "activity", "all").map((row) => row.id)).toEqual([
      "a",
      "c",
      "d",
      "e",
      "f",
    ])
    expect(shown(painted, "system", "all").map((row) => row.id)).toEqual(["b"])
    // The event filter does not apply to System.
    expect(shown(painted, "system", "votes").map((row) => row.id)).toEqual([
      "b",
    ])
  })

  it("filters by the API's categories: a boost is a vote", () => {
    expect(shown(painted, "activity", "votes").map((row) => row.id)).toEqual([
      "a",
      "e",
    ])
    expect(shown(painted, "activity", "locks").map((row) => row.id)).toEqual([
      "c",
    ])
  })

  it("asks the API for the category, or for every row", () => {
    expect(categoryFor("activity", "all")).toBeNull()
    expect(categoryFor("activity", "claims")).toBe("claims")
    expect(categoryFor("system", "claims")).toBe("system")
  })

  it("starts the next page after the last painted row of that list", () => {
    // Every row: the last painted one, whatever it is.
    expect(firstCursor(painted, "activity", "all")).toBe("f")
    expect(firstCursor(painted, "activity", "votes")).toBe("e")
    expect(firstCursor(painted, "system", "all")).toBe("b")
    // None painted: from the top of the list.
    expect(firstCursor([event("a", "vote")], "activity", "claims")).toBeNull()
  })

  it("adds a page without repeating a row", () => {
    const next = [event("f", "incentive"), event("g", "vote")]
    expect(mergeById(painted, next).map((row) => row.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
    ])
  })

  it("reads an unknown filter as all events", () => {
    expect(parseEventFilter("claims")).toBe("claims")
    expect(parseEventFilter("everything")).toBe("all")
    expect(parseEventFilter(undefined)).toBe("all")
  })

  it("says the list is the latest rows once it ends short of the total", () => {
    expect(countLine(20, 3412, true)).toBe("Showing 20 of 3,412 events")
    expect(countLine(97, 3412, false)).toBe(
      "Showing the latest 97 of 3,412 events",
    )
    expect(countLine(215, 215, false)).toBe("Showing 215 of 215 events")
    expect(countLine(12, null, false)).toBe("Showing 12")
  })
})
