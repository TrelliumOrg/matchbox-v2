import { expect, type Locator, type Page, test } from "@playwright/test"

/**
 * The Classic note (Doop page "Pro, Classic banner"): offered to visitors
 * who arrive from the homepage (`?from=home`), on every page of that visit,
 * until it is dismissed.
 */

const classic = "https://app.matchbox.markets"
const user = "/0x7c21095156ab25e989c3c084bcb06037c6539e0b"

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

/** The note on screen: the sidebar's card, or the floating one. */
function note(page: Page): Locator {
  return page.locator("[data-classic-note]:visible")
}

async function arrive(page: Page, path = "/"): Promise<void> {
  await page.goto(`${path}?from=home`)
  await expect(note(page)).toBeVisible()
}

test("shows only on arrival from the homepage, with a clean address", async ({
  page,
  isMobile,
}) => {
  const errors = watchErrors(page)
  await page.goto("/")
  await page.waitForLoadState("networkidle")
  // Longer than the note's entrance wait.
  await page.waitForTimeout(1500)
  await expect(page.locator("[data-classic-note]")).toHaveCount(0)

  await page.goto("/vote?from=home")
  // Taken out before anything paints, the rest of the address kept.
  expect(new URL(page.url()).search).toBe("")
  expect(new URL(page.url()).pathname).toBe("/vote")
  await expect(note(page)).toHaveCount(1)
  await expect(note(page)).toHaveAttribute(
    "data-classic-note",
    isMobile ? "floating" : "sidebar",
  )
  const link = note(page).getByRole("link")
  // One wording on every width (owner, 12 Nov).
  await expect(link).toHaveText("Go to Matchbox Classic")
  await expect(link).toHaveAttribute("href", classic)
  await expect(link).not.toHaveAttribute("target", /.*/)
  await expect(note(page).locator("p")).toHaveText(
    "Looking for the old Matchbox?",
  )
  expect(errors).toEqual([])
})

test("stays for the visit: other pages and a reload", async ({ page }) => {
  await arrive(page)
  await page.getByRole("link", { name: "Vote" }).first().click()
  await expect(page).toHaveURL(/\/vote$/)
  await expect(note(page)).toBeVisible()
  await page.reload()
  await expect(note(page)).toBeVisible()
  expect(new URL(page.url()).search).toBe("")
})

test("dismissal is for good on this device", async ({ page, isMobile }) => {
  await arrive(page)
  await page.getByRole("button", { name: "Dismiss banner" }).click()
  await expect(page.locator("[data-classic-note]")).toHaveCount(0)
  if (!isMobile) {
    // The note folded into the row it stood in for; the keyboard is on it.
    const row = page.locator("aside").getByRole("link", {
      name: "Matchbox Classic",
      exact: true,
    })
    await expect(row).toBeVisible()
    await expect(row).toBeFocused()
    await expect(row).toHaveAttribute("href", classic)
  }
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("mbx.classicNote.dismissed"),
    ),
  ).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  await page.reload()
  await page.waitForTimeout(1500)
  await expect(page.locator("[data-classic-note]")).toHaveCount(0)
  // A later arrival from the homepage, in a new tab of the same browser.
  const later = await page.context().newPage()
  await later.goto("/?from=home")
  expect(new URL(later.url()).search).toBe("")
  await later.waitForLoadState("networkidle")
  await later.waitForTimeout(1500)
  await expect(later.locator("[data-classic-note]")).toHaveCount(0)
})

test("never shows where a wallet connected before", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("mbx.classicNote.used", "1")
  })
  await page.goto("/?from=home")
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1500)
  await expect(page.locator("[data-classic-note]")).toHaveCount(0)
})

test("is out of sight while a sheet is open", async ({ page }) => {
  await arrive(page)
  await page
    .getByRole("button", { name: /^Connect/ })
    .first()
    .click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(note(page)).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(note(page)).toBeVisible()
})

test("under reduced motion it still arrives and leaves", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await arrive(page)
  await page.getByRole("button", { name: "Dismiss banner" }).click()
  await expect(page.locator("[data-classic-note]")).toHaveCount(0)
})

test.describe("rail widths", () => {
  test.skip(({ isMobile }) => isMobile, "a desktop width")
  test.use({ viewport: { width: 834, height: 1194 } })

  test("one line, lined up with the Ctrl K bar and 12px above it", async ({
    page,
  }) => {
    await arrive(page)
    await expect(note(page)).toHaveAttribute("data-classic-note", "floating")
    await expect(note(page).getByRole("link")).toHaveText(
      "Go to Matchbox Classic",
    )
    // The note slides into place: wait for the gap it settles at instead
    // of measuring once, which read 11px mid-slide on a loaded machine
    // (13 Nov 2026).
    await expect
      .poll(async () => {
        const moving = await note(page).boundingBox()
        const under = await page.getByRole("search").boundingBox()
        return moving === null || under === null
          ? null
          : Math.round(under.y - (moving.y + moving.height))
      })
      .toBe(12)
    const card = await note(page).boundingBox()
    const bar = await page.getByRole("search").boundingBox()
    if (card === null || bar === null) throw new Error("not laid out")
    expect(card.height).toBe(52)
    expect(card.width).toBe(bar.width)
    expect(Math.abs(card.x - bar.x)).toBeLessThanOrEqual(1)
    // The rail keeps its Classic icon.
    await expect(
      page.locator("aside").getByRole("link", {
        name: "Matchbox Classic",
        exact: true,
      }),
    ).toBeVisible()
  })
})

test("the Account panel always has the way back", async ({ page }) => {
  await page.goto(user)
  await page.getByRole("button", { name: /^Account/ }).click()
  const panel = page.getByRole("dialog")
  await expect(panel).toBeVisible()
  const row = panel.getByRole("link", { name: "Matchbox Classic" })
  await expect(row).toBeVisible()
  await expect(row).toHaveAttribute("href", classic)
  await expect(row).not.toHaveAttribute("target", /.*/)
})

test("the Connect wallet sheet has the way back for someone signed out", async ({
  page,
}) => {
  await page.goto("/")
  await page
    .getByRole("button", { name: /^Connect/ })
    .first()
    .click()
  const sheet = page.getByRole("dialog")
  await expect(sheet).toBeVisible()
  const row = sheet.getByRole("link", { name: "Matchbox Classic" })
  await expect(row).toBeVisible()
  await expect(row).toHaveAttribute("href", classic)
  await expect(row).not.toHaveAttribute("target", /.*/)
})

test.describe("a 360 wide phone", () => {
  test.skip(({ isMobile }) => !isMobile, "a phone width")
  test.use({ viewport: { width: 360, height: 740 } })

  test("fits the full wording beside a 44px close button", async ({ page }) => {
    await arrive(page)
    const card = await note(page).boundingBox()
    const link = await note(page).getByRole("link").boundingBox()
    const close = await page
      .getByRole("button", { name: "Dismiss banner" })
      .boundingBox()
    if (card === null || link === null || close === null) {
      throw new Error("not laid out")
    }
    expect(close.width).toBe(44)
    expect(close.height).toBe(44)
    expect(link.height).toBeGreaterThanOrEqual(44)
    // Inside the card and clear of the close button, with no page scroll.
    expect(card.x).toBeGreaterThanOrEqual(0)
    expect(card.x + card.width).toBeLessThanOrEqual(360)
    expect(link.x + link.width).toBeLessThanOrEqual(close.x)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  })
})
