import { describe, expect, it } from "vitest"
import type { LatestBlock } from "./figures"
import {
  fixtureNames,
  longValidatorName,
  unnamedProposer,
  validatorsFixture,
} from "./fixtures"
import {
  anyUnnamed,
  nameBlocks,
  shortAddress,
  validatorNames,
} from "./validators"

const harbor = "0x41b1a7f633eb9dac1fc19adae41aa7562c620971"

function block(address: string, proposer: string): LatestBlock {
  return { number: 1, address, proposer, transactions: 0 }
}

describe("validatorNames", () => {
  it("takes Matchscan's name: the directory name, else the label", () => {
    const names = validatorNames(validatorsFixture)
    expect(names[harbor]).toBe("Harbor Stake")
    expect(names["0x9c0f3d1e2b4a5c6d7e8f90a1b2c3d4e5f6a7b8c9"]).toBe(
      "Copperline",
    )
    expect(Object.values(names)).toContain(longValidatorName)
  })

  it("gives a validator with no name, or a blank one, no entry", () => {
    const names = validatorNames(validatorsFixture)
    expect(names[unnamedProposer]).toBeUndefined()
    expect(names["0x7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a"]).toBeUndefined()
    expect(Object.keys(names)).toHaveLength(4)
  })

  it("keys by lower case address and cuts a name past 80 characters", () => {
    const names = validatorNames({
      data: {
        validators: [
          { address: harbor.toUpperCase(), name: "x".repeat(200), label: null },
        ],
      },
    })
    expect(names[harbor.toUpperCase()]).toBeUndefined()
    expect(names[harbor.toLowerCase()]).toHaveLength(80)
  })
})

describe("nameBlocks", () => {
  it("names a known proposer and keeps the short address of an unknown one", () => {
    const named = nameBlocks(
      [
        block(harbor, shortAddress(harbor)),
        block(unnamedProposer, shortAddress(unnamedProposer)),
      ],
      fixtureNames,
    )
    expect(named?.map((each) => each.proposer)).toEqual([
      "Harbor Stake",
      "0xd056…0247",
    ])
  })

  it("never blanks a name it has none for", () => {
    const kept = nameBlocks([block(unnamedProposer, "Blockscout's name")], {})
    expect(kept?.[0]?.proposer).toBe("Blockscout's name")
    expect(nameBlocks(null, fixtureNames)).toBeNull()
  })

  it("knows when a shown proposer has no name", () => {
    expect(anyUnnamed([block(harbor, "Harbor Stake")], fixtureNames)).toBe(
      false,
    )
    expect(
      anyUnnamed([block(unnamedProposer, "0xd056…0247")], fixtureNames),
    ).toBe(true)
    expect(anyUnnamed(null, fixtureNames)).toBe(false)
  })
})
