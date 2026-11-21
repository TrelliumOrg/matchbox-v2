import { expect, type Page, test } from "@playwright/test"
import openDialog from "./dialog"

/**
 * The phone tab bar's More (P2, 19 Nov 2026): a phone had no way to
 * Protocol, the Boost calculator, the docs or Classic, which the desktop
 * sidebar holds. Phones only: from 768px the sidebar has them.
 */

test.skip(({ isMobile }) => !isMobile, "the tab bar is a phone's")

function tabs(page: Page) {
  return page.getByRole("navigation", { name: "Pro" }).filter({ visible: true })
}

async function openMore(page: Page) {
  await openDialog(
    page,
    () => tabs(page).getByRole("button", { name: "More" }).click(),
    "More",
  )
  return page.getByRole("dialog", { name: "More" })
}

test("More holds Protocol, the calculator, the docs and Classic", async ({
  page,
}) => {
  await page.goto("/")
  const bar = tabs(page)
  await expect(bar.getByRole("listitem")).toHaveCount(5)
  // The same height as with four tabs: 64px of tabs and a 1px rule.
  const box = await bar.boundingBox()
  expect(Math.round(box?.height ?? 0)).toBe(65)
  const sheet = await openMore(page)
  await expect(sheet.getByRole("link", { name: "Protocol" })).toHaveAttribute(
    "href",
    "/protocol",
  )
  // The docs open in a new tab, as every link out of Pro does. Classic
  // stays in this tab: it is the switch to the other app.
  const docs = sheet.getByRole("link", { name: "Documentation" })
  await expect(docs).toHaveAttribute(
    "href",
    "https://docs.matchbox.markets/pro",
  )
  await expect(docs).toHaveAttribute("target", "_blank")
  await expect(docs).toHaveAttribute("rel", "noreferrer noopener")
  const classic = sheet.getByRole("link", { name: "Go to Matchbox Classic" })
  await expect(classic).toHaveAttribute("href", "https://app.matchbox.markets")
  await expect(classic).not.toHaveAttribute("target", "_blank")
  await expect(
    sheet.getByRole("link", { name: "Boost calculator" }),
  ).toBeVisible()
})

test("Protocol from More marks More as where you are", async ({ page }) => {
  await page.goto("/vote")
  const sheet = await openMore(page)
  await sheet.getByRole("link", { name: "Protocol" }).click()
  await expect(page).toHaveURL(/\/protocol$/)
  await expect(sheet).toBeHidden()
  await expect(
    page.getByRole("heading", { level: 1, name: "Protocol" }),
  ).toBeVisible()
  const more = tabs(page).getByRole("button", { name: "More" })
  await expect(more).toHaveClass(/text-ink/)
  // Not by colour alone: More is the current tab, as a page tab would be.
  await expect(more).toHaveAttribute("aria-current", "page")
  await expect(tabs(page).locator('[aria-current="page"]')).toHaveCount(1)
})

test("the calculator opens over the page from More", async ({ page }) => {
  await page.goto("/vote")
  const sheet = await openMore(page)
  await sheet.getByRole("link", { name: "Boost calculator" }).click()
  await expect(page).toHaveURL(/[?&]calc=1/)
  await expect(page).toHaveURL(/\/vote\?/)
  await expect(page.getByRole("dialog", { name: "More" })).toBeHidden()
  await expect(
    page.getByRole("dialog", { name: /Boost calculator/ }),
  ).toBeVisible()
})

test("closing More gives focus back to the More tab", async ({ page }) => {
  await page.goto("/vote")
  const sheet = await openMore(page)
  await page.keyboard.press("Escape")
  await expect(sheet).toBeHidden()
  // More opens the sheet without being its Radix trigger, so nothing
  // took focus back and it fell to the page's body.
  await expect(tabs(page).getByRole("button", { name: "More" })).toBeFocused()
})

test("Back closes the More sheet with the page it was opened on", async ({
  page,
}) => {
  await page.goto("/")
  await tabs(page).getByRole("link", { name: "Vote" }).click()
  await expect(page).toHaveURL(/\/vote/)
  const sheet = await openMore(page)
  await page.goBack()
  await expect(page).toHaveURL(/\/$/)
  await expect(sheet).toBeHidden()
  // And Forward does not bring it back.
  await page.goForward()
  await expect(page).toHaveURL(/\/vote/)
  await expect(tabs(page).getByRole("link", { name: "Vote" })).toHaveAttribute(
    "aria-current",
    "page",
  )
  await expect(sheet).toBeHidden()
})
