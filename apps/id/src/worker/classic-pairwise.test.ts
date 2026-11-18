import { generatePairwiseSubject } from "@matchbox/server"
import { describe, expect, it } from "vitest"
import classic from "./fixtures/classic-5c657b5.json"
import { memorySeed } from "./store/memory-store"
import {
  createHarness,
  exchangeCode,
  obtainCode,
  pkce,
  signIn,
  url,
} from "./test-harness"

/**
 * Pairwise `sub` stability against Classic (fixtures/README.md): `sub` is a
 * random id stored per account and sector, so the same person and client
 * keep Classic's `sub` only if the ported code reads that stored row and
 * never mints a new one. Classic's flow stored `pairwise.subject` for the
 * dev wallet and the seeded test client's sector.
 */

const pairwise = classic.pairwise

/** The generator's stream (classic-fixtures.generator.ts.txt). */
function seededRandom(seed: number) {
  let state = seed >>> 0
  return <T extends ArrayBufferView | null>(array: T): T => {
    if (array === null) return array
    const bytes = new Uint8Array(
      array.buffer,
      array.byteOffset,
      array.byteLength,
    )
    for (let index = 0; index < bytes.length; index += 1) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0
      bytes[index] = state >>> 24
    }
    return array
  }
}

function decode(part: string | undefined): Record<string, unknown> {
  return JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8"))
}

async function idTokenSub(
  harness: Awaited<ReturnType<typeof createHarness>>,
  cookie: string,
): Promise<{ sub: unknown; userinfo: unknown }> {
  const challenge = await pkce()
  const code = await obtainCode(harness, cookie, {
    pkce: challenge,
    clientId: memorySeed.testClientId,
    redirectUri: memorySeed.testRedirectUris[0],
    scope: "openid wallet",
  })
  const tokens = await exchangeCode(harness, code, challenge.verifier)
  const userinfo = await harness.app.request(url("/oauth/userinfo"), {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  return {
    sub: decode((tokens.id_token ?? "").split(".")[1]).sub,
    userinfo: ((await userinfo.json()) as { sub?: unknown }).sub,
  }
}

describe("pairwise subjects", () => {
  it("are generated exactly as Classic generated them", () => {
    const original = crypto.getRandomValues
    crypto.getRandomValues = seededRandom(
      pairwise.seed,
    ) as typeof crypto.getRandomValues
    try {
      expect(generatePairwiseSubject()).toBe(pairwise.generated)
    } finally {
      crypto.getRandomValues = original
    }
  })

  it("keep the sub Classic stored for the same person and client", async () => {
    const harness = await createHarness()
    expect(pairwise.wallet.toLowerCase()).toBe(memorySeed.devWallet)
    expect(pairwise.sectorId).toBe(memorySeed.testEnvironmentId)
    // The account and Classic's pairwise row, as the shared database holds them.
    const account = await harness.store.upsertAccountForSignIn(
      memorySeed.devWallet,
      harness.clock.now,
    )
    await harness.store.getOrCreatePairwiseSubject(
      account.id,
      pairwise.sectorId,
      () => pairwise.subject,
    )
    const cookie = await signIn(harness)
    const first = await idTokenSub(harness, cookie)
    expect(first).toEqual({
      sub: pairwise.subject,
      userinfo: pairwise.subject,
    })
    // And again: the row is read, never replaced.
    expect(await idTokenSub(harness, cookie)).toEqual(first)
  })
})
