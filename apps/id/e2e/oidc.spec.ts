import { createHash, randomBytes } from "node:crypto"
import { expect, type Page, test } from "@playwright/test"
import { privateKeyToAccount } from "viem/accounts"

/**
 * Matchbox ID flows a cutover must not break, on the memory store's seed
 * (worker/store/memory-store.ts `memorySeed`): the public test client on
 * Mezo testnet, signed in with an injected EIP-6963 wallet that signs in
 * Node with Hardhat account #0 (a well-known local key, never a real
 * wallet; the seed's dev wallet).
 */

const wallet = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
)
const clientId = "mbx_test_ExampleTestClient0000001"
const redirectUri = "http://localhost:5174/callback"
const testnet = 31611

function watchConsole(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

/** An EIP-1193 wallet announced over EIP-6963, signing via Node. */
async function injectWallet(page: Page): Promise<void> {
  await page.exposeFunction("__e2eSign", (raw: `0x${string}`) =>
    wallet.signMessage({ message: { raw } }),
  )
  await page.addInitScript(
    ({ address, chainId }) => {
      type Listener = (...args: unknown[]) => void
      const listeners = new Map<string, Set<Listener>>()
      let chain = chainId
      const emit = (event: string, value: unknown) => {
        for (const listener of listeners.get(event) ?? []) listener(value)
      }
      const sign = (window as unknown as { __e2eSign(raw: string): string })
        .__e2eSign
      const provider = {
        async request({
          method,
          params,
        }: {
          method: string
          params?: unknown[]
        }): Promise<unknown> {
          switch (method) {
            case "eth_requestAccounts":
            case "eth_accounts":
              return [address]
            case "eth_chainId":
              return `0x${chain.toString(16)}`
            case "net_version":
              return String(chain)
            case "wallet_requestPermissions":
            case "wallet_getPermissions":
              return [{ parentCapability: "eth_accounts" }]
            case "wallet_revokePermissions":
              return null
            case "wallet_switchEthereumChain": {
              const next =
                (params?.[0] as { chainId?: string } | undefined)?.chainId ??
                "0x0"
              chain = Number.parseInt(next, 16)
              emit("chainChanged", next)
              return null
            }
            case "personal_sign":
              return sign(String(params?.[0]))
            default:
              throw Object.assign(new Error(`Unsupported ${method}`), {
                code: 4200,
              })
          }
        },
        on(event: string, listener: Listener) {
          const set = listeners.get(event) ?? new Set()
          set.add(listener)
          listeners.set(event, set)
        },
        removeListener(event: string, listener: Listener) {
          listeners.get(event)?.delete(listener)
        },
      }
      const detail = Object.freeze({
        info: {
          uuid: "6f1b3c0e-0000-4000-8000-0000000000e2",
          name: "E2E Wallet",
          icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'/%3E",
          rdns: "dev.matchbox.e2e",
        },
        provider,
      })
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", { detail }),
        )
      window.addEventListener("eip6963:requestProvider", announce)
      announce()
    },
    { address: wallet.address, chainId: testnet },
  )
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { verifier, challenge }
}

function authorizeUrl(challenge: string, state: string): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "openid wallet",
    state,
    nonce: `n-${state}`,
    code_challenge: challenge,
    code_challenge_method: "S256",
  })
  return `/oauth/authorize?${query}`
}

/** The client's callback: answered here, its URL handed back. */
async function catchCallback(page: Page): Promise<() => Promise<URL>> {
  let resolve: (url: URL) => void = () => undefined
  const caught = new Promise<URL>((done) => {
    resolve = done
  })
  await page.route("http://localhost:5174/**", async (route) => {
    resolve(new URL(route.request().url()))
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Callback</title>",
    })
  })
  return () => caught
}

async function signInWithWallet(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Connect wallet" }).click()
  await page.getByRole("button", { name: /E2E Wallet/ }).click()
  await page.getByRole("button", { name: "Sign message" }).click()
}

async function exchange(
  page: Page,
  form: Record<string, string>,
): Promise<{
  access_token: string
  refresh_token: string
  id_token?: string
  scope: string
}> {
  const response = await page.request.post("/oauth/token", { form })
  expect(response.status(), await response.text()).toBe(200)
  return (await response.json()) as {
    access_token: string
    refresh_token: string
    id_token?: string
    scope: string
  }
}

// Far from the server's UTC, so a page that renders local dates during
// hydration fails on a console error (React 418).
test.use({ timezoneId: "Asia/Kolkata" })

let errors: string[] = []

test.beforeEach(async ({ page }) => {
  errors = watchConsole(page)
  await injectWallet(page)
})

test.afterEach(() => {
  expect(errors).toEqual([])
})

