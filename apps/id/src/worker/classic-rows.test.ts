import { signingJwksSchema } from "@matchbox/contracts/oidc"
import type { OidcScope } from "@matchbox/contracts/scopes"
import { describe, expect, it } from "vitest"
import classic from "./fixtures/classic-5c657b5.json"
import { createSigningKeys } from "./oidc/keys"
import type { IdStore } from "./store/id-store"
import { memorySeed } from "./store/memory-store"
import {
  authorize,
  basicAuth,
  createHarness,
  devAccount,
  type Harness,
  pkce,
  signIn,
  siweMessage,
  tokenRequest,
  url,
  verifySiwe,
} from "./test-harness"

/** A fixture token, stored as its three parts (no whole JWT in the repo). */
function jwt(parts: {
  header: string
  payload: string
  signature: string
}): string {
  return [parts.header, parts.payload, parts.signature].join(".")
}

/**
 * Rows Classic Matchbox ID wrote, replayed into the ported server: the
 * values were captured at Classic's store boundary during real flows run
 * through Classic's own harness (fixtures/README.md). Each is written with
 * the store's own write method, exactly as Classic's code wrote it, and
 * then used through the ported server's real endpoints.
 */

const rows = classic.rows

function scopes(values: readonly string[]): OidcScope[] {
  return values.filter((value): value is OidcScope =>
    [
      "openid",
      "wallet",
      "discord:id",
      "discord:profile",
      "discord:membership",
    ].includes(value),
  )
}

/** The Classic grant, for the account the ported server knows the wallet as. */
async function classicGrant(harness: Harness): Promise<string> {
  const account = await harness.store.upsertAccountForSignIn(
    memorySeed.devWallet,
    harness.clock.now,
  )
  const grant = await harness.store.createGrant(
    {
      ...rows.grant,
      accountId: account.id,
      scopes: scopes(rows.grant.scopes),
      declinedScopes: scopes(rows.grant.declinedScopes),
    },
    harness.clock.now,
  )
  return grant.id
}

