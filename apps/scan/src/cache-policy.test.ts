import { describe, expect, it, vi } from "vitest"
import { classForAge } from "./cache-class.server"
import {
  cacheClassHeader,
  degradedHeader,
  noStore,
  pageCacheControl,
  sharedMaxAge,
  withCachePolicy,
  withDataPolicy,
} from "./cache-policy"

vi.mock("@tanstack/react-start/server", () => ({
  setResponseHeader: () => undefined,
}))

function page(status: number, degraded = false, cacheClass?: string): Response {
  const headers = new Headers({ "content-type": "text/html; charset=utf-8" })
  if (degraded) headers.set(degradedHeader, "1")
  if (cacheClass !== undefined) headers.set(cacheClassHeader, cacheClass)
  return new Response("<html></html>", { status, headers })
}

describe("page cache policy", () => {
  it("never stores an error, a redirect or a degraded page", () => {
    for (const status of [301, 302, 404, 500, 503]) {
      expect(pageCacheControl(status, false)).toBe(noStore)
    }
    expect(pageCacheControl(200, true)).toBe(noStore)
  })

  it("applies the policy and strips the internal marker", () => {
    const degraded = withCachePolicy(page(200, true))
    expect(degraded.headers.get("cache-control")).toBe(noStore)
    expect(degraded.headers.has(degradedHeader)).toBe(false)
    expect(withCachePolicy(page(404)).headers.get("cache-control")).toBe(
      noStore,
    )
    expect(withCachePolicy(page(200)).headers.get("cache-control")).not.toBe(
      noStore,
    )
  })
})

describe("cache classes", () => {
  it("keeps finalized pages long and revalidates, lists and home short", () => {
    expect(pageCacheControl(200, false, "final")).toBe(
      "public, max-age=60, s-maxage=86400, stale-while-revalidate=604800",
    )
    expect(pageCacheControl(200, false, "fresh")).toBe(
      "public, max-age=0, s-maxage=15, stale-while-revalidate=60",
    )
    expect(pageCacheControl(200, false, "list")).toBe(
      "public, max-age=0, s-maxage=4, stale-while-revalidate=30",
    )
  })

  it("reads the loader's class and drops the marker", () => {
    const final = withCachePolicy(page(200, false, "final"))
    expect(sharedMaxAge(final.headers.get("cache-control"))).toBe(86_400)
    expect(final.headers.has(cacheClassHeader)).toBe(false)
    const unknown = withCachePolicy(page(200, false, "forever"))
    expect(sharedMaxAge(unknown.headers.get("cache-control"))).toBe(300)
  })

  it("leaves non-HTML responses alone", () => {
    const json = new Response("{}", {
      headers: { "content-type": "application/json", [degradedHeader]: "1" },
    })
    expect(withCachePolicy(json)).toBe(json)
  })

  it("caches a server function's series a minute and strips the markers", () => {
    const answer = (status: number, degraded = false) =>
      new Response("{}", {
        status,
        headers: {
          "content-type": "application/json",
          [cacheClassHeader]: "series",
          ...(degraded ? { [degradedHeader]: "1" } : {}),
        },
      })
    const fine = withDataPolicy(answer(200))
    expect(fine.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    )
    expect(fine.headers.has(cacheClassHeader)).toBe(false)
    const failed = withDataPolicy(answer(200, true))
    expect(failed.headers.get("cache-control")).toBe(noStore)
    expect(failed.headers.has(degradedHeader)).toBe(false)
    expect(withDataPolicy(answer(500)).headers.get("cache-control")).toBe(
      noStore,
    )
    // Another function's class is not applied, only stripped.
    const list = withDataPolicy(
      new Response("{}", {
        headers: { [cacheClassHeader]: "list", "cache-control": "private" },
      }),
    )
    expect(list.headers.get("cache-control")).toBe("private")
    expect(list.headers.has(cacheClassHeader)).toBe(false)
    const plain = new Response("{}")
    expect(withDataPolicy(plain)).toBe(plain)
  })

  it("treats an item as final two minutes after its timestamp", () => {
    expect(classForAge(1_000, 1_119)).toBe("fresh")
    expect(classForAge(1_000, 1_120)).toBe("final")
    expect(classForAge(null, 1_120)).toBe("fresh")
  })

  it("reads the shared max age", () => {
    expect(sharedMaxAge(null)).toBe(0)
    expect(sharedMaxAge(noStore)).toBe(0)
    expect(sharedMaxAge("public, max-age=0, s-maxage=4")).toBe(4)
  })
})
