import { describe, expect, it } from "vitest"
import { plainInstructions } from "./sourcedInstructions"

// F8 of the review of the safety follow-ups (19 Nov 2026): two sound
// sentences the warning rule refused, and the backup advice it must still
// refuse.

describe("F8: the warning rule allows two sound sentences", () => {
  it("allows a negated contact statement and the paper backup", () => {
    for (const answer of [
      "Nobody will reach out to you about rewards.",
      "Never store your seed phrase online, write it on paper instead.",
      "Mezo support will never contact you first.",
      "Never share your seed phrase. Keep it offline.",
    ]) {
      expect(plainInstructions(answer), answer).toEqual([])
    }
  })

  it("still refuses forbidding a paper backup", () => {
    for (const answer of [
      "Never write down your seed phrase on paper.",
      "Never write your seed phrase on paper, store it online instead.",
      "Write your seed phrase on paper and send a photo to support.",
    ]) {
      expect(plainInstructions(answer), answer).not.toEqual([])
    }
  })
})
