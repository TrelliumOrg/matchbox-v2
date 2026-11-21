import { expect, type Page, test } from "@playwright/test"
import openDialog from "./dialog"
import { installFakeWallet, rememberConnected, saveSafe } from "./fake-wallet"

/**
 * Whose wallet a page is, with a wallet in the browser (a fake one, see
 * fake-wallet.ts). The costly failure is an owner locked out of claiming
 * or voting: a page that is not yours must still offer Connect wallet,
 * and your own wallet (connected, remembered, or the Safe you sign for)
 * keeps its actions. Signing always needs the real wallet, so a page that
 * offers too much is harmless; one that offers too little is not.
 */

const demo = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"
const twoLocks = `0x2b0c${"0".repeat(32)}0002`

/** A wallet reconnects once the page is idle: give it time on a phone. */
const reconnect = { timeout: 15_000 }

function header(page: Page) {
  return page.locator("header").first()
}

function connectButton(page: Page) {
  return header(page)
    .getByRole("button", { name: /^Connect/ })
    .filter({ visible: true })
}

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

/** The account wagmi has connected, from its stored state; null if none. */
function connectedAccount(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem("mbx.store") ?? "")
      const state = stored.state
      const current = state.connections.value.find(
        ([uid]: [string]) => uid === state.current,
      )
      return current?.[1].accounts[0]?.toLowerCase() ?? null
    } catch {
      return null
    }
  })
}

test("your connected wallet keeps every action", async ({ page }) => {
  const errors = watchErrors(page)
  await installFakeWallet(page, { address: demo })
  await page.goto("/")
  await openDialog(page, () => connectButton(page).click(), "Connect wallet")
  const drawer = page.getByRole("dialog", { name: "Connect wallet" })
  await drawer.getByRole("button", { name: /Test Wallet/ }).click()
  await expect(drawer).toBeHidden()
  await expect(
    header(page).getByRole("button", { name: /^Account (pyke.mezo|0x7c21)/ }),
  ).toBeVisible()
  await expect(
    header(page).getByRole("button", { name: /^Viewing/ }),
  ).toHaveCount(0)
  const main = page.locator("main")
  await expect(main.getByRole("button", { name: "Claim all" })).toBeEnabled()
  await expect(main.getByRole("button", { name: "Viewing only" })).toHaveCount(
    0,
  )
  expect(errors).toEqual([])
})

test("someone else's wallet offers Connect wallet when yours does not reconnect", async ({
  page,
  baseURL,
}) => {
  // A locked extension: this browser connected 0x2b0c before, but the
  // wallet shares no account now.
  await installFakeWallet(page, { address: twoLocks, locked: true })
  await rememberConnected(page, baseURL, twoLocks)
  await page.goto(`/${demo}`)
  const top = header(page)
  await expect(
    top.getByRole("button", { name: /^Viewing (pyke.mezo|0x7c21)/ }),
  ).toBeVisible()
  await expect(
    page.locator("main").getByRole("button", { name: "Viewing only" }),
  ).toBeVisible()
  // Your account shows from the cookie until the reconnect settles, then
  // Connect wallet takes its place.
  await expect(connectButton(page)).toBeVisible(reconnect)
  await expect(top.getByRole("button", { name: /^Account/ })).toHaveCount(0)
  await openDialog(page, () => connectButton(page).click(), "Connect wallet")
})

test("disconnecting on someone else's wallet leaves Connect wallet", async ({
  page,
  baseURL,
}) => {
  await installFakeWallet(page, { address: twoLocks, authorized: true })
  await rememberConnected(page, baseURL, twoLocks)
  await page.goto(`/${demo}`)
  const top = header(page)
  const account = top.getByRole("button", { name: /^Account 0x2b0c/ })
  const panel = page.getByRole("dialog").filter({
    has: page.getByRole("button", { name: "Disconnect" }),
  })
  // The panel offers Disconnect once the wallet has reconnected.
  await expect(async () => {
    await account.click()
    await expect(panel).toBeVisible({ timeout: 2_000 })
  }).toPass(reconnect)
  await panel.getByRole("button", { name: "Disconnect" }).click()
  await expect(connectButton(page)).toBeVisible()
  await expect(top.getByRole("button", { name: /^Account/ })).toHaveCount(0)
  await expect(
    top.getByRole("button", { name: /^Viewing (pyke.mezo|0x7c21)/ }),
  ).toBeVisible()
})

test("a reconnect as another wallet on a plain path follows it", async ({
  page,
  baseURL,
}) => {
  // The cookie says 0x7c21, so /rewards renders its rewards; the wallet
  // comes back as 0x2b0c.
  await installFakeWallet(page, { address: twoLocks, authorized: true })
  await rememberConnected(page, baseURL, demo)
  await page.goto("/rewards")
  const top = header(page)
  await expect(
    top.getByRole("button", { name: /^Account 0x2b0c/ }),
  ).toBeVisible(reconnect)
  await expect(top.getByRole("button", { name: /^Viewing/ })).toHaveCount(0)
  await expect(
    page.locator("main").getByRole("button", { name: "Viewing only" }),
  ).toHaveCount(0)
  await expect(page).toHaveURL(/\/rewards$/)
})

