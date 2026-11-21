import { expect, type Page, test } from "@playwright/test"

/**
 * Stuart's Ctrl K bar floats at the foot of the content column from
 * 768px. On first view it covered Protocol's chart labels, a gauge's
 * About icons and a wallet's Activity amounts (P10, 19 Nov 2026). The
 * foot of the column is now kept clear, so content stops above the bar.
 */

test.skip(({ isMobile }) => isMobile, "phones hide the bar")

type Box = { x: number; y: number; width: number; height: number }

async function box(page: Page, selector: string): Promise<Box> {
  const found = await page.locator(selector).boundingBox()
  if (found === null) throw new Error(`${selector} not laid out`)
  return found
}

/** What is painted at a point: content in <main>, or not. */
async function contentAt(page: Page, x: number, y: number): Promise<boolean> {
  return page.evaluate(
    ([px, py]) => {
      const top = document.elementFromPoint(px ?? 0, py ?? 0)
      return top?.closest("main") !== null && top?.closest("main") !== undefined
    },
    [x, y],
  )
}

for (const path of [
  "/protocol",
  "/gauges/0x4da4c05483324ea9cfc951510a5e77cc79541159",
  "/0x7c21095156ab25e989c3c084bcb06037c6539e0b",
]) {
  test(`no content sits under the bar on first view of ${path}`, async ({
    page,
  }) => {
    await page.goto(path)
    const bar = page.getByRole("search", { name: "Stuart" })
    await expect(bar).toBeVisible()
    await expect(page.locator("main h1").first()).toBeVisible()
    const barBox = await box(page, "search[aria-label='Stuart']")
    const main = await box(page, "main")
    // Across the column, level with the bar and just above it, nothing of
    // the page is painted: only the bar and the clear strip behind it.
    for (const y of [barBox.y + barBox.height / 2, barBox.y - 8]) {
      for (const x of [main.x + 12, barBox.x + 40, main.x + main.width - 12]) {
        expect(await contentAt(page, x, y)).toBe(false)
      }
    }
    // The strip is under the bar: a click on the bar still reaches it.
    const input = bar.getByRole("combobox")
    await input.click()
    await expect(input).toBeFocused()
  })
}

test("the end of a page still clears the bar", async ({ page }) => {
  await page.goto("/protocol")
  await expect(page.locator("main h1").first()).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const barBox = await box(page, "search[aria-label='Stuart']")
  const last = await page.evaluate(() => {
    const items = [...document.querySelectorAll("main *")].filter(
      (element) =>
        element.getClientRects().length > 0 &&
        (element.textContent ?? "").trim() !== "",
    )
    return Math.max(
      ...items.map((element) => element.getBoundingClientRect().bottom),
    )
  })
  expect(last).toBeLessThanOrEqual(barBox.y)
})
