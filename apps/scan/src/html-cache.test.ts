import { describe, expect, it } from "vitest"
import { cacheKey, loaderTiming, storableCopy } from "./html-cache"

const mac =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 Chrome/156.0"

function html(cacheControl: string, status = 200): Response {
  return new Response("<html></html>", {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": cacheControl,
      "set-cookie": "a=1",
      "content-security-policy": "script-src 'nonce-abc'",
      "server-timing": "loader;dur=12",
    },
  })
}

describe("page cache", () => {
  it("keys by build, platform, path and query only", () => {
    const url = new URL("https://scan.test/address/0xab?tab=transfers")
    const one = cacheKey(
      new Request(url, { headers: { "user-agent": mac, cookie: "a=1" } }),
      url,
      "b1",
    )
    const two = cacheKey(
      new Request(url, { headers: { "user-agent": mac, cookie: "b=2" } }),
      url,
      "b1",
    )
    expect(one.url).toBe(two.url)
    expect(one.url).toBe(
      "https://scan-pages.internal/b1/mac/address/0xab?tab=transfers",
    )
    expect(cacheKey(new Request(url), url, "b1").url).not.toBe(one.url)
    // A new build never reads the last one's pages.
    const next = cacheKey(
      new Request(url, { headers: { "user-agent": mac } }),
      url,
      "b2",
    )
    expect(next.url).not.toBe(one.url)
  })

  it("stores a whole 200 page without cookies, CSP or timing", () => {
    const copy = storableCopy(
      html("public, max-age=0, s-maxage=4, stale-while-revalidate=30"),
    )
    expect(copy).not.toBeNull()
    expect(copy?.headers.get("cache-control")).toBe("public, max-age=4")
    expect(copy?.headers.has("set-cookie")).toBe(false)
    expect(copy?.headers.has("content-security-policy")).toBe(false)
    expect(copy?.headers.has("server-timing")).toBe(false)
  })

  it("never stores no-store, a non-200 or a non-HTML response", () => {
    expect(storableCopy(html("no-store"))).toBeNull()
    expect(storableCopy(html("public, s-maxage=60", 404))).toBeNull()
    expect(
      storableCopy(
        new Response("{}", {
          headers: {
            "content-type": "application/json",
            "cache-control": "public, s-maxage=60",
          },
        }),
      ),
    ).toBeNull()
  })

  it("reports the loaders' time on a miss", () => {
    expect(loaderTiming(41.6)).toBe("cache;desc=miss, loader;dur=42")
    expect(loaderTiming(-3)).toBe("cache;desc=miss, loader;dur=0")
  })
})
