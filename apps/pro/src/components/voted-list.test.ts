import { describe, expect, it } from "vitest"
import type { Lock } from "../data/view-models"
import { votedList } from "./lock-cards"

const vote = (name: string, voter: string, weight: bigint) =>
  ({
    gauge: { address: `0x${name}`, voter, name },
    weight: `${weight}`,
    shareBps: 10_000,
  }) as unknown as Lock["votes"][number]

describe("what a lock card's vote line stands for", () => {
  it("lists each gauge with its share of all the lock's votes", () => {
    expect(
      votedList({
        votes: [
          vote("Kiln Labs", "boost", 70n),
          vote("Aerodrome MEZO/MUSD", "third-party", 30n),
        ],
      }),
    ).toEqual(["Kiln Labs 70%", "Aerodrome MEZO/MUSD 30%"])
  })

  it("says a lone gauge's full name, which the card may cut short", () => {
    expect(
      votedList({
        votes: [vote("Northfield Nodes Validator", "validators", 5n)],
      }),
    ).toEqual(["Northfield Nodes Validator 100%"])
  })

  it("has a line for a lock that voted on nothing listed", () => {
    expect(votedList({ votes: [] })).toEqual(["Voted"])
  })
})
