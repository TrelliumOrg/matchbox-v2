import { expect, test } from "@playwright/test"

/**
 * Phones: the menu and On this page are native popovers, so a reader with
 * scripting off can still move around; search, which needs script, is
 * hidden then. Reflowed tables keep each value's column label.
 */

test.describe("with scripting off", () => {
  test.skip(({ isMobile }) => !isMobile, "phone layout")
  test.use({ javaScriptEnabled: false })

  test("the menu opens and its links work", async ({ page }) => {
    await page.goto("/concepts/epochs")
    await expect(
      page.getByRole("button", { name: "Ask Stuart or search docs" }),
    ).toBeHidden()
    await page.getByRole("button", { name: "Menu" }).tap()
    const menu = page.getByRole("dialog", { name: "Navigation" })
    await expect(menu).toBeVisible()
    await menu.getByRole("link", { name: "Pro" }).first().tap()
    await expect(page).toHaveURL(/\/pro/)
  })

  test("On this page opens and jumps to a section", async ({ page }) => {
    await page.goto("/concepts/epochs")
    await page.getByRole("button", { name: /On this page/ }).tap()
    const sheet = page.getByRole("dialog", { name: "On this page" })
    await expect(sheet).toBeVisible()
    const second = sheet.getByRole("link").nth(1)
    const target = await second.getAttribute("href")
    await second.tap()
    await expect(page).toHaveURL(new RegExp(`${target}$`))
  })
})

test.describe("at 360 wide", () => {
  test.skip(({ isMobile }) => !isMobile, "phone layout")
  test.use({ viewport: { width: 360, height: 780 } })

  test("no page scrolls sideways", async ({ page }) => {
    for (const path of [
      "/",
      "/concepts/epochs",
      "/developer/api/incentives/list-incentives",
      "/pro/vote",
      "/developer/reference",
      "/developer/mcp/tools/rank-gauges",
      "/developer/errors",
      "/no/such/page",
    ]) {
      await page.goto(path, { waitUntil: "networkidle" })
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
      expect(overflow, path).toBeLessThanOrEqual(0)
    }
  })
})

test("a reflowed table labels each value", async ({ page, isMobile }) => {
  test.skip(!isMobile, "tables reflow on phones")
  await page.goto("/pro/vote")
  const table = page.locator("main table").first()
  const headings = await table
    .locator("thead th")
    .evaluateAll((cells) => cells.map((cell) => cell.textContent?.trim()))
  const firstRow = table.locator("tbody tr").first()
  const labels = await firstRow
    .locator("td > span[aria-hidden='true']")
    .evaluateAll((spans) =>
      spans
        .filter((span) => getComputedStyle(span).display !== "none")
        .map((span) => span.textContent),
    )
  expect(labels).toEqual(headings.slice(1))
})

test("no key caps on touch in search", async ({ page, isMobile }) => {
  test.skip(!isMobile, "touch")
  await page.goto("/concepts/epochs", { waitUntil: "networkidle" })
  await page.getByRole("button", { name: "Ask Stuart or search docs" }).tap()
  const close = page.getByRole("button", { name: "Close" })
  await expect(close).toBeVisible()
  await expect(close.locator("kbd").first()).toBeHidden()
})
