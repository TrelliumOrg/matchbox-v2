import { describe, expect, it } from "vitest"
import followsAccount from "./follow-account"

const a = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"
const b = "0x2b0c000000000000000000000000000000000002"
const c = "0x147379a0174780570d07d70a14fb244ee5f2d786"

const base = {
  address: b,
  showing: null,
  before: null,
  remembered: null,
  chose: false,
  savedSafe: false,
}

describe("following a wallet that connected", () => {
  it("follows a wallet connected from the drawer", () => {
    expect(followsAccount({ ...base, showing: c, chose: true })).toBe(true)
  })

  it("follows when no wallet was on screen", () => {
    expect(followsAccount(base)).toBe(true)
  })

  it("follows a switch of account", () => {
    expect(followsAccount({ ...base, showing: a, before: a })).toBe(true)
  })

  it("follows a reconnect as another wallet on your plain path", () => {
    // The cookie said A, so /rewards rendered A's rewards; the wallet came
    // back as B. Staying on A read as someone else's, Viewing only, while
    // the address bar still said /rewards.
    expect(
      followsAccount({ ...base, showing: a.toUpperCase(), remembered: a }),
    ).toBe(true)
  })

  it("keeps a wallet someone chose to view", () => {
    expect(followsAccount({ ...base, showing: c, remembered: a })).toBe(false)
  })

  it("stays when the wallet on screen is the one that connected", () => {
    expect(followsAccount({ ...base, showing: b, chose: true })).toBe(false)
  })
})

describe("the Safe saved in Signing", () => {
  it("stays on screen when its owner connects from the drawer", () => {
    // Claim all on the Safe opened Connect wallet; following the owner's
    // wallet moved them off the Safe with no way Back.
    expect(
      followsAccount({ ...base, showing: c, chose: true, savedSafe: true }),
    ).toBe(false)
    expect(followsAccount({ ...base, showing: c, savedSafe: true })).toBe(false)
  })
})
