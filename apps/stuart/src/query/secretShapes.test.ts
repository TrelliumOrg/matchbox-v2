import { describe, expect, it } from "vitest"
import { isSafetyQuestion } from "./knowledge/mezo"
import { type ToolOutcome, verifiedIdsOf } from "./outcome"
import { redactSecrets } from "./redact"
import {
  bip39Checksum,
  pastedKey,
  pastedPhrase,
  primePhraseChecksums,
} from "./secretShapes"
import { txUrl } from "./tools/chainCommon"

const HEX = "0123456789abcdef".repeat(4)
const KEY = `0x${HEX}`

describe("the BIP-39 checksum (routing only)", () => {
  it("reads the reference vectors", async () => {
    const twelve = [...Array.from({ length: 11 }, () => "abandon"), "about"]
    expect(await bip39Checksum(twelve)).toBe(true)
    expect(
      await bip39Checksum(Array.from({ length: 12 }, () => "abandon")),
    ).toBe(false)
    const twentyFour = [...Array.from({ length: 23 }, () => "abandon"), "art"]
    expect(await bip39Checksum(twentyFour)).toBe(true)
    expect(
      await bip39Checksum(
        "legal winner thank year wave sausage worth useful legal winner thank yellow".split(
          " ",
        ),
      ),
    ).toBe(true)
    expect(await bip39Checksum(["abandon", "about"])).toBe(false)
  })

  it("routes a checksummed phrase holding question words once primed", async () => {
    // A valid phrase (all "abandon" but the checksum word) with two
    // function words in it would read as text without the checksum.
    const phrase =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
    expect(pastedPhrase(phrase)).toBe(true)
    const words = await validWithFunctionWords()
    const text = words.join(" ")
    expect(pastedPhrase(text)).toBe(false)
    await primePhraseChecksums(text)
    expect(pastedPhrase(text)).toBe(true)
    // The checksum never gates redaction.
    expect(redactSecrets(text).text).toBe("[redacted:word_phrase]")
  })

  it("stays fast on a long run of question words", async () => {
    // Two function words in every 12: each window's checksum may be read.
    const text = "abandon this abandon abandon abandon abandon ".repeat(300)
    const started = performance.now()
    await primePhraseChecksums(text)
    isSafetyQuestion(text)
    redactSecrets(text)
    // A few milliseconds here; the bound holds on a machine five times
    // slower than the one this was measured on.
    expect(performance.now() - started).toBeLessThan(1_500)
  })
})

/**
 * A valid 12-word phrase with two function words ("this", "that") in it,
 * found by trying the last word: about one word in sixteen fits.
 */
async function validWithFunctionWords(): Promise<string[]> {
  const head = [
    "abandon",
    "this",
    "abandon",
    "that",
    ...Array.from({ length: 7 }, () => "abandon"),
  ]
  for (const last of [
    "ability",
    "able",
    "about",
    "above",
    "absent",
    "absorb",
    "abstract",
    "absurd",
    "abuse",
    "access",
    "accident",
    "account",
    "accuse",
    "achieve",
    "acid",
    "acoustic",
    "acquire",
    "across",
    "act",
    "action",
    "actor",
    "actress",
    "actual",
    "adapt",
    "add",
    "addict",
    "address",
    "adjust",
    "admit",
    "adult",
    "advance",
    "advice",
    "aerobic",
    "affair",
    "afford",
    "afraid",
    "again",
    "age",
    "agent",
    "agree",
    "ahead",
    "aim",
    "air",
    "airport",
    "aisle",
    "alarm",
    "album",
    "alcohol",
    "alert",
    "alien",
  ]) {
    const words = [...head, last]
    if (await bip39Checksum(words)) return words
  }
  throw new Error("no valid last word in the sample")
}

describe("routing reads ids precisely", () => {
  it("reads a known id from this turn as an id", () => {
    expect(pastedKey(`show block ${KEY}`)).toBe(true)
    expect(pastedKey(`show block ${KEY}`, new Set([KEY]))).toBe(false)
  })

  it("reads a hex in a Matchbox or Mezo id link only on an id route", () => {
    expect(pastedKey(`https://scan.matchbox.markets/tx/${KEY}`)).toBe(false)
    expect(pastedKey(`https://explorer.mezo.org/block/${KEY}`)).toBe(false)
    expect(pastedKey(`https://scan.matchbox.markets/key/${KEY}`)).toBe(true)
    expect(pastedKey(`https://evil.example/tx/${KEY}`)).toBe(true)
    expect(pastedKey(`https://scan.matchbox.markets.evil.xyz/tx/${KEY}`)).toBe(
      true,
    )
  })
})

describe("verified ids come from tool results, never from the user", () => {
  it("collects transaction links and hash rows, nothing else", () => {
    const outcome = {
      // No longer read: a tool can no longer vouch for an id by saying so.
      verifiedIds: [`0x${"a".repeat(64)}`],
      evidence: [{ url: txUrl(KEY) }],
      model: {
        rows: [{ tx: `0x${"b".repeat(64)}`, label: KEY.replace("0", "1") }],
      },
      input: { question: `0x${"c".repeat(64)}` },
    } as unknown as ToolOutcome
    expect(verifiedIdsOf([outcome]).sort()).toEqual(
      [KEY, `0x${"b".repeat(64)}`].sort(),
    )
  })
})
