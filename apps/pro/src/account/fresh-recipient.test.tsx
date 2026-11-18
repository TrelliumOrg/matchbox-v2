import { getAddress } from "viem"
import { describe, expect, it, vi } from "vitest"
import { ReviewStop } from "../tx/tx-sheet"
import { checkFresh, freshRecipient } from "./fresh-recipient"
import type { IdentityLookup } from "./identity"

/**
 * At review a transfer to a Mezo ID reads the ID again, past every cache,
 * and sends only to that answer: the wallet shown goes on, another wallet
 * stops the review to be confirmed again, and a failed read blocks it.
 */

const shown = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"
const moved = "0x00000000000000000000000000000000000000a1"

function found(address: string): IdentityLookup {
  return { status: "found", identity: { address, mezoId: "pyke.mezo" } }
}

function answers(...queue: IdentityLookup[]) {
  return vi.fn(async (_id: string) => {
    const next = queue.shift()
    if (next === undefined) throw new Error("no answer queued")
    return next
  })
}

describe("checkFresh", () => {
  it("compares in any case", () => {
    expect(
      checkFresh(shown.toUpperCase().replace("0X", "0x"), found(shown)),
    ).toEqual({ kind: "same", address: getAddress(shown) })
    expect(checkFresh(shown, found(moved))).toEqual({
      kind: "moved",
      address: getAddress(moved),
    })
    expect(checkFresh(shown, { status: "not-found" })).toEqual({
      kind: "not-found",
    })
    expect(checkFresh(shown, { status: "unavailable" })).toEqual({
      kind: "unavailable",
    })
  })
})

describe("freshRecipient", () => {
  it("sends to the wallet shown when Mezo still answers it", async () => {
    const onMoved = vi.fn()
    const read = answers(found(shown))
    expect(await freshRecipient("pyke.mezo", shown, onMoved, read)).toBe(
      getAddress(shown),
    )
    expect(read).toHaveBeenCalledWith("pyke.mezo")
    expect(onMoved).not.toHaveBeenCalled()
  })

  it("stops when the ID now points elsewhere, then sends there once confirmed", async () => {
    const onMoved = vi.fn()
    const read = answers(found(moved), found(moved))
    const stop = await freshRecipient("pyke.mezo", shown, onMoved, read).then(
      () => null,
      (error: unknown) => error,
    )
    expect(stop).toBeInstanceOf(ReviewStop)
    if (!(stop instanceof ReviewStop)) throw new Error("no stop")
    expect(stop.message).toBe(
      "pyke.mezo now points to a different address. Check it before you send.",
    )
    expect(stop.action).toBe("Review again")
    expect(stop.rows.map((row) => row.label)).toEqual([
      "Mezo ID",
      "New address",
    ])
    // The sheet now shows the new wallet; nothing was sent to either.
    expect(onMoved).toHaveBeenCalledWith(getAddress(moved))
    // The next review starts from the wallet now shown, and is confirmed.
    expect(await freshRecipient("pyke.mezo", moved, onMoved, read)).toBe(
      getAddress(moved),
    )
    expect(read).toHaveBeenCalledTimes(2)
  })

  it("blocks with Try again when the read fails or the ID is gone", async () => {
    for (const [answer, message] of [
      [{ status: "unavailable" }, "Couldn't look up this Mezo ID. Try again."],
      [{ status: "not-found" }, "Mezo ID not found"],
    ] as const) {
      const stop = await freshRecipient(
        "pyke.mezo",
        shown,
        vi.fn(),
        answers(answer),
      ).then(
        () => null,
        (error: unknown) => error,
      )
      expect(stop).toBeInstanceOf(ReviewStop)
      expect(stop instanceof ReviewStop ? stop.message : null).toBe(message)
      expect(stop instanceof ReviewStop ? stop.action : null).toBe("Try again")
    }
  })
})
