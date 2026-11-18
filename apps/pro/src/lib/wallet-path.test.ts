import { describe, expect, it } from "vitest"
import {
  decodeNames,
  encodeNames,
  guardRedirect,
  ownFromCookie,
  parseWalletSegment,
  redirectTarget,
  toInternal,
  toPublic,
  type WalletContext,
} from "./wallet-path"

const pyke = "0x5959ad00d315a81c57b06516e794b82261440965"
const other = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"
const names = decodeNames(`pyke.mezo=${pyke}`)
const base = "https://pro.matchbox.markets"

function url(path: string): URL {
  return new URL(path, base)
}

function internal(path: string, context: WalletContext): string {
  const next = toInternal(url(path), context)
  return `${next.pathname}${next.search}`
}

function external(path: string, context: WalletContext): string {
  const next = toPublic(url(path), context)
  return `${next.pathname}${next.search}`
}

const signedOut: WalletContext = { own: null, names }
const connected: WalletContext = { own: pyke, names }

describe("wallet paths", () => {
  it("reads a Mezo ID or an address prefix, never a page", () => {
    expect(parseWalletSegment("pyke.mezo")).toEqual({
      kind: "name",
      name: "pyke.mezo",
    })
    expect(parseWalletSegment(other.toUpperCase().replace("0X", "0x"))).toEqual(
      { kind: "address", address: other },
    )
    expect(parseWalletSegment("vote")).toBeNull()
    expect(parseWalletSegment("gauges")).toBeNull()
  })

  it("reads a Mezo ID by Mezo's rules", () => {
    expect(parseWalletSegment("Pyke.Mezo")).toEqual({
      kind: "name",
      name: "pyke.mezo",
    })
    expect(parseWalletSegment("-pyke.mezo")).toEqual({
      kind: "name",
      name: "-pyke.mezo",
    })
    // Mezo refuses these, so they are never looked up.
    expect(parseWalletSegment("pyke_1.mezo")).toBeNull()
    expect(parseWalletSegment("a%20b.mezo")).toBeNull()
    expect(parseWalletSegment(`${"a".repeat(64)}.mezo`)).toBeNull()
    expect(parseWalletSegment("%E0%A4%A.mezo")).toBeNull()
    expect(decodeNames(`pyke_1.mezo=${pyke}`).size).toBe(0)
  })

  it("maps public paths into the router", () => {
    expect(internal("/pyke.mezo/vote", signedOut)).toBe(`/vote?address=${pyke}`)
    expect(internal(`/${other}/rewards`, signedOut)).toBe(
      `/rewards?address=${other}`,
    )
    expect(internal(`/${other}`, signedOut)).toBe(`/?address=${other}`)
    expect(internal("/vote/validators?tab=funded", connected)).toBe(
      `/vote/validators?tab=funded&address=${pyke}`,
    )
    expect(internal("/vote", signedOut)).toBe("/vote")
    // Your wallet stays the viewer on gauge pages too.
    expect(
      internal("/gauges/0x4da4c05483324ea9cfc951510a5e77cc79541159", connected),
    ).toBe(`/gauges/0x4da4c05483324ea9cfc951510a5e77cc79541159?address=${pyke}`)
    expect(
      internal(
        `/${other}/gauges/0x4da4c05483324ea9cfc951510a5e77cc79541159`,
        signedOut,
      ),
    ).toBe(
      `/gauges/0x4da4c05483324ea9cfc951510a5e77cc79541159?address=${other}`,
    )
    expect(internal("/unknown.mezo/vote", signedOut)).toBe("/unknown.mezo/vote")
  })

  it("maps the router's paths back to clean ones", () => {
    expect(external(`/vote?address=${pyke}`, connected)).toBe("/vote")
    expect(external(`/vote?address=${pyke}`, signedOut)).toBe("/pyke.mezo/vote")
    expect(external(`/rewards?address=${other}`, connected)).toBe(
      `/${other}/rewards`,
    )
    expect(external(`/?address=${other}`, signedOut)).toBe(`/${other}`)
    expect(external(`/vote/vebtc?tab=funded&address=${other}`, signedOut)).toBe(
      `/${other}/vote/vebtc?tab=funded`,
    )
    expect(external(`/protocol/40?address=${other}`, signedOut)).toBe(
      `/${other}/protocol/40`,
    )
    expect(external(`/protocol/40?address=${pyke}`, connected)).toBe(
      "/protocol/40",
    )
  })

  it("round-trips, and your own wallet's prefix canonicalises to plain paths", () => {
    for (const path of [
      "/pyke.mezo/vote/pools",
      `/${other}/activity`,
      "/vote",
    ]) {
      expect(external(internal(path, signedOut), signedOut)).toBe(path)
    }
    expect(
      external(internal("/pyke.mezo/vote/pools", connected), connected),
    ).toBe("/vote/pools")
  })

  it("carries names and the own-wallet cookie", () => {
    expect(encodeNames(names)).toBe(`pyke.mezo=${pyke}`)
    expect(decodeNames("bad=0x1 pyke.mezo=nope").size).toBe(0)
    expect(
      ownFromCookie(
        `a=1; mbx-wallet=${pyke.toUpperCase().replace("0X", "0x")}`,
      ),
    ).toBe(pyke)
    expect(ownFromCookie("mbx-wallet=evil")).toBeNull()
    expect(ownFromCookie(null)).toBeNull()
  })
})

