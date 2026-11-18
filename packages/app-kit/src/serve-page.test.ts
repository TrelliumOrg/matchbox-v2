// @vitest-environment node
// Set-Cookie is a forbidden header in a browser-like environment.
import { describe, expect, it } from "vitest"
import { internalReads, servePage } from "./serve-page"

/** Ported from Matchbox ID's serve-page tests (apps/id/src/shared). */

const origin = "https://id.matchbox.markets"

function serve(
  path: string,
  answer: () => Response,
  readAnswer: Response = new Response("{}"),
): Promise<Response> {
  return servePage({
    request: new Request(`${origin}${path}`),
    nonce: "n0nce",
    nonceHeader: "x-matchbox-csp-nonce",
    read: async () => readAnswer,
    start: async (request) => {
      expect(request.headers.get("x-matchbox-csp-nonce")).toBe("n0nce")
      const read = internalReads.getStore()
      if (read === undefined) throw new Error("no internal reads")
      await read(`${origin}/api/session`, new Headers())
      return answer()
    },
    documentHeaders: () => ({
      "Content-Security-Policy": "script-src 'nonce-n0nce' 'strict-dynamic'",
      "X-Frame-Options": "DENY",
    }),
  })
}

function html(): Response {
  return new Response("<html></html>", {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

describe("servePage", () => {
  it("answers private and no-store, with HSTS and nosniff, whatever Start answers", async () => {
    for (const answer of [
      html,
      () => Response.json({ account: null }),
      () => new Response(null, { status: 307, headers: { location: "/" } }),
    ]) {
      const response = await serve("/?tab=sessions", answer)
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      expect(response.headers.get("strict-transport-security")).toContain(
        "max-age=63072000",
      )
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    }
  })

  it("adds the document headers to HTML only", async () => {
    const page = await serve("/", html)
    expect(page.headers.get("content-security-policy")).toContain(
      "'nonce-n0nce'",
    )
    const json = await serve("/", () => Response.json({}))
    expect(json.headers.get("content-security-policy")).toBeNull()
  })

  it("drops a client's nonce header for the Worker's own", async () => {
    const response = await servePage({
      request: new Request(`${origin}/`, {
        headers: { "x-matchbox-csp-nonce": "forged" },
      }),
      nonce: "real",
      nonceHeader: "x-matchbox-csp-nonce",
      read: async () => new Response("{}"),
      start: async (request) =>
        new Response(request.headers.get("x-matchbox-csp-nonce")),
      documentHeaders: () => ({}),
    })
    expect(await response.text()).toBe("real")
  })

  it("passes on cookies the server's own routes set while a page renders", async () => {
    const response = await serve(
      "/",
      html,
      new Response("{}", {
        headers: { "set-cookie": "__Host-mbx_id=; Max-Age=0; Path=/" },
      }),
    )
    expect(response.headers.getSetCookie()).toEqual([
      "__Host-mbx_id=; Max-Age=0; Path=/",
    ])
  })

  it("still answers with the base headers and the cookies when Start throws", async () => {
    const response = await serve(
      "/",
      () => {
        throw new TypeError("render failed: secret detail")
      },
      new Response("{}", {
        headers: { "set-cookie": "__Host-mbx_id=; Max-Age=0; Path=/" },
      }),
    )
    expect(response.status).toBe(500)
    expect(await response.text()).toBe("Something went wrong")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.getSetCookie()).toEqual([
      "__Host-mbx_id=; Max-Age=0; Path=/",
    ])
  })
})
