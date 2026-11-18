import { describe, expect, it } from "vitest"
import { canonicalBtcAddress } from "./btc-address"

// Documentation vectors (BIP 173, BIP 350 and the base58 examples), never
// a real account's address.
const p2wpkh = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
const p2wsh = "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3"
const taproot = "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0"
const p2pkh = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"
const p2sh = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"

describe("canonicalBtcAddress", () => {
  it("takes mainnet bech32, lower-cased, and base58 as typed", () => {
    for (const address of [p2wpkh, p2wsh, taproot, p2pkh, p2sh]) {
      expect(canonicalBtcAddress(address), address).toBe(address)
    }
    expect(canonicalBtcAddress(` ${p2wpkh.toUpperCase()} `)).toBe(p2wpkh)
    expect(canonicalBtcAddress(` ${p2pkh}\n`)).toBe(p2pkh)
  })

  it("never changes base58's case, which Mezo's API matches exactly", () => {
    const lower = p2pkh.toLowerCase()
    expect(canonicalBtcAddress(lower)).toBe(lower)
  })

  it("refuses testnet, regtest and other networks", () => {
    for (const other of [
      "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
      "bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080",
      "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn",
      "n3GNqMveyvaPvUbH469vDRadqpJMPc84JA",
      "2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc",
      "ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9",
    ]) {
      expect(canonicalBtcAddress(other), other).toBeNull()
    }
  })

  it("refuses mixed case, bad lengths and characters outside the alphabets", () => {
    for (const bad of [
      `bc1Q${p2wpkh.slice(4)}`,
      p2wpkh.slice(0, -1),
      `${p2wpkh}q`,
      `${p2wpkh.slice(0, -1)}b`,
      `${p2wpkh.slice(0, -1)}o`,
      `bc1z${p2wsh.slice(4)}`,
      `bc1p${p2wpkh.slice(4)}`,
      `${p2pkh.slice(0, -1)}0`,
      `${p2pkh.slice(0, -1)}l`,
      `${p2pkh}${"A".repeat(10)}`,
      "1abc",
      "",
      "alice.mezo",
      `0x${"ab".repeat(20)}`,
      `${p2wpkh}/x`,
      `../${p2pkh}`,
      `${p2pkh}%2f`,
      `${p2wpkh}?a=1`,
      "x".repeat(200),
    ]) {
      expect(canonicalBtcAddress(bad), bad).toBeNull()
    }
  })
})
