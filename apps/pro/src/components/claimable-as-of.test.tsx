import { walletOverviewSchema } from "@matchbox/contracts/read-models"
import { demoWalletOverview } from "@matchbox/contracts/read-models/fixtures"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import * as adapt from "../data/adapters"
import {
  ClaimableAsOfNote,
  claimableNote,
  LocksAsOfNote,
  locksNote,
} from "./claimable-as-of"

afterEach(() => cleanup())

describe("where Claimable comes from", () => {
  it("says nothing for a figure read from the chain just now", () => {
    expect(
      claimableNote({ block: 13_180_426, source: "live", partial: false }),
    ).toBeNull()
    const { container } = render(
      <ClaimableAsOfNote
        asOf={{ block: 13_180_426, source: "live", partial: false }}
      />,
    )
    expect(container.textContent).toBe("")
  })

  it("names the block of a stored figure", () => {
    render(
      <ClaimableAsOfNote
        asOf={{ block: 13_169_097, source: "stored", partial: false }}
      />,
    )
    expect(screen.getByText("As of block 13,169,097")).toBeTruthy()
  })

  it("says when only the largest locks are live", () => {
    expect(
      claimableNote({ block: 13_180_426, source: "live", partial: true }),
    ).toBe("Largest locks live, the rest earlier")
  })

  it("says nothing for a document from an API that does not send it", () => {
    expect(claimableNote(undefined)).toBeNull()
    expect(
      adapt.overview(demoWalletOverview, null, 48).claimableAsOf,
    ).toBeUndefined()
  })

  it("comes through the contract and the adapter as the API sends it", () => {
    const sent = walletOverviewSchema.parse({
      ...demoWalletOverview,
      // `partial` left out: the contract defaults it.
      claimableAsOf: { block: 13_169_097, source: "stored" },
    })
    expect(adapt.overview(sent, null, 48).claimableAsOf).toEqual({
      block: 13_169_097,
      source: "stored",
      partial: false,
    })
  })
})

describe("where the locks come from", () => {
  it("says nothing for locks read from the chain just now", () => {
    expect(
      locksNote({ block: 13_203_206, source: "live", partial: false }),
    ).toBeNull()
    expect(locksNote(undefined)).toBeNull()
  })

  it("names the block of stored locks", () => {
    render(
      <LocksAsOfNote
        asOf={{ block: 13_169_097, source: "stored", partial: false }}
      />,
    )
    expect(screen.getByText("Locks as of block 13,169,097")).toBeTruthy()
  })

  it("says when the wallet holds more locks than one read lists", () => {
    expect(
      locksNote({ block: 13_203_206, source: "live", partial: true }),
    ).toBe("First 50 locks live, the rest earlier")
  })

  it("comes through the contract and the adapters as the API sends it", () => {
    const sent = walletOverviewSchema.parse({
      ...demoWalletOverview,
      locksAsOf: { block: 13_203_206, source: "live" },
    })
    expect(adapt.overview(sent, null, 48).locksAsOf).toEqual({
      block: 13_203_206,
      source: "live",
      partial: false,
    })
    // Vote knows the block its locks are from, only when they are live.
    expect(adapt.voter(sent).block).toBe(13_203_206)
    expect(adapt.voter(demoWalletOverview).block).toBeUndefined()
    const stored = walletOverviewSchema.parse({
      ...demoWalletOverview,
      locksAsOf: { block: 13_169_097, source: "stored" },
    })
    expect(adapt.voter(stored).block).toBeUndefined()
  })
})
