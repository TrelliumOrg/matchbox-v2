import { describe, expect, it } from "vitest"
import { internalReads, servePage } from "../execution.server"
import { documentSecurityHeaders } from "./csp"

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
    start: async () => {
      const read = internalReads.getStore()
      if (read === undefined) throw new Error("no internal reads")
      await read(`${origin}/api/session`, new Headers())
      return answer()
    },
    documentHeaders: (pathname) =>
      documentSecurityHeaders({ pathname, nonce: "n0nce", development: false }),
  })
}

function html(): Response {
  return new Response("<html></html>", {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

describe("Matchbox ID pages", () => {
  it("are private and no-store, with HSTS and nosniff, whatever Start answers", async () => {
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

  it("send no Referer from /authorize and carry the nonce CSP", async () => {
    const response = await serve("/authorize?request=x", html)
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(response.headers.get("content-security-policy")).toContain(
      "'nonce-n0nce'",
    )
    expect(response.headers.get("x-frame-options")).toBe("DENY")
  })

  it("pass on cookies the OIDC server sets while a page renders", async () => {
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

  it("still answer with the base headers and the cookies when Start throws", async () => {
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
    expect(response.headers.get("strict-transport-security")).toContain(
      "max-age=63072000",
    )
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.getSetCookie()).toEqual([
      "__Host-mbx_id=; Max-Age=0; Path=/",
    ])
  })
})
