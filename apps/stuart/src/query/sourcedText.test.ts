import { describe, expect, it } from "vitest"
import {
  asciiDigits,
  hiddenText,
  hostOf,
  linkTokens,
  ownHost,
  plainText,
} from "./sourcedText"

describe("text hygiene for sourcing", () => {
  it("finds characters that hide or fake a figure", () => {
    expect(hiddenText("Send 50​00 MUSD")).toEqual(["U+200B"])
    expect(hiddenText("fi­ve")).toEqual(["U+00AD"])
    expect(hiddenText("Send ‮0005")).toEqual(["U+202E"])
    expect(hiddenText("Send １５０００")).toEqual(["１"])
    expect(hiddenText("Send ٥٠٠٠")).toEqual(["٥"])
    expect(hiddenText("x² and ½")).toEqual(["²"])
    expect(hiddenText("Send fіve")).toEqual(["fіve"])
    expect(hiddenText("Send 5,000.00 MUSD to 0xf365…8bc4.")).toEqual([])
    // A word wholly in another script is not mixed.
    expect(hiddenText("Привет and hello")).toEqual([])
  })

  it("reads one plain form", () => {
    expect(plainText("ｆｉｖｅ")).toBe("five")
    expect(plainText("ѕеvеn")).toBe("seven")
    expect(plainText("mezo-support。app")).toBe("mezo-support.app")
  })

  it("writes any decimal digits as 0 to 9", () => {
    expect(asciiDigits("lock ٦٠٣٣")).toBe("lock 6033")
    expect(asciiDigits("lock ６０３３")).toBe("lock 6033")
    expect(asciiDigits("lock ৬০৩৩")).toBe("lock 6033")
  })

  it("finds links and domains, and only own hosts pass", () => {
    expect(
      linkTokens(
        "Go to https://mezo-support.app/x, www.evil.example or claim.xyz.",
      ),
    ).toEqual(["https://mezo-support.app/x", "www.evil.example", "claim.xyz"])
    expect(linkTokens("Write to help@mezo-help.example")).toEqual([
      "help@mezo-help.example",
    ])
    expect(linkTokens("e.g. this, i.e. that, 1.5 BTC, v1.2, 4.4x")).toEqual([])
    // Any dotted word under letters is read: a name is told apart later.
    expect(linkTokens("Lavender.Five leads")).toEqual(["Lavender.Five"])
    expect(hostOf("https://www.Scan.Matchbox.Markets/address/0x1")).toBe(
      "scan.matchbox.markets",
    )
    expect(ownHost("scan.matchbox.markets")).toBe(true)
    expect(ownHost("mezo.org")).toBe(true)
    expect(ownHost("matchbox.markets.evil.app")).toBe(false)
    expect(ownHost("evilmezo.org")).toBe(false)
  })
})