describe("rows Classic wrote", () => {
  it("use the same peppers as Classic's harness", async () => {
    const harness = await createHarness()
    expect(harness.deps.config.sessionPepper).toBe(rows.sessionPepper)
    expect(harness.deps.config.clientSecretPepper).toBe(rows.clientSecretPepper)
  })

  it("refreshes with a refresh token Classic issued", async () => {
    const harness = await createHarness()
    const grantId = await classicGrant(harness)
    const issued = rows.refreshToken.issued
    const result = await harness.store.issueCodeTokens({
      ...issued,
      grantId,
      scopes: scopes(issued.scopes),
      authTime: new Date(issued.authTime),
      refreshExpiresAt: new Date(issued.refreshExpiresAt),
      accessExpiresAt: new Date(issued.accessExpiresAt),
      now: new Date(issued.now),
    })
    expect(result).toBe("issued")
    const response = await tokenRequest(harness, {
      grant_type: "refresh_token",
      refresh_token: rows.refreshToken.plaintext,
      client_id: memorySeed.testClientId,
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { refresh_token?: string }
    expect(body.refresh_token).not.toBe(rows.refreshToken.plaintext)
  })

  it("redeems an authorization code Classic stored, with its PKCE verifier", async () => {
    const harness = await createHarness()
    const grantId = await classicGrant(harness)
    const code = rows.code.row
    await harness.store.createAuthorizationCode({
      ...code,
      grantId,
      scopes: scopes(code.scopes),
      authTime: new Date(code.authTime),
      expiresAt: new Date(code.expiresAt),
    })
    const response = await tokenRequest(harness, {
      grant_type: "authorization_code",
      code: rows.code.plaintext,
      code_verifier: rows.code.verifier,
      redirect_uri: code.redirectUri,
      client_id: memorySeed.testClientId,
    })
    expect(response.status).toBe(200)
  })

  it("skips consent for a grant Classic recorded", async () => {
    expect(rows.grantSkippedConsent).toBe(true)
    const harness = await createHarness()
    const cookie = await signIn(harness)
    await classicGrant(harness)
    const location = await authorize(harness, cookie, {
      pkce: await pkce(),
      scope: "openid wallet",
    })
    // Silent approval: straight back to the app with a code, no consent page.
    expect(`${location.origin}${location.pathname}`).toBe(
      memorySeed.testRedirectUris[0],
    )
    expect(location.searchParams.get("code")).not.toBeNull()
    expect(location.searchParams.get("request")).toBeNull()
  })

  it("authenticates a confidential client with a secret Classic hashed", async () => {
    const wrapped = (store: IdStore): IdStore => ({
      ...store,
      async listClientSecrets(environmentId) {
        // The stored row as Classic wrote it: its prefix and its hash.
        return (await store.listClientSecrets(environmentId)).map((secret) => ({
          ...secret,
          prefix: rows.clientSecret.prefix,
          secretHash: rows.clientSecret.hash,
        }))
      },
    })
    const harness = await createHarness({ wrapStore: wrapped })
    const cookie = await signIn(harness)
    const challenge = await pkce()
    const location = await authorize(harness, cookie, {
      pkce: challenge,
      clientId: memorySeed.liveClientId,
      redirectUri: memorySeed.liveRedirectUris[0],
      scope: "openid wallet",
    })
    const requestId = location.searchParams.get("request") ?? ""
    const decided = await harness.app.request(
      url(`/api/authorization-requests/${requestId}/decision`),
      {
        method: "POST",
        headers: {
          Origin: "https://id.test",
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({ decision: "approve" }),
      },
    )
    const { redirectTo } = (await decided.json()) as { redirectTo: string }
    const code = new URL(redirectTo).searchParams.get("code") ?? ""
    const exchange = (secret: string) =>
      tokenRequest(
        harness,
        {
          grant_type: "authorization_code",
          code,
          code_verifier: challenge.verifier,
          redirect_uri: memorySeed.liveRedirectUris[0],
        },
        { Authorization: basicAuth(memorySeed.liveClientId, secret) },
      )
    expect((await exchange(`${rows.clientSecret.plaintext}x`)).status).toBe(401)
    expect((await exchange(rows.clientSecret.plaintext)).status).toBe(200)
  })
})

describe("cookies as Classic set them", () => {
  it("signs in and out with Classic's exact Set-Cookie", async () => {
    const harness = await createHarness()
    const verified = await verifySiwe(
      harness,
      await siweMessage(harness, devAccount),
      devAccount,
    )
    const set = verified.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("__Host-mbx_id="))
    expect(set?.replace(/^__Host-mbx_id=[^;]*/, "__Host-mbx_id=<token>")).toBe(
      classic.cookies.idSignIn,
    )
    const out = await harness.app.request(url("/api/session/sign-out"), {
      method: "POST",
      headers: { Origin: "https://id.test", Cookie: set?.split(";")[0] ?? "" },
    })
    expect(out.headers.getSetCookie()).toContain(classic.cookies.idSignOut)
  })
})

describe("signing keys", () => {
  it("verifies tokens from either Classic key and signs with the first", async () => {
    const keys = signingJwksSchema.parse(classic.signing.keys)
    const [first, second] = keys
    if (first === undefined || second === undefined) throw new Error("keys")
    expect(first.x).not.toBe(second.x)
    const both = await createSigningKeys(keys)
    const options = {
      issuer: "https://id.matchbox.markets",
      type: "JWT" as const,
      currentDate: new Date("2027-01-01T00:00:00Z"),
    }
    expect(
      (await both.verify(jwt(classic.signing.classicSignedIdToken), options))
        ?.sub,
    ).toBe("mbx_fixture")
    expect(
      (await both.verify(jwt(classic.signing.signedBySecondKey), options))?.sub,
    ).toBe("mbx_second")
    // Each token verifies only with the key that signed it.
    const onlyFirst = await createSigningKeys([first])
    expect(
      await onlyFirst.verify(jwt(classic.signing.signedBySecondKey), options),
    ).toBeNull()
    const onlySecond = await createSigningKeys([second])
    expect(
      await onlySecond.verify(
        jwt(classic.signing.classicSignedIdToken),
        options,
      ),
    ).toBeNull()
    const ours = await both.sign(
      { iss: options.issuer, sub: "x" },
      { type: "JWT" },
    )
    expect((await onlyFirst.verify(ours, options))?.sub).toBe("x")
    expect(await onlySecond.verify(ours, options)).toBeNull()
  })
})
