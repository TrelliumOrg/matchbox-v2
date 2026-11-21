import { describe, expect, it } from "vitest"
import { numberOf } from "./adapters"

// Thu 5 Nov 2026 00:00 UTC starts Epoch 47 (Epoch 0 is Thu 11 Dec 2025).
const epoch47 = Date.UTC(2026, 10, 5) / 1000

describe("epoch numbers", () => {
  it("come from the epoch's start, never a stored index", () => {
    // The indexer still stores Classic's numbering (8 for this week).
    expect(numberOf({ start: epoch47 })).toBe(47)
    expect(numberOf({ start: epoch47 - 7 * 86_400 })).toBe(46)
    expect(numberOf({ start: Date.UTC(2025, 11, 11) / 1000 })).toBe(0)
  })
})

describe("voted gauge names", () => {
  async function namedAs(profileName: string): Promise<string | undefined> {
    const { withGaugeNames } = await import("./adapters")
    const gauge = {
      address: "0xAbC0000000000000000000000000000000006033",
      voter: "boost" as const,
      name: "veBTC #6033",
      picture: { kind: "initials" as const, initials: "SN", hue: 1 },
      color: { light: "#000", dark: "#fff" },
    }
    const named = withGaugeNames(
      {
        address: "0x1",
        claimable: { epoch: 46, usd: "0", tokens: [] },
        locks: [
          {
            kind: "vemezo",
            tokenId: "2930",
            amount: "1",
            usd: "1",
            votingPower: "1",
            votingPowerWei: "1",
            unlocksAt: null,
            expired: false,
            autoMax: false,
            votedThisEpoch: true,
            votes: [{ gauge, weight: "1", shareBps: 10_000 }],
            claimableUsd: "0",
          },
        ],
        wallet: null,
        suggestion: null,
        activity: [],
      },
      new Map([["0xabc0000000000000000000000000000000006033", profileName]]),
    )
    return named.locks[0]?.votes[0]?.gauge.name
  }

  it("use the gauge's display name, not its lock", async () => {
    expect(await namedAs("SNF")).toBe("SNF")
  })

  it("drop the spaces a hand-typed profile name came with", async () => {
    // Overview's lock cards read "SNF " from the profile (19 Nov 2026).
    expect(await namedAs("SNF ")).toBe("SNF")
  })
})
