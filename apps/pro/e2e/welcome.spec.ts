import { expect, type Page, test } from "@playwright/test"

/**
 * The welcome dialog (Doop `mbpWkkU-8d`, `jBvVnutsJi`, `51CXh8BRUY`).
 * Playwright's browser is automated, so the dialog stays off by itself
 * (welcome-store); `?welcome=show` is how a test asks for it.
 */

const seenKey = "mbx.welcome.seen"

function dialog(page: Page) {
  return page.locator("[data-welcome]")
}

test("stays off in an automated browser", async ({ page }) => {
  await page.goto("/")
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(2500)
  await expect(dialog(page)).toHaveCount(0)
})

test("shows on ?welcome=show, walks three steps and is remembered", async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/?welcome=show")
  await expect(dialog(page)).toBeVisible()
  expect(new URL(page.url()).search).toBe("")
  await expect(
    page.getByRole("dialog", { name: "Meet the new Matchbox Pro" }),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Next" })).toBeFocused()
  await page.waitForTimeout(400)
  await page.screenshot({ path: testInfo.outputPath("step-1.png") })

  await page.getByRole("button", { name: "Next" }).click()
  await expect(
    page.getByRole("dialog", { name: "Explore Mezo with Matchscan" }),
  ).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("step-2.png") })

  await page.getByRole("button", { name: "Next" }).click()
  await expect(page.getByText("Build with Matchbox")).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("step-3.png") })

  await page.getByRole("button", { name: "Get started" }).click()
  await expect(dialog(page)).toHaveCount(0)
  expect(
    await page.evaluate((key) => window.localStorage.getItem(key), seenKey),
  ).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(errors).toEqual([])
})

test("closes on Escape and offers the way to Classic", async ({ page }) => {
  await page.goto("/vote?welcome=show")
  await expect(dialog(page)).toBeVisible()
  await expect(
    dialog(page).getByRole("link", { name: /^Go to (Matchbox )?Classic$/ }),
  ).toHaveAttribute("href", "https://app.matchbox.markets")
  await page.keyboard.press("Escape")
  await expect(dialog(page)).toHaveCount(0)
  expect(
    await page.evaluate((key) => window.localStorage.getItem(key), seenKey),
  ).not.toBeNull()
})

test("fits the window without scrolling the page sideways", async ({
  page,
}) => {
  await page.goto("/?welcome=show")
  await expect(dialog(page)).toBeVisible()
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
  await expect(page.getByRole("button", { name: "Next" })).toBeInViewport()
  // The close X is on top of the picture, where a pointer can reach it.
  await page.getByRole("button", { name: "Close" }).click({ timeout: 3000 })
  await expect(dialog(page)).toHaveCount(0)
})
