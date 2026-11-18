import { describe, expect, it } from "vitest"
import { searchResponse, searchTarget, searchTargetPath } from "./search"

/**
 * `/search`: each shape Matchscan reads one way goes to its page there,
 * everything else to Matchscan's home, and nothing a visitor types can
 * move the redirect off Matchscan's origin.
 */

const scan = "https://scan.matchbox.markets"
const hash = `0x${"ab".repeat(32)}`
// EIP-55's own example, and the same address with one letter's case wrong.
const checksummed = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"
const badChecksum = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD"

function target(q: string | null): string {
  const url = new URL("https://matchbox.markets/search")
  if (q !== null) url.searchParams.set("q", q)
  return searchTarget(url)
}

describe("searchTargetPath", () => {
  it("sends a 32 byte hash to its transaction, with or without 0x, any case", () => {
    expect(searchTargetPath(hash)).toBe(`/tx/${hash}`)
    expect(searchTargetPath(hash.slice(2).toUpperCase())).toBe(`/tx/${hash}`)
    expect(searchTargetPath(`  ${hash}  `)).toBe(`/tx/${hash}`)
  })

  it("sends an address to its page, lower-cased, when its checksum holds", () => {
    const lower = checksummed.toLowerCase()
    expect(searchTargetPath(checksummed)).toBe(`/address/${lower}`)
    expect(searchTargetPath(lower)).toBe(`/address/${lower}`)
    expect(searchTargetPath(lower.slice(2))).toBe(`/address/${lower}`)
    expect(searchTargetPath(`0X${lower.slice(2).toUpperCase()}`)).toBe(
      `/address/${lower}`,
    )
    expect(searchTargetPath(badChecksum)).toBe("/")
  })

  it("sends a Mezo ID to its address path, which Matchscan resolves", () => {
    expect(searchTargetPath("alice.mezo")).toBe("/address/alice.mezo")
    expect(searchTargetPath(" Alice.MEZO ")).toBe("/address/alice.mezo")
    expect(searchTargetPath("node-7.mezo")).toBe("/address/node-7.mezo")
    // A bare name could be a label or a gauge: Matchscan's palette.
    expect(searchTargetPath("alice")).toBe("/")
    expect(searchTargetPath("a_b.mezo")).toBe("/")
  })

  it("sends a mainnet Bitcoin address to its address path, which Matchscan resolves", () => {
    // BIP 173's example and the base58 example, no one's real address.
    const bech32 = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
    const base58 = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"
    expect(searchTargetPath(bech32)).toBe(`/address/${bech32}`)
    expect(searchTargetPath(` ${bech32.toUpperCase()} `)).toBe(
      `/address/${bech32}`,
    )
    expect(searchTargetPath(base58)).toBe(`/address/${base58}`)
    // Testnet, and bech32 in mixed case: Matchscan's palette.
    expect(searchTargetPath("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx")).toBe(
      "/",
    )
    expect(searchTargetPath(`bC1q${bech32.slice(4)}`)).toBe("/")
  })

  it("sends a labelled block number to its block", () => {
    expect(searchTargetPath("block 13078795")).toBe("/block/13078795")
    expect(searchTargetPath("Block #13,078,795")).toBe("/block/13078795")
    expect(searchTargetPath("b13078795")).toBe("/block/13078795")
    expect(searchTargetPath("block 1")).toBe("/block/1")
    expect(searchTargetPath("block 007")).toBe("/block/7")
  })

  it("sends a bare number to a block only above a million, as Matchscan reads it", () => {
    expect(searchTargetPath("13078795")).toBe("/block/13078795")
    expect(searchTargetPath("13 078 795")).toBe("/block/13078795")
    // An epoch, a lock in either escrow or a block: Matchscan's palette.
    expect(searchTargetPath("604")).toBe("/")
    expect(searchTargetPath("1000000")).toBe("/")
  })

  it("sends anything else, and nothing at all, to Matchscan's home", () => {
    for (const q of [
      null,
      "",
      "   ",
      "Northfield Nodes",
      "epoch 47",
      "veBTC #604",
      "lock 604",
      "MUSD",
    ]) {
      expect(searchTargetPath(q)).toBe("/")
    }
  })
})

describe("searchTarget never leaves Matchscan", () => {
  const hostile = [
    "//evil.example",
    "///evil.example/",
    "/\\evil.example",
    "\\\\evil.example",
    "https://evil.example/",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "@evil.example",
    "block 1@evil.example",
    "block 1/../../evil",
    "block 1%2f%2fevil.example",
    "block 1\r\nLocation: https://evil.example",
    "13078795\r\nSet-Cookie: a=b",
    "../evil.mezo",
    "a/b.mezo",
    "a%2fb.mezo",
    "evil.example/x.mezo",
    "x.mezo?next=https://evil.example",
    "x.mezo#@evil.example",
    "x.mezo\r\nLocation: https://evil.example",
    `${"a".repeat(64)}.mezo`,
    "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4/../../evil",
    "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4?next=https://evil.example",
    "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2#@evil.example",
    "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2\r\nLocation: https://evil.example",
    `${hash}/../../evil`,
    `${hash}?next=https://evil.example`,
    `${hash}#@evil.example`,
    `${checksummed}.evil.example`,
    "block １２３", // full-width digits
    "block -1",
    "block 1e9",
    "block 0x10",
    "9".repeat(13),
    "9".repeat(5_000),
    `${hash}${" ".repeat(200)}`,
    "‮1234567",
    "\u0000",
  ]

  it.each(hostile)("keeps %j on Matchscan's origin with a built path", (q) => {
    const location = new URL(target(q))
    expect(location.origin).toBe(scan)
    expect(location.search).toBe("")
    expect(location.hash).toBe("")
    expect(location.pathname).toMatch(
      /^\/((tx\/0x[0-9a-f]{64})|(address\/0x[0-9a-f]{40})|(block\/[0-9]{1,12}))?$/,
    )
  })

  it("sends every hostile query here to the home page, not to a guessed page", () => {
    for (const q of hostile) expect(target(q)).toBe(`${scan}/`)
  })

  it("reads only the first q", () => {
    const url = new URL(
      `https://matchbox.markets/search?q=block+5&q=https://evil.example`,
    )
    expect(searchTarget(url)).toBe(`${scan}/block/5`)
  })
})

describe("searchResponse", () => {
  it("redirects a GET with a 302 that is never cached", () => {
    const response = searchResponse(
      new Request(`https://matchbox.markets/search?q=${hash}`),
    )
    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(`${scan}/tx/${hash}`)
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  it("refuses other methods", () => {
    const response = searchResponse(
      new Request("https://matchbox.markets/search?q=1", { method: "POST" }),
    )
    expect(response.status).toBe(405)
    expect(response.headers.get("allow")).toBe("GET, HEAD")
    expect(response.headers.get("location")).toBeNull()
  })
})
