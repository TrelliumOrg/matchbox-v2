import { describe, expect, it } from "vitest"
import { internalReads, servePage } from "../execution.server"
import { createHarness } from "./test/harness"

/**
 * Pages read the console server in-process. Whatever cookies those reads
 * answer must reach the browser: the session slides (12 h from the last
 * use) only if the refreshed __Host-mbx_dev cookie is passed on.
 */

const origin = "https://developer.matchbox.markets"

function page(
  harness: ReturnType<typeof createHarness>,
  request: Request,
  render: (read: (path: string) => Promise<Response>) => Promise<Response>,
): Promise<Response> {
  return servePage({
    request,
    nonce: "n0nce",
    nonceHeader: "x-matchbox-csp-nonce",
    read: (url, headers) => harness.app.request(url, { headers }),
    start: (started) =>
      render(async (path) => {
        const read = internalReads.getStore()
        if (read === undefined) throw new Error("no internal reads")
        const headers = new Headers()
        const cookie = started.headers.get("cookie")
        if (cookie !== null) headers.set("cookie", cookie)
        return read(`${origin}${path}`, headers)
      }),
    documentHeaders: () => ({
      "Content-Security-Policy": "script-src 'nonce-n0nce'",
    }),
  })
}

function html(): Response {
  return new Response("<html></html>", {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

describe("server-rendered console pages", () => {
  it("pass on the refreshed session cookie after the touch interval", async () => {
    const harness = createHarness()
    const account = await harness.account("dev@example.com")
    const cookie = await harness.signIn(account)
    harness.advance(6 * 60_000)
    const response = await page(
      harness,
      new Request(`${origin}/`, { headers: { cookie } }),
      async (read) => {
        expect((await read("/api/me")).status).toBe(200)
        return html()
      },
    )
    const [refreshed] = response.headers.getSetCookie()
    expect(refreshed).toContain(`${cookie};`)
    expect(refreshed).toContain("Max-Age=43200")
    expect(refreshed).toContain("HttpOnly")
    // Later browser calls slide it again from here.
    harness.advance(11 * 3_600_000)
    expect((await harness.request("GET", "/api/me", { cookie })).status).toBe(
      200,
    )
  })

  it("pass on the clearing cookie for a revoked session", async () => {
    const harness = createHarness()
    const account = await harness.account("dev@example.com")
    const cookie = await harness.signIn(account)
    const [session] = await harness.store.listSessions(account.id)
    if (session === undefined) throw new Error("no session")
    await harness.store.updateSession(session.id, {
      revokedAt: harness.now().toISOString(),
    })
    const response = await page(
      harness,
      new Request(`${origin}/`, { headers: { cookie } }),
      async (read) => {
        expect((await read("/api/me")).status).toBe(401)
        return html()
      },
    )
    const [cleared] = response.headers.getSetCookie()
    expect(cleared).toMatch(/^__Host-mbx_dev=;.*Max-Age=0/)
  })

  it("mark pages, server-function JSON and redirects private and no-store", async () => {
    const harness = createHarness()
    for (const answer of [
      html(),
      Response.json({ ok: true }),
      new Response(null, { status: 307, headers: { location: "/sign-in" } }),
    ]) {
      const response = await page(
        harness,
        new Request(`${origin}/_serverFn/x`),
        async () => answer,
      )
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      expect(response.headers.get("strict-transport-security")).toContain(
        "max-age=63072000",
      )
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      // The CSP is for documents only.
      expect(response.headers.has("content-security-policy")).toBe(
        answer.headers.get("content-type")?.includes("text/html") === true,
      )
    }
  })

  it("still answer with the base headers and the clearing cookie when Start throws", async () => {
    const harness = createHarness()
    const account = await harness.account("dev@example.com")
    const cookie = await harness.signIn(account)
    const [session] = await harness.store.listSessions(account.id)
    if (session === undefined) throw new Error("no session")
    await harness.store.updateSession(session.id, {
      revokedAt: harness.now().toISOString(),
    })
    const response = await page(
      harness,
      new Request(`${origin}/`, { headers: { cookie } }),
      async (read) => {
        expect((await read("/api/me")).status).toBe(401)
        throw new TypeError("render failed: secret detail")
      },
    )
    expect(response.status).toBe(500)
    expect(await response.text()).toBe("Something went wrong")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("strict-transport-security")).toContain(
      "max-age=63072000",
    )
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    const [cleared] = response.headers.getSetCookie()
    expect(cleared).toMatch(/^__Host-mbx_dev=;.*Max-Age=0/)
  })
})
