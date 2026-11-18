import { describe, expect, it } from "vitest"
import { docsOrigin, docsRedirect, docsTarget } from "./docs-redirect"

const console = "https://developer.matchbox.markets"

function target(path: string, configured?: string): string | null {
  return docsTarget(new URL(`${console}${path}`), configured)
}

describe("Classic docs URLs", () => {
  it("move under /developer on the docs origin, keeping path and query", () => {
    expect(target("/docs")).toBe("https://docs.matchbox.markets/developer")
    expect(target("/docs/")).toBe("https://docs.matchbox.markets/developer")
    expect(target("/docs/guides/v1.2_x~y")).toBe(
      "https://docs.matchbox.markets/developer/guides/v1.2_x~y",
    )
    expect(target("/docs/oidc")).toBe(
      "https://docs.matchbox.markets/developer/oidc",
    )
    expect(target("/docs/reference?tag=gauges")).toBe(
      "https://docs.matchbox.markets/developer/reference?tag=gauges",
    )
    expect(target("/docs/changelog", "https://docs.example.test")).toBe(
      "https://docs.example.test/developer/changelog",
    )
  })

  it("leave every other path alone", () => {
    for (const path of ["/", "/apps", "/docsx", "/api/docs"]) {
      expect(target(path)).toBeNull()
    }
  })

  it("never leave the docs origin", () => {
    for (const path of [
      "/docs//evil.com",
      "/docs/..//evil.com",
      "/docs/%2e%2e//evil.com",
      "/docs/\\evil.com",
      "/docs/%2e%2e",
    ]) {
      // Either no redirect at all (the URL normalised out of /docs) or one
      // that stays on the docs origin.
      const result = target(path)
      if (result !== null) {
        expect(new URL(result).origin).toBe("https://docs.matchbox.markets")
      }
    }
  })

  it("send anything but plain segments to the docs home", () => {
    const home = "https://docs.matchbox.markets/developer"
    for (const path of [
      "/docs/..%2f..%2fadmin",
      "/docs/..%2F..%2Fadmin",
      "/docs/%2F%2Fevil.com",
      "/docs/%2f%2fevil.com",
      "/docs/%5Cevil.com",
      "/docs/a%09b",
      "/docs/%2e",
      "/docs/a%2fb",
      "/docs/a//b",
      "/docs/a/",
      "/docs/a b",
      "/docs/a%20b",
      "/docs/@evil.com",
      "/docs/a:b",
      "/docs/%00",
    ]) {
      expect({ path, target: target(path) }).toEqual({ path, target: home })
    }
  })

  it("keep the query on the docs origin", () => {
    expect(target("/docs/errors?code=a%2Fb")).toBe(
      "https://docs.matchbox.markets/developer/errors?code=a%2Fb",
    )
  })

  it("only accept a plain https origin as configuration", () => {
    expect(docsOrigin("https://docs.example.test/")).toBe(
      "https://docs.example.test",
    )
    for (const bad of [
      "http://docs.example.test",
      "https://docs.example.test/path",
      "https://user@docs.example.test",
      "javascript:alert(1)",
      "",
      undefined,
    ]) {
      expect(docsOrigin(bad)).toBe("https://docs.matchbox.markets")
    }
  })

  it("answer a temporary redirect", () => {
    const response = docsRedirect(new URL(`${console}/docs/oidc`), undefined)
    expect(response?.status).toBe(302)
    expect(response?.headers.get("location")).toBe(
      "https://docs.matchbox.markets/developer/oidc",
    )
  })
})
