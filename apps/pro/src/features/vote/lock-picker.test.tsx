import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { Lock } from "../../data/view-models"
import { LockPicker, overflowOf, pickedLabel } from "./lock-picker"

function lock(tokenId: string, fields: Partial<Lock> = {}): Lock {
  return {
    kind: "vemezo",
    tokenId,
    amount: "1",
    usd: "1",
    votingPower: "1000",
    votingPowerWei: "1000000000000000000000",
    unlocksAt: null,
    expired: false,
    autoMax: true,
    votedThisEpoch: false,
    votes: [],
    claimableUsd: "0",
    ...fields,
  }
}

/** Zho's wallet on 12 Nov 2026 had 14 veMEZO locks. */
const fourteen = Array.from({ length: 14 }, (_, index) =>
  lock(`${200 + index}`),
)

function picker(
  locks: readonly Lock[],
  selected: readonly string[],
  onSelectedChange = vi.fn(),
) {
  render(
    <LockPicker
      escrow="vemezo"
      locks={locks}
      selected={selected}
      onSelectedChange={onSelectedChange}
      onNewLock={() => {}}
      saved={[]}
      nextEpoch={49}
    />,
  )
  return onSelectedChange
}

describe("Vote with", () => {
  it("says how many of the locks are picked", () => {
    picker(fourteen, ["200", "201", "213"])
    expect(
      screen.getByRole("heading", { name: "Vote with 3 of 14" }),
    ).toBeTruthy()
    // Every lock is in the row, not only the ones that fit.
    expect(screen.getAllByRole("checkbox")).toHaveLength(14)
  })

  it("keeps Select all and Clear within reach, whatever is picked", () => {
    const change = picker(fourteen, ["200"])
    fireEvent.click(screen.getByRole("button", { name: "Select all" }))
    expect(change).toHaveBeenLastCalledWith(
      fourteen.map((each) => each.tokenId),
    )
    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    expect(change).toHaveBeenLastCalledWith([])
  })

  it("has nothing to select when all are picked, nothing to clear when none", () => {
    picker(
      fourteen,
      fourteen.map((each) => each.tokenId),
    )
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Select all" })
        .disabled,
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Clear" }).disabled,
    ).toBe(false)
  })

  it("counts only locks that can vote, and never selects the others", () => {
    const locks = [
      lock("1"),
      lock("2", { expired: true }),
      lock("3", { votingPowerWei: "0" }),
      lock("4"),
    ]
    expect(pickedLabel(locks, ["1", "2"])).toBe("1 of 2")
    const change = picker(locks, [])
    fireEvent.click(screen.getByRole("button", { name: "Select all" }))
    expect(change).toHaveBeenLastCalledWith(["1", "4"])
  })

  it("shows no count and no buttons for a single lock", () => {
    expect(pickedLabel([lock("1")], ["1"])).toBeNull()
    picker([lock("1")], ["1"])
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull()
    expect(screen.getByRole("heading", { name: "Vote with" })).toBeTruthy()
  })

  it("knows which ends of the row hide more locks", () => {
    const row = { scrollWidth: 3_200, clientWidth: 900 }
    expect(overflowOf({ ...row, scrollLeft: 0 })).toEqual({
      before: false,
      after: true,
    })
    expect(overflowOf({ ...row, scrollLeft: 800 })).toEqual({
      before: true,
      after: true,
    })
    expect(overflowOf({ ...row, scrollLeft: 2_300 })).toEqual({
      before: true,
      after: false,
    })
    // Everything fits: no arrows, no fade.
    expect(
      overflowOf({ scrollLeft: 0, scrollWidth: 900, clientWidth: 900 }),
    ).toEqual({ before: false, after: false })
  })
})
