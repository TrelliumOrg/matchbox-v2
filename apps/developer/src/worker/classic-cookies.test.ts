import { describe, expect, it } from "vitest"
import { sessionLifetimeMs, sessionTouchIntervalMs } from "./auth/session"
import classic from "./fixtures/classic-5c657b5.json"
import { createHarness } from "./test/harness"

/**
 * The console session cookie exactly as Classic set it, captured from
 * Classic's own harness (fixtures/README.md): Google sign-in, the refresh
 * after the 5 minute touch interval, and sign-out.
 */

function sessionCookie(response: Response): string | undefined {
  return response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith("__Host-mbx_dev="))
}

function shape(cookie: string | undefined): string | undefined {
  return cookie?.replace(/^__Host-mbx_dev=[^;]*/, "__Host-mbx_dev=<token>")
}

describe("console session cookie", () => {
  it("keeps Classic's lifetime and touch interval", () => {
    expect(sessionLifetimeMs).toBe(12 * 60 * 60_000)
    expect(sessionTouchIntervalMs).toBe(5 * 60_000)
  })

  it("is set at sign-in with Classic's name, lifetime and attributes", async () => {
    const harness = createHarness()
    const signedIn = await harness.googleSignIn({
      sub: "google-dev",
      email: "dev@example.com",
    })
    expect(shape(sessionCookie(signedIn.response))).toBe(
      classic.cookies.consoleSignIn,
    )
  })

  it("slides after the touch interval exactly as Classic's did", async () => {
    const harness = createHarness()
    const cookie = await harness.signIn(await harness.account("a@example.com"))
    harness.advance(4 * 60_000)
    const early = await harness.request("GET", "/api/me", { cookie })
    expect(sessionCookie(early)).toBeUndefined()
    harness.advance(2 * 60_000)
    const touched = await harness.request("GET", "/api/me", { cookie })
    expect(shape(sessionCookie(touched))).toBe(
      classic.cookies.consoleTouchedAfter6Minutes,
    )
  })

  it("is cleared at sign-out exactly as Classic cleared it", async () => {
    const harness = createHarness()
    const cookie = await harness.signIn(await harness.account("b@example.com"))
    const out = await harness.request("POST", "/api/auth/sign-out", { cookie })
    expect(sessionCookie(out)).toBe(classic.cookies.consoleSignOut)
  })
})
