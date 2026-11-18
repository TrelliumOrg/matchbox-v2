import { describe, expect, it } from "vitest"
import { classicRedirect } from "./classic-paths"

const notFound = () => new Response("Not found", { status: 404 })

function get(path: string, method = "GET"): Request {
  return new Request(`https://matchbox.markets${path}`, { method })
}

describe("classicRedirect", () => {
  it("sends a path this page lacks to Classic, path and query kept", () => {
    const response = classicRedirect(get("/dashboard?tab=locks"), notFound())
    expect(response?.status).toBe(307)
    expect(response?.headers.get("location")).toBe(
      "https://app.matchbox.markets/dashboard?tab=locks",
    )
    expect(response?.headers.get("cache-control")).toBe("no-store")
  })

  it("covers privacy and HEAD", () => {
    expect(
      classicRedirect(get("/privacy", "HEAD"), notFound())?.headers.get(
        "location",
      ),
    ).toBe("https://app.matchbox.markets/privacy")
  })

  it("leaves what this page answers alone", () => {
    expect(classicRedirect(get("/"), new Response("ok"))).toBeNull()
    expect(
      classicRedirect(get("/x"), new Response(null, { status: 500 })),
    ).toBeNull()
  })

  it("leaves other methods alone", () => {
    expect(classicRedirect(get("/api/x", "POST"), notFound())).toBeNull()
  })

  it("never leaves Classic's origin", () => {
    for (const path of [
      "//evil.example/x",
      "///evil.example",
      "/evil.example",
    ]) {
      const location =
        classicRedirect(get(path), notFound())?.headers.get("location") ?? ""
      expect(new URL(location).origin).toBe("https://app.matchbox.markets")
    }
  })
})
