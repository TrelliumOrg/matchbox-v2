import { beforeEach, describe, expect, it } from "vitest"
import {
  matchCommands,
  registerSearchCommands,
  type SearchCommand,
} from "./commands"

function command(
  id: string,
  label: string,
  group?: string,
  keywords: string[] = [],
): SearchCommand {
  return {
    id,
    label,
    hint: "",
    keywords,
    to: `/${id}`,
    ...(group === undefined ? {} : { group }),
  }
}

const ids = (query: string): string[] =>
  matchCommands(query).map((found) => found.id)

beforeEach(() => {
  registerSearchCommands([])
  registerSearchCommands([], "locks")
})

describe("the host app's search commands", () => {
  it("finds a command when every word typed starts one of its words", () => {
    registerSearchCommands([
      command("calc", "Boost calculator", undefined, ["vemezo"]),
      command("vote", "Vote", "Pages", ["gauges"]),
    ])
    expect(ids("boo calc")).toEqual(["calc"])
    expect(ids("vem")).toEqual(["calc"])
    expect(ids("gau")).toEqual(["vote"])
    expect(ids("boost vote")).toEqual([])
    expect(ids("   ")).toEqual([])
  })

  it("keeps sets apart: replacing one leaves the other", () => {
    registerSearchCommands([command("vote", "Vote", "Pages")])
    registerSearchCommands(
      [command("lock-1", "veMEZO #2207", "Locks", ["vote"])],
      "locks",
    )
    expect(ids("vote")).toEqual(["vote", "lock-1"])
    registerSearchCommands([], "locks")
    expect(ids("vote")).toEqual(["vote"])
  })

  it("lists ungrouped commands first, then each group together", () => {
    registerSearchCommands([
      command("page-a", "Lock pages", "Pages"),
      command("tool", "Lock tool"),
      command("page-b", "Lock history", "Pages"),
    ])
    registerSearchCommands(
      [command("lock-1", "Lock #1", "Locks"), command("stray", "Lock notes")],
      "locks",
    )
    expect(ids("lock")).toEqual(["tool", "stray", "page-a", "page-b", "lock-1"])
  })
})