test("signs in, consents, exchanges the code, refreshes, approves silently and signs out", async ({
  page,
}) => {
  const callback = await catchCallback(page)
  const first = pkce()
  await page.goto(authorizeUrl(first.challenge, "first"))
  await expect(page).toHaveURL(/\/sign-in/)
  await signInWithWallet(page)

  await expect(page).toHaveURL(/\/authorize/)
  await page.getByRole("button", { name: "Allow" }).click()
  const returned = await callback()
  expect(returned.searchParams.get("state")).toBe("first")
  const code = returned.searchParams.get("code") ?? ""
  expect(code).not.toBe("")

  const tokens = await exchange(page, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: first.verifier,
  })
  expect(tokens.id_token?.split(".")).toHaveLength(3)
  const userinfo = await page.request.get("/oauth/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  expect(userinfo.status()).toBe(200)
  const claims = (await userinfo.json()) as { wallet_address?: string }
  expect(claims.wallet_address?.toLowerCase()).toBe(
    wallet.address.toLowerCase(),
  )

  const refreshed = await exchange(page, {
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    client_id: clientId,
  })
  expect(refreshed.refresh_token).not.toBe(tokens.refresh_token)
  // The rotated-away refresh token is spent (reuse revokes the family).
  const reused = await page.request.post("/oauth/token", {
    form: {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    },
  })
  expect(reused.status()).toBe(400)
  // Reuse revokes the whole family: the successor is refused as well, and
  // so is the access token issued with it.
  const successor = await page.request.post("/oauth/token", {
    form: {
      grant_type: "refresh_token",
      refresh_token: refreshed.refresh_token,
      client_id: clientId,
    },
  })
  expect(successor.status()).toBe(400)
  const revokedAccess = await page.request.get("/oauth/userinfo", {
    headers: { Authorization: `Bearer ${refreshed.access_token}` },
  })
  expect(revokedAccess.status()).toBe(401)

  // Same scopes again: the existing grant approves without a consent
  // screen, straight back to the client with a new code.
  const second = pkce()
  const silent = await page.request.get(
    authorizeUrl(second.challenge, "second"),
    { maxRedirects: 0 },
  )
  expect(silent.status()).toBe(302)
  const location = new URL(silent.headers().location ?? "")
  expect(`${location.origin}${location.pathname}`).toBe(redirectUri)
  expect(location.searchParams.get("state")).toBe("second")
  expect(location.searchParams.get("code")).not.toBeNull()

  // Revoking the connected app ends silent approval: consent again.
  await page.goto("/", { waitUntil: "networkidle" })
  await page.getByRole("button", { name: "Revoke" }).first().click()
  await page
    .getByRole("region", { name: "Revoke Matchbox Example" })
    .getByRole("button", { name: "Revoke" })
    .click()
  await expect(page.getByText("No connected apps")).toBeVisible()
  const third = pkce()
  const consentAgain = await page.request.get(
    authorizeUrl(third.challenge, "third"),
    { maxRedirects: 0 },
  )
  expect(consentAgain.status()).toBe(302)
  expect(
    new URL(consentAgain.headers().location ?? "", page.url()).pathname,
  ).toBe("/authorize")

  // Times are local: in India (UTC+5:30) every one differs from the
  // server's UTC render, so local text during hydration would fail here.
  await page.goto("/?tab=sessions", { waitUntil: "networkidle" })
  await expect(page.getByText("This device").first()).toBeVisible()

  await page.getByRole("button", { name: "Account menu" }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/sign-in/)
  const session = (await (await page.request.get("/api/session")).json()) as {
    account: unknown
  }
  expect(session.account).toBeNull()
})

/** Sideways scroll, and the first theme-color meta (the one that wins). */
async function phoneLayout(
  page: Page,
): Promise<{ overflow: number; themeColor: string | null }> {
  return page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    themeColor:
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content") ?? null,
  }))
}

test("sign-in, consent and the error page fit at 360 and at a wallet browser's 390 by 664", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "phone layout")
  for (const size of [
    { width: 360, height: 780 },
    { width: 390, height: 664 },
  ]) {
    await page.setViewportSize(size)
    const flow = pkce()
    await page.goto(authorizeUrl(flow.challenge, "phone"))
    await expect(page).toHaveURL(/\/sign-in/)
    await page.waitForLoadState("networkidle")
    let layout = await phoneLayout(page)
    expect(layout.overflow, `sign-in at ${size.width}`).toBeLessThanOrEqual(0)
    expect(layout.themeColor).not.toBeNull()
    await signInWithWallet(page)
    await expect(page).toHaveURL(/\/authorize/)
    await expect(page.getByRole("button", { name: "Allow" })).toBeVisible()
    layout = await phoneLayout(page)
    expect(layout.overflow, `consent at ${size.width}`).toBeLessThanOrEqual(0)
    const allow = await page
      .getByRole("button", { name: "Allow" })
      .boundingBox()
    expect(allow?.height ?? 0).toBeGreaterThanOrEqual(44)
    await page.goto("/error?code=access_denied", { waitUntil: "networkidle" })
    layout = await phoneLayout(page)
    expect(layout.overflow, `error at ${size.width}`).toBeLessThanOrEqual(0)
    // Signed out and the wallet forgotten, so the next size signs in afresh.
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.context().clearCookies()
  }
})
