import { meResponseSchema } from "@matchbox/contracts/console"
import { afterEach, describe, expect, it, vi } from "vitest"
import classic from "./fixtures/classic-5c657b5.json"
import { createHarness, type Harness } from "./test/harness"

/**
 * The console's real create paths against Classic's (fixtures/README.md):
 * Classic's generator ran each request with every crypto.getRandomValues
 * call drawing from one seeded stream. Given the same seed, the ported
 * routes must produce the same plaintext and store the same hash, so a
 * key, secret, invitation or nonce Classic issued is one this code would
 * have issued and will accept.
 */

const created = classic.created

/** The generator's stream: the same LCG, byte by byte. */
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

async function withSeed<T>(seed: number, run: () => Promise<T>): Promise<T> {
  const original = crypto.getRandomValues
  crypto.getRandomValues = seededRandom(seed) as typeof crypto.getRandomValues
  try {
    return await run()
  } finally {
    crypto.getRandomValues = original
  }
}

/** The generator's setup: an owner with a step-up, an org, an app. */
async function seededSetup(): Promise<{
  harness: Harness
  cookie: string
  orgId: string
  liveId: string
}> {
  const harness = createHarness()
  const owner = await harness.account("seeded@example.com")
  const cookie = await harness.signIn(owner, { steppedUp: true })
  const org = await harness.organization(owner)
  const app = await harness.appWithEnvironments(org.id)
  return { harness, cookie, orgId: org.id, liveId: app.live.id }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("Classic's create paths, run again here with the same randomness", () => {
  it("create the same API key and store the same hash", async () => {
    const { harness, cookie, liveId } = await seededSetup()
    const response = await withSeed(created.apiKey.seed, () =>
      harness.request("POST", `/api/environments/${liveId}/api-keys`, {
        cookie,
        body: { kind: "secret", name: "Seeded" },
      }),
    )
    expect(response.status).toBe(created.status.key)
    expect(((await response.json()) as { key: string }).key).toBe(
      created.apiKey.plaintext,
    )
    const [row] = await harness.store.listApiKeys(liveId)
    expect({ prefix: row?.prefix, secretHash: row?.secretHash }).toEqual({
      prefix: created.apiKey.prefix,
      secretHash: created.apiKey.secretHash,
    })
  })

  it("create the same client secret and store the same hash", async () => {
    const { harness, cookie, liveId } = await seededSetup()
    const response = await withSeed(created.clientSecret.seed, () =>
      harness.request("POST", `/api/environments/${liveId}/client-secrets`, {
        cookie,
        body: {},
      }),
    )
    expect(response.status).toBe(created.status.secret)
    expect(((await response.json()) as { secret: string }).secret).toBe(
      created.clientSecret.plaintext,
    )
    const [row] = await harness.store.listClientSecrets(liveId)
    expect({ prefix: row?.prefix, secretHash: row?.secretHash }).toEqual({
      prefix: created.clientSecret.prefix,
      secretHash: created.clientSecret.secretHash,
    })
  })

  it("send the same invitation token, store the same hash, and accept it", async () => {
    const { harness, cookie, orgId } = await seededSetup()
    const response = await withSeed(created.invitation.seed, () =>
      harness.request("POST", `/api/orgs/${orgId}/invitations`, {
        cookie,
        body: { email: "invitee@example.com", role: "developer" },
      }),
    )
    expect(response.status).toBe(created.status.invitation)
    const sent = harness.email.sent.at(-1)?.text ?? ""
    expect(/\/invite\/([A-Za-z0-9_-]+)/.exec(sent)?.[1]).toBe(
      created.invitation.token,
    )
    const [row] = await harness.store.listInvitations(orgId)
    expect(row?.tokenHash).toBe(created.invitation.tokenHash)

    // Classic's emailed token works here for the invited person.
    const invitee = await harness.account("invitee@example.com")
    const accepted = await harness.request("POST", "/api/invitations/accept", {
      cookie: await harness.signIn(invitee),
      body: { token: created.invitation.token },
    })
    expect(accepted.status).toBe(200)
  })

  it("issue the same Google nonce, and accept the one Classic issued", async () => {
    const harness = createHarness()
    const response = await withSeed(created.googleNonce.seed, () =>
      harness.request("POST", "/api/auth/google/nonce", {
        body: { purpose: "sign-in" },
      }),
    )
    expect(response.status).toBe(created.status.nonce)
    expect(((await response.json()) as { nonce: string }).nonce).toBe(
      created.googleNonce.nonce,
    )
    const binding = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("__Host-mbx_dev_google="))
      ?.split(";")[0]
    expect(binding).toBe(created.googleNonce.binding)

    // A browser holding Classic's nonce and binding signs in here.
    const fresh = createHarness()
    const signedIn = await fresh.request("POST", "/api/auth/google", {
      cookie: created.googleNonce.binding,
      body: {
        credential: fresh.googleToken({
          sub: "google-nonce-sub",
          email: "nonce@example.com",
          nonce: created.googleNonce.nonce,
        }),
      },
    })
    expect(signedIn.status).toBe(200)
  })

  it("sign an existing Classic account in with Google, not a new one", async () => {
    const harness = createHarness()
    const row = created.googleAccount
    // Classic's row, id included, as the shared database holds it.
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(
      row.id as `${string}-${string}-${string}-${string}-${string}`,
    )
    const stored = await harness.store.createAccount({
      email: row.email,
      displayName: row.displayName,
      emailVerifiedAt: row.emailVerifiedAt,
      googleSub: row.googleSub,
      avatarUrl: row.avatarUrl,
    })
    expect(stored.id).toBe(row.id)
    vi.restoreAllMocks()
    const signedIn = await harness.googleSignIn({
      sub: row.googleSub,
      email: row.email,
    })
    expect(signedIn.response.status).toBe(200)
    const me = meResponseSchema.parse(await signedIn.response.json())
    expect(me.account).toMatchObject({
      id: row.id,
      email: row.email,
      displayName: row.displayName,
    })
    expect((await harness.store.findAccountByEmail(row.email))?.id).toBe(row.id)
  })
})