describe("redirects stay on this site", () => {
  // What the Worker answers to an old `?address=` link.
  function location(path: string, context: WalletContext): string {
    // Not `new URL(path, base)`: a path of `//evil.com` would parse as a host.
    return redirectTarget(toPublic(new URL(`${base}${path}`), context))
  }

  it("never answers a protocol-relative Location", () => {
    const hostile = [
      "//evil.com?address=",
      "///evil.com?address=",
      "/\\evil.com?address=",
      "/\\/evil.com?address=",
      "//evil.com?address=nonsense",
      `//evil.com?address=${other}`,
      "/%2F%2Fevil.com?address=",
      "/%5Cevil.com?address=",
    ]
    for (const path of hostile) {
      for (const context of [signedOut, connected]) {
        const target = location(path, context)
        expect(target, path).toMatch(/^\/(?![/\\])/)
        expect(new URL(target, base).origin, path).toBe(base)
      }
    }
    // The connected wallet's own address adds no prefix: still one slash.
    expect(location(`//evil.com?address=${pyke}`, connected)).toBe("/evil.com")
  })

  it("drops an empty or malformed address instead of prefixing it", () => {
    expect(location("/vote?address=", signedOut)).toBe("/vote")
    expect(location("/vote?address=evil.com", signedOut)).toBe("/vote")
    expect(location(`/vote?address=${other}`, signedOut)).toBe(`/${other}/vote`)
  })
})

describe("every redirect stays on this site", () => {
  function guarded(location: string, status = 308): string | null {
    const response = new Response(null, { status, headers: { location } })
    return guardRedirect(response, base).headers.get("location")
  }

  it("rewrites a Location that leaves the site", () => {
    expect(guarded("http://evil.com/")).toBe("/")
    expect(guarded("https://evil.com/vote")).toBe("/")
    expect(guarded("//evil.com/")).toBe("/evil.com/")
    expect(guarded("///evil.com")).toBe("/evil.com")
    expect(guarded("/\\evil.com")).toBe("/evil.com")
    expect(guarded("javascript:alert(1)")).toBe("/")
    expect(guarded("evil.com")).toBe("/evil.com")
  })

  it("keeps a Location on this site", () => {
    expect(guarded("/vote")).toBe("/vote")
    expect(guarded("/vote?filter=claims#top")).toBe("/vote?filter=claims#top")
    expect(guarded(`${base}/evil.com//?x=1`)).toBe("/evil.com//?x=1")
    expect(guarded("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com")
  })

  it("leaves other responses alone", () => {
    const page = new Response("ok", { headers: { location: "//evil.com" } })
    expect(guardRedirect(page, base)).toBe(page)
    const plain = new Response(null, { status: 301 })
    expect(guardRedirect(plain, base)).toBe(plain)
  })
})
