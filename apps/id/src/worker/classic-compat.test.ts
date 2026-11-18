import { signingJwksSchema } from "@matchbox/contracts/oidc"
import { hmacHex } from "@matchbox/server"
import { describe, expect, it } from "vitest"
import classic from "./fixtures/classic-5c657b5.json"
import { createSigningKeys } from "./oidc/keys"
import { opaqueTokenHash } from "./oidc/tokens"
import { serializeLaxSessionCookie, sessionTokenHash } from "./session"
import { memorySeed } from "./store/memory-store"
import {
  createHarness,
  exchangeCode,
  obtainCode,
  pkce,
  signIn,
  url,
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
 * Continuity with Classic Matchbox ID. Every expected value here was
 * produced by CLASSIC's own code (MallardLabs/Matchbox 5c657b5, run
 * read-only; see fixtures/README.md), never by the ported code. Existing
 * sessions, refresh tokens, client secrets, signing keys and the tokens
 * apps already hold must keep working after the cutover without a data
 * migration or re-issue.
 */

function decode(part: string | undefined): unknown {
  return JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8"))
}

describe("Classic data continuity", () => {
  it("hashes session tokens, codes and refresh tokens exactly as Classic", async () => {
    const { deps } = await createHarness()
    deps.config.sessionPepper = classic.peppers.session
    expect(
      await hmacHex(classic.peppers.session, classic.idSession.token),
    ).toBe(classic.idSession.hash)
    expect(await sessionTokenHash(deps, classic.idSession.token)).toBe(
      classic.idSession.hash,
    )
    expect(await opaqueTokenHash(deps, classic.idSession.token)).toBe(
      classic.idSession.hash,
    )
  })

  it("hashes client secrets exactly as Classic (CLIENT_SECRET_PEPPER)", async () => {
    expect(
      await hmacHex(classic.peppers.clientSecret, classic.clientSecret.value),
    ).toBe(classic.clientSecret.hash)
  })

  it("sets the same session cookie: name, attributes and lifetime", () => {
    expect(serializeLaxSessionCookie(classic.idSession.token, 2_592_000)).toBe(
      classic.idSession.setCookie,
    )
    expect(classic.idSession.cookieName).toBe("__Host-mbx_id")
  })

  it("accepts a session row Classic wrote", async () => {
    const harness = await createHarness()
    harness.deps.config.sessionPepper = classic.peppers.session
    const account = await harness.store.upsertAccountForSignIn(
      memorySeed.devWallet,
      harness.clock.now,
    )
    await harness.store.createSession({
      accountId: account.id,
      createdAt: harness.clock.now,
      // The stored hash Classic computed for this cookie value.
      tokenHash: classic.idSession.hash,
      expiresAt: new Date(harness.clock.now.getTime() + 86_400_000),
      userAgent: null,
      ipPrefix: null,
      siweChainId: 31612,
      signerKind: "eoa",
    })
    const response = await harness.app.request(url("/api/session"), {
      headers: {
        Cookie: `${classic.idSession.cookieName}=${classic.idSession.token}`,
      },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      account: { walletAddress: string } | null
    }
    expect(body.account?.walletAddress).toBe(memorySeed.devWallet)
  })

  it("publishes the same JWKS, signs with the first key and verifies Classic's tokens", async () => {
    const keys = await createSigningKeys(
      signingJwksSchema.parse(classic.signing.keys),
    )
    expect(keys.jwks).toEqual(classic.signing.jwks)
    const verified = await keys.verify(
      jwt(classic.signing.classicSignedIdToken),
      {
        issuer: "https://id.matchbox.markets",
        type: "JWT",
        audience: "mbx_live_ExampleLiveClient0000001",
        currentDate: new Date("2027-01-01T00:00:00Z"),
      },
    )
    expect(verified?.sub).toBe("mbx_fixture")
    const ours = await keys.sign({ sub: "x" }, { type: "JWT" })
    expect(decode(ours.split(".")[0])).toEqual(classic.signing.header)
  })

  it("serves the same discovery document", async () => {
    const harness = await createHarness()
    const discovery = await (
      await harness.app.request(url("/.well-known/openid-configuration"))
    ).json()
    expect(discovery).toEqual(classic.flow.discovery)
  })

  it("issues tokens with Classic's headers, claims and lifetimes", async () => {
    const harness = await createHarness()
    const cookie = await signIn(harness)
    const challenge = await pkce()
    const code = await obtainCode(harness, cookie, {
      pkce: challenge,
      clientId: memorySeed.testClientId,
      redirectUri: memorySeed.testRedirectUris[0],
      scope: "openid wallet",
    })
    const tokens = await exchangeCode(harness, code, challenge.verifier)
    const flow = classic.flow
    expect(Object.keys(tokens).sort()).toEqual(flow.tokenResponseKeys)
    expect(tokens.token_type).toBe(flow.tokenType)
    expect(tokens.expires_in).toBe(flow.expiresIn)
    expect(tokens.scope).toBe(flow.scope)

    const [idHeader, idPayload] = (tokens.id_token ?? "").split(".")
    expect(decode(idHeader)).toEqual(flow.idTokenHeader)
    const id = decode(idPayload) as Record<string, unknown>
    // sub is a stored random pairwise id; every other claim matches.
    const { sub: _classicSub, ...classicId } = flow.idTokenPayload
    const { sub, ...ourId } = id
    expect(typeof sub).toBe("string")
    expect(ourId).toEqual(classicId)

    const [atHeader, atPayload] = tokens.access_token.split(".")
    expect(decode(atHeader)).toEqual(flow.accessTokenHeader)
    const at = decode(atPayload) as Record<string, unknown>
    expect(Object.keys(at).sort()).toEqual(
      Object.keys(flow.accessTokenPayload).sort(),
    )
    for (const claim of ["iss", "aud", "client_id", "scope", "iat", "exp"]) {
      expect(at[claim]).toEqual(
        flow.accessTokenPayload[claim as keyof typeof flow.accessTokenPayload],
      )
    }
  })
})
