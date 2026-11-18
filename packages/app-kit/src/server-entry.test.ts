import { describe, expect, it } from "vitest"
import { guardRedirect, isPage, redirect, redirectTarget } from "./server-entry"

function get(path: string, method = "GET"): [Request, URL] {
  const url = new URL(path, "https://scan.matchbox.markets")
  return [new Request(url, { method }), url]
}

describe("isPage", () => {
  it("takes GET page paths, including dotted Mezo IDs", () => {
    expect(isPage(...get("/"))).toBe(true)
    expect(isPage(...get("/tx/0xabc"))).toBe(true)
    expect(isPage(...get("/pyke.mezo"))).toBe(true)
  })

  it("leaves files, assets, server functions and other methods alone", () => {
    expect(isPage(...get("/favicon.svg"))).toBe(false)
    expect(isPage(...get("/assets/main-abc.js"))).toBe(false)
    expect(isPage(...get("/_serverFn/abc"))).toBe(false)
    expect(isPage(...get("/", "POST"))).toBe(false)
  })
})

describe("redirect", () => {
  it("keeps the path, query and hash on the same origin", () => {
    const response = redirect(new URL("https://x.test/vote?tab=funded#top"))
    expect(response.status).toBe(301)
    expect(response.headers.get("location")).toBe("/vote?tab=funded#top")
  })
})

describe("redirects stay on this site", () => {
  // Ported from Pro's wallet-path.test.ts (44b59bc) for the generic helper.
  const base = "https://pro.matchbox.markets"

  /** Never `new URL(path, base)`: a path of `//evil.com` parses as a host. */
  function location(path: string): string {
    return redirectTarget(new URL(`${base}${path}`))
  }

  const hostile = [
    "//evil.com",
    "//evil.com?address=",
    "///evil.com?address=",
    "/\\evil.com?address=",
    "/\\/evil.com?address=",
    "//evil.com?address=nonsense",
    "//evil.com/vote?tab=x#top",
    "/%2F%2Fevil.com?address=",
    "/%5Cevil.com?address=",
    "/%2f%5cevil.com",
  ]

  it.each(hostile)(
    "%s starts with exactly one slash, on this origin",
    (path) => {
      const target = location(path)
      expect(target).toMatch(/^\/(?![/\\])/)
      expect(new URL(target, base).origin).toBe(base)
    },
  )

  it("adds nothing and cuts a doubled slash when no prefix is added", () => {
    // Pro's own-wallet case: no prefix, so the doubled slash would pass.
    expect(location("//evil.com?address=")).toBe("/evil.com?address=")
    expect(location("/vote?tab=funded#top")).toBe("/vote?tab=funded#top")
    expect(location("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com")
  })

  it("answers a 301 with that Location", () => {
    const response = redirect(new URL(`${base}///evil.com`))
    expect(response.status).toBe(301)
    expect(response.headers.get("location")).toBe("/evil.com")
  })
})

describe("guardRedirect", () => {
  const origin = "https://scan.matchbox.markets"

  function guarded(location: string, status = 301): string | null {
    return guardRedirect(
      new Response(null, { status, headers: { location } }),
      origin,
    ).headers.get("location")
  }

  it.each([
    ["//evil.com", "/evil.com"],
    ["///evil.com/x?y=1", "/evil.com/x?y=1"],
    ["/\\evil.com", "/evil.com"],
    ["\\\\evil.com", "/evil.com"],
    ["/block/1", "/block/1"],
    [`${origin}//evil.com`, "/evil.com"],
    [`${origin}/tx/0xab?x=1`, "/tx/0xab?x=1"],
    ["https://evil.com/x", "/"],
    ["javascript:alert(1)", "/"],
  ])("%s becomes %s", (from, to) => {
    expect(guarded(from)).toBe(to)
    expect(new URL(guarded(from) ?? "", origin).origin).toBe(origin)
  })

  it("leaves other responses alone", () => {
    const ok = new Response("x", {
      status: 200,
      headers: { location: "//evil.com" },
    })
    expect(guardRedirect(ok, origin)).toBe(ok)
  })
})
