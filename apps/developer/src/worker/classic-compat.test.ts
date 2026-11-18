import {
  formatApiKey,
  formatClientSecret,
  parseApiKey,
  parseClientSecret,
} from "@matchbox/contracts/credentials"
import { hmacHex, hostCookieName, sessionCookieNames } from "@matchbox/server"
import { describe, expect, it } from "vitest"
import { sessionTokenHash } from "./auth/session"
import classic from "./fixtures/classic-5c657b5.json"
import { createHarness, sessionPepper } from "./test/harness"

/**
 * Continuity with the Classic developer console. Every expected value was
 * produced by CLASSIC's own code (MallardLabs/Matchbox 5c657b5, run
 * read-only; see fixtures/README.md). API keys and client secrets Classic
 * issued, and console sessions it started, must keep working with no
 * migration and no re-issue.
 */
describe("Classic data continuity", () => {
  it("stores the same hash for a Classic API key (API_KEY_PEPPER)", async () => {
    expect(await hmacHex(classic.peppers.apiKey, classic.apiKey.value)).toBe(
      classic.apiKey.hash,
    )
    expect(
      await hmacHex(classic.peppers.apiKey, classic.publishableKey.value),
    ).toBe(classic.publishableKey.hash)
  })

  it("parses and formats Classic API keys identically", () => {
    const parsed = parseApiKey(classic.apiKey.value)
    expect(parsed).toEqual(classic.apiKey.parsed)
    expect(parsed === null ? null : formatApiKey(parsed)).toBe(
      classic.apiKey.value,
    )
    expect(parseApiKey(classic.publishableKey.value)?.kind).toBe("publishable")
  })

  it("stores the same hash for a Classic client secret (CLIENT_SECRET_PEPPER)", async () => {
    expect(
      await hmacHex(classic.peppers.clientSecret, classic.clientSecret.value),
    ).toBe(classic.clientSecret.hash)
    const parsed = parseClientSecret(classic.clientSecret.value)
    expect(parsed?.prefix).toBe("ZyXwVuTsRqPo")
    expect(parsed === null ? null : formatClientSecret(parsed)).toBe(
      classic.clientSecret.value,
    )
  })

  it("hashes console sessions as Classic (session: prefix) under the same cookie", async () => {
    expect(
      await sessionTokenHash(
        classic.peppers.session,
        classic.consoleSession.token,
      ),
    ).toBe(classic.consoleSession.hash)
    expect(hostCookieName(sessionCookieNames.developerConsole)).toBe(
      classic.consoleSession.cookieName,
    )
  })

  it("accepts a console session row Classic wrote", async () => {
    expect(sessionPepper).toBe(classic.consoleSession.harnessPepper)
    const harness = createHarness()
    const account = await harness.account("dev@example.com")
    const createdAt = harness.now()
    await harness.store.createSession({
      accountId: account.id,
      // Classic's stored hash for this cookie value, under the harness pepper.
      tokenHash: classic.consoleSession.harnessHash,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + 3_600_000).toISOString(),
      userAgent: null,
      ipPrefix: null,
      steppedUpAt: null,
    })
    const response = await harness.request("GET", "/api/me", {
      cookie: `${classic.consoleSession.cookieName}=${classic.consoleSession.token}`,
    })
    expect(response.status).toBe(200)
    const me = (await response.json()) as { account: { email: string } }
    expect(me.account.email).toBe("dev@example.com")
  })
})
