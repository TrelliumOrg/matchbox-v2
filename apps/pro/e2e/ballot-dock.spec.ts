import { expect, type Locator, type Page, test } from "@playwright/test"

/**
 * The phone's ballot bar over the tab bar, with an Android-sized bottom
 * inset. Chrome on Android reports the gesture or button bar as
 * `env(safe-area-inset-bottom)` (Pro sets `viewport-fit=cover`); the tab bar
 * grew by it and the ballot bar did not, so the tab bar covered the lower
 * half of Review and sign (14 Nov 2026). Chromium's safe-area override
 * stands in for the phone. The fixtures' two-lock wallet has two veMEZO
 * locks that have not voted, so the bar reads Review and sign.
 */

const user = `/0x2b0c${"0".repeat(32)}0002`
/** Android's three-button bar, in CSS pixels. */
const inset = 48

type Box = { x: number; y: number; width: number; height: number }

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox()
  if (found === null) throw new Error("not laid out")
  return found
}

function bottom(rect: Box): number {
  return rect.y + rect.height
}

async function withInset(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 0, left: 0, right: 0, bottom: inset, bottomMax: inset },
  })
}

/**
 * The bar sits wholly above the tab bar and inside the viewport, and
 * Review and sign is whole and takes a tap at its centre.
 */
async function expectClear(page: Page): Promise<Box> {
  const tabs = page
    .getByRole("navigation", { name: "Pro" })
    .filter({ visible: true })
  const bar = page.locator("[data-ballot-bar]")
  const review = bar
    .getByRole("button", { name: /^Review and sign/ })
    .filter({ visible: true })
  await expect(review).toBeVisible()
  const viewport = page.viewportSize()
  if (viewport === null) throw new Error("no viewport")
  const tabBox = await box(tabs)
  const barBox = await box(bar)
  const reviewBox = await box(review)
  // The inset reached the page: 64px of tabs, a 1px rule and the inset.
  expect(Math.round(tabBox.height)).toBe(65 + inset)
  expect(bottom(barBox)).toBeLessThanOrEqual(tabBox.y)
  expect(reviewBox.y).toBeGreaterThanOrEqual(barBox.y)
  expect(bottom(reviewBox)).toBeLessThanOrEqual(tabBox.y)
  expect(bottom(reviewBox)).toBeLessThanOrEqual(viewport.height)
  expect(reviewBox.x).toBeGreaterThanOrEqual(barBox.x)
  expect(reviewBox.x + reviewBox.width).toBeLessThanOrEqual(
    barBox.x + barBox.width,
  )
  const hit = await review.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const top = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    )
    return top !== null && element.contains(top)
  })
  expect(hit).toBe(true)
  // Projected and its value show whole beside the button, not cut short.
  const cut = await bar
    .getByText("Projected", { exact: true })
    .evaluate((label) =>
      [label, label.nextElementSibling].some(
        (line) => line === null || line.scrollWidth > line.clientWidth,
      ),
    )
  expect(cut).toBe(false)
  return barBox
}

/**
 * Two locks, then one, from the first gauge picked: the bar clears the tab
 * bar each time, and the end of the list scrolls clear of both. Clicks
 * retry until the section has hydrated and takes them, instead of waiting
 * for the network to go quiet.
 */
async function checkVote(page: Page): Promise<void> {
  await withInset(page)
  await page.goto(`${user}/vote/vebtc`)
  const bar = page.locator("[data-ballot-bar]")
  const locks = page.locator("[data-vote-with-row]").getByRole("checkbox")
  await expect(locks).toHaveCount(2)
  await expect(locks.nth(0)).toBeChecked()
  await expect(locks.nth(1)).toBeChecked()
  const pick = page
    .locator("[data-gauge-list] > li")
    .first()
    .getByRole("button", { name: / to ballot$/ })
  await expect(async () => {
    if ((await pick.getAttribute("aria-pressed")) !== "true") {
      await pick.click()
    }
    await expect(bar.getByText("1 picked")).toBeVisible({ timeout: 1_000 })
  }).toPass()

  // A phone reads "2 locks", without the epoch beside it.
  await expect(bar.getByText("2 locks", { exact: true })).toBeVisible()
  await expectClear(page)
  await expect(async () => {
    if (await locks.nth(1).isChecked()) await locks.nth(1).uncheck()
    await expect(bar.getByText(/^Epoch \d+$/)).toBeVisible({ timeout: 1_000 })
  }).toPass()
  const barBox = await expectClear(page)

  // At the foot of the page the last gauge and the pager under it scroll
  // clear of the bar, and so of the tab bar under it.
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  )
  const last = page.locator("[data-gauge-list] > li").last()
  await expect(last).toBeVisible()
  expect(bottom(await box(last))).toBeLessThanOrEqual(barBox.y)
  const pager = page.getByRole("navigation", { name: "Pages, end of list" })
  await expect(pager).toBeVisible()
  expect(bottom(await box(pager))).toBeLessThanOrEqual(barBox.y)
}

test("the ballot bar clears the tab bar, and the list clears both", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "the tab bar is a phone's")
  await checkVote(page)
})

test.describe("a 360 by 740 phone", () => {
  test.skip(({ isMobile }) => !isMobile, "a phone width")
  test.use({ viewport: { width: 360, height: 740 } })

  test("the compact bar keeps Review and sign whole", async ({ page }) => {
    await checkVote(page)
  })
})
