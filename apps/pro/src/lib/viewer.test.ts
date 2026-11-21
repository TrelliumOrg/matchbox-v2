import { describe, expect, it } from "vitest"
import { viewsOther } from "./viewer"

const mine = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"
const theirs = "0x147379a0174780570d07d70a14fb244ee5f2d786"
const safe = "0x5afe000000000000000000000000000000000001"
const signsForSafe = (address: string): boolean =>
  address.toLowerCase() === safe

describe("whether the wallet on screen is someone else's", () => {
  it("is not for the connected wallet", () => {
    expect(
      viewsOther({ kind: "connected", address: mine }, mine, signsForSafe),
    ).toBe(false)
  })

  it("is not for this browser's wallet before it reconnects", () => {
    // A hard load: the server and the hydrating page know the wallet only
    // by its cookie, in any case.
    expect(
      viewsOther(
        { kind: "viewing", address: mine.toUpperCase().replace("0X", "0x") },
        mine,
        signsForSafe,
      ),
    ).toBe(false)
  })

  it("is not for a Safe this browser signs for", () => {
    expect(
      viewsOther({ kind: "viewing", address: safe }, mine, signsForSafe),
    ).toBe(false)
  })

  it("is for any other address, connected or not", () => {
    expect(
      viewsOther({ kind: "viewing", address: theirs }, mine, signsForSafe),
    ).toBe(true)
    expect(
      viewsOther({ kind: "viewing", address: theirs }, null, signsForSafe),
    ).toBe(true)
  })

  it("is not when no wallet is on screen", () => {
    expect(viewsOther({ kind: "signed-out" }, null, signsForSafe)).toBe(false)
  })
})