test.describe("a wallet that does not answer its reconnect", () => {
  // Pro stops waiting after 8 s (`reconnectLimitMs`); no test hook
  // shortens it, so these wait the real time.
  const limit = { timeout: 25_000 }
  test.describe.configure({ timeout: 90_000 })

  test("someone else's wallet offers Connect wallet after the limit", async ({
    page,
    baseURL,
  }) => {
    await installFakeWallet(page, {
      address: twoLocks,
      authorized: true,
      answers: "never",
    })
    await rememberConnected(page, baseURL, twoLocks)
    await page.goto(`/${demo}`)
    const top = header(page)
    await expect(
      top.getByRole("button", { name: /^Viewing (pyke.mezo|0x7c21)/ }),
    ).toBeVisible()
    await expect(connectButton(page)).toBeVisible(limit)
    await expect(top.getByRole("button", { name: /^Account/ })).toHaveCount(0)
    await openDialog(page, () => connectButton(page).click(), "Connect wallet")
  })

  test("Claim all on your own page opens Connect wallet after the limit", async ({
    page,
    baseURL,
  }) => {
    await installFakeWallet(page, {
      address: demo,
      authorized: true,
      answers: "never",
    })
    await rememberConnected(page, baseURL, demo)
    await page.goto("/rewards")
    const claim = page
      .locator("main")
      .getByRole("button", { name: "Claim all" })
    await expect(claim).toBeEnabled()
    // A click before hydration does nothing: click until the drawer opens.
    const drawer = page.getByRole("dialog", { name: "Connect wallet" })
    // The drawer covers the button once it opens: click only until then.
    await expect(async () => {
      if (!(await drawer.isVisible())) await claim.click({ timeout: 2_000 })
      await expect(drawer).toBeVisible({ timeout: 4_000 })
    }).toPass(limit)
  })

  test("a wallet that answers after the limit still connects", async ({
    page,
    baseURL,
  }) => {
    await installFakeWallet(page, {
      address: twoLocks,
      authorized: true,
      answers: 14_000,
    })
    await rememberConnected(page, baseURL, twoLocks)
    await page.goto(`/${demo}`)
    const top = header(page)
    // Past the limit the header offers Connect wallet...
    await expect(connectButton(page)).toBeVisible(limit)
    // ...and the late answer connects your wallet beside the one viewed.
    await expect
      .poll(() => connectedAccount(page), limit)
      .toBe(twoLocks.toLowerCase())
    await expect(
      top.getByRole("button", { name: /^Account 0x2b0c/ }),
    ).toBeVisible()
    await expect(connectButton(page)).toHaveCount(0)
  })
})

test.describe("the Safe saved in Signing", () => {
  test("is yours before its owner's wallet connects", async ({ page }) => {
    await saveSafe(page, demo)
    await page.goto(`/${demo}`)
    const main = page.locator("main")
    const claim = main.getByRole("button", { name: "Claim all" })
    await expect(claim).toBeEnabled()
    await expect(
      main.getByRole("button", { name: "Viewing only" }),
    ).toHaveCount(0)
    // Without a wallet, Claim all asks for one.
    await openDialog(page, () => claim.click(), "Connect wallet")
  })

  test("offers Connect wallet in a browser that never connected one", async ({
    page,
  }) => {
    // No wallet to reconnect, so wallet code never loads on its own: the
    // header kept the Safe's account, not connected, with no way to connect.
    await saveSafe(page, demo)
    await page.goto(`/${demo}`)
    await expect(connectButton(page)).toBeVisible()
    await expect(
      header(page).getByRole("button", { name: /^Account/ }),
    ).toHaveCount(0)
    await openDialog(page, () => connectButton(page).click(), "Connect wallet")
  })

  test("keeps its page and the claim when its owner connects from the drawer", async ({
    page,
  }) => {
    await installFakeWallet(page, { address: twoLocks })
    await saveSafe(page, demo)
    await page.goto(`/${demo}`)
    const claim = page
      .locator("main")
      .getByRole("button", { name: "Claim all" })
    await openDialog(page, () => claim.click(), "Connect wallet")
    const path = new URL(page.url()).pathname
    const drawer = page.getByRole("dialog", { name: "Connect wallet" })
    await drawer.getByRole("button", { name: /Test Wallet/ }).click()
    await expect(drawer).toBeHidden()
    // The owner stays on the Safe, and the claim they asked for opens.
    await expect(page.getByRole("dialog", { name: /claim/i })).toBeVisible()
    await expect.poll(() => connectedAccount(page)).toBe(twoLocks.toLowerCase())
    expect(new URL(page.url()).pathname).toBe(path)
  })

  test("is yours with its owner connected", async ({ page, baseURL }) => {
    await installFakeWallet(page, { address: twoLocks, authorized: true })
    await rememberConnected(page, baseURL, twoLocks)
    await saveSafe(page, demo)
    await page.goto(`/${demo}`)
    const main = page.locator("main")
    await expect(main.getByRole("button", { name: "Claim all" })).toBeEnabled()
    await expect(
      main.getByRole("button", { name: "Viewing only" }),
    ).toHaveCount(0)
    // The owner's wallet reconnects, and the Safe stays on screen with
    // its actions.
    await expect
      .poll(() => connectedAccount(page), reconnect)
      .toBe(twoLocks.toLowerCase())
    await expect(main.getByRole("button", { name: "Claim all" })).toBeEnabled()
    await expect(
      header(page).getByRole("button", { name: /^Viewing/ }),
    ).toHaveCount(0)
    const account = header(page).getByRole("button", {
      name: /^Account (pyke.mezo|0x7c21)/,
    })
    await expect(account).toBeVisible()
    // The Safe's own account panel has nothing to stop viewing.
    const name = /pyke\.mezo|0x7c21/i
    await openDialog(page, () => account.click(), name)
    const panel = page.getByRole("dialog", { name })
    await expect(panel.getByRole("heading", { name: "Settings" })).toBeVisible()
    await expect(panel.getByText("Stop viewing")).toHaveCount(0)
  })
})
