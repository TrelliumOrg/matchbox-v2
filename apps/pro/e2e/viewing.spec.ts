import { type BrowserContext, expect, type Page, test } from "@playwright/test"
import openDialog from "./dialog"

/**
 * Someone else's wallet reads as viewing, and offers nothing to sign. On
 * the live site (19 Nov 2026) a viewed wallet's address took the place of
 * Connect wallet in the header, and its page offered Claim all, Claim and
 * relock, Vote and a lock card's Claim, as if it were the visitor's own.
 * Your own wallet (the one this browser connected, remembered in a cookie)
 * keeps every action, from the first paint, before the wallet reconnects.
 */

const demo = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"
/** Two veMEZO locks that have not voted: Vote reads Review and sign. */
const twoLocks = `0x2b0c${"0".repeat(32)}0002`

/** Fails on any console error or uncaught exception. */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

/** As if this browser had connected `address`: the own-wallet cookie. */
async function remember(
  context: BrowserContext,
  baseURL: string | undefined,
  address: string,
): Promise<void> {
  await context.addCookies([
    { name: "mbx-wallet", value: address, url: baseURL ?? "" },
  ])
}

function header(page: Page) {
  return page.locator("header").first()
}

test.describe("someone else's wallet", () => {
  test("reads as viewing, with Connect wallet kept", async ({
    page,
    isMobile,
  }) => {
    const errors = watchErrors(page)
    await page.goto(`/${demo}`)
    await page.waitForLoadState("networkidle")
    const top = header(page)
    await expect(
      top.getByRole("button", { name: /^Connect/ }).filter({ visible: true }),
    ).toBeVisible()
    await expect(
      top.getByRole("button", { name: /^Viewing (pyke.mezo|0x7c21)/ }),
    ).toBeVisible()
    await expect(top.getByRole("button", { name: /^Account/ })).toHaveCount(0)
    if (!isMobile) {
      await expect(top.getByText("Viewing", { exact: true })).toBeVisible()
    }
    expect(errors).toEqual([])
  })

  test("offers no claim, lock or vote action", async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto(`/${demo}`)
    await page.waitForLoadState("networkidle")
    const main = page.locator("main")
    await expect(
      main.getByRole("button", { name: "Viewing only" }),
    ).toBeDisabled()
    // "Claimed rewards" opens a past claim, "Claimable breakdown" a list.
    for (const name of [/^Claim(?!ed|able)/, /^Withdraw/, /New lock/]) {
      await expect(main.getByRole("button", { name })).toHaveCount(0)
    }
    await expect(
      main
        .getByRole("region", { name: "Locks" })
        .getByRole("link", { name: "Vote" }),
    ).toHaveCount(0)
    // What it holds and earns still shows.
    await expect(main.getByText("Claimable").first()).toBeVisible()

    await page.goto(`/${demo}/rewards`)
    await page.waitForLoadState("networkidle")
    await expect(
      main.getByRole("button", { name: "Viewing only" }),
    ).toBeDisabled()
    await expect(
      main.getByRole("button", { name: /^Claim(?!ed|able)/ }),
    ).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test("Vote's ballot can be explored, never signed", async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto(`/${twoLocks}/vote`)
    await page.waitForLoadState("networkidle")
    const primary = page
      .getByRole("button", { name: "Viewing only" })
      .filter({ visible: true })
      .first()
    await expect(primary).toBeDisabled()
    await expect(
      page.getByRole("button", { name: /^Review and sign/ }),
    ).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test("fits a 360 wide phone, header included", async ({ page, isMobile }) => {
    test.skip(!isMobile, "a phone width")
    await page.setViewportSize({ width: 360, height: 740 })
    for (const path of ["", "/vote", "/rewards", "/activity"]) {
      await page.goto(`/${demo}${path}`)
      await page.waitForLoadState("networkidle")
      // Viewing and Connect both fit: the chip once pushed the page 85px
      // wider than the screen.
      const [inner, scroll] = await page.evaluate(() => [
        window.innerWidth,
        document.documentElement.scrollWidth,
      ])
      expect(inner, path).toBe(360)
      expect(scroll, path).toBeLessThanOrEqual(inner)
    }
  })

  test("Stop viewing goes back to no wallet", async ({ page, isMobile }) => {
    test.skip(isMobile, "phones stop viewing from the account panel")
    await page.goto(`/${demo}/rewards`)
    await page.waitForLoadState("networkidle")
    await header(page)
      .getByRole("link", { name: /^Stop viewing/ })
      .click()
    await expect(page).toHaveURL(/\/rewards$/)
    await expect(
      header(page).getByRole("button", { name: /^Viewing/ }),
    ).toHaveCount(0)
  })

  test("a phone stops viewing from the account panel", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "the header has its own button on desktop")
    await page.goto(`/${demo}`)
    await page.waitForLoadState("networkidle")
    await openDialog(page, () =>
      header(page)
        .getByRole("button", { name: /^Viewing/ })
        .click(),
    )
    await page
      .getByRole("dialog")
      .getByRole("link", { name: /^Stop viewing/ })
      .click()
    await expect(
      header(page).getByRole("button", { name: /^Viewing/ }),
    ).toHaveCount(0)
  })
})

test.describe("your own wallet", () => {
  test("keeps its account and every action from the first paint", async ({
    page,
    context,
    baseURL,
  }) => {
    await remember(context, baseURL, demo)
    const errors = watchErrors(page)
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    const top = header(page)
    await expect(
      top.getByRole("button", { name: /^Account (pyke.mezo|0x7c21)/ }),
    ).toBeVisible()
    await expect(top.getByRole("button", { name: /^Viewing/ })).toHaveCount(0)
    const main = page.locator("main")
    await expect(main.getByRole("button", { name: "Claim all" })).toBeEnabled()
    await expect(
      main.getByRole("button", { name: "Viewing only" }),
    ).toHaveCount(0)
    await expect(
      main.getByRole("button", { name: /^Claim \$/ }).first(),
    ).toBeVisible()
    expect(errors).toEqual([])
  })

  test("signs its own ballot", async ({ page, context, baseURL }) => {
    await remember(context, baseURL, twoLocks)
    const errors = watchErrors(page)
    await page.goto("/vote")
    await page.waitForLoadState("networkidle")
    await expect(
      page
        .getByRole("button", { name: /^Review and sign/ })
        .filter({ visible: true })
        .first(),
    ).toBeVisible()
    expect(errors).toEqual([])
  })

  test("still views someone else's wallet as viewing", async ({
    page,
    context,
    baseURL,
  }) => {
    await remember(context, baseURL, twoLocks)
    await page.goto(`/${demo}`)
    await page.waitForLoadState("networkidle")
    const top = header(page)
    // Your account stays in its place, theirs reads as viewing.
    await expect(
      top.getByRole("button", { name: /^Account 0x2b0c/ }),
    ).toBeVisible()
    await expect(
      top.getByRole("button", { name: /^Viewing (pyke.mezo|0x7c21)/ }),
    ).toBeVisible()
    await expect(
      page.locator("main").getByRole("button", { name: "Viewing only" }),
    ).toBeDisabled()
  })
})
