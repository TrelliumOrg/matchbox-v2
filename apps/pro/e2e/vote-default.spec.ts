import { expect, type Page, test } from "@playwright/test"

/**
 * The type /vote opens on (P3, 19 Nov 2026): a signed-out visitor landed
 * on veBTC gauges with "Funded 0" while only pool gauges were funded. The
 * fixtures serve that epoch when asked with the header below.
 */

const poolsOnly = { "x-pro-fixture-directory": "pools-only" }
/** Two veMEZO locks and nothing else. */
const veMezoOnly = `/0x2b0c${"0".repeat(32)}0002`

function shownType(page: Page, label: string) {
  return page.getByRole("region", { name: label })
}

test("opens on the type with funded gauges, decided on the server", async ({
  page,
}) => {
  const html = await (
    await page.request.get("/vote", { headers: poolsOnly })
  ).text()
  expect(html).toContain('aria-label="Pool gauges"')
  await page.setExtraHTTPHeaders(poolsOnly)
  await page.goto("/vote")
  await expect(shownType(page, "Pool gauges")).toBeVisible()
  await expect(page).toHaveURL(/\/vote$/)
  await expect(page.getByText(/^No Pool gauges funded/)).toHaveCount(0)
  // The type on screen is marked, and on a phone its card is scrolled to.
  const current = page
    .getByRole("navigation", { name: "Gauge types" })
    .locator("[data-current]")
    .filter({ visible: true })
  await expect(current).toHaveCount(1)
  await expect(current).toContainText("Pool gauges")
  // Said to assistive tech too, though /vote is not the type's own path.
  await expect(current).toHaveAttribute("aria-current", "page")
  await expect(current).toBeInViewport({ ratio: 0.9 })
})

test("keeps veBTC gauges while they are funded", async ({ page }) => {
  await page.goto("/vote")
  await expect(shownType(page, "veBTC gauges")).toBeVisible()
  await expect(page.getByText(/^No veBTC gauges funded/)).toHaveCount(0)
})

test("an explicit type wins, and says when it has nothing funded", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders(poolsOnly)
  await page.goto("/vote/vebtc")
  await expect(shownType(page, "veBTC gauges")).toBeVisible()
  await expect(page.getByText(/^No veBTC gauges funded in Epoch/)).toBeVisible()
  await page.getByRole("link", { name: "See Pool gauges" }).click()
  await expect(page).toHaveURL(/\/vote\/pools/)
  await expect(shownType(page, "Pool gauges")).toBeVisible()
})

test("a wallet with veMEZO locks only opens on what they vote", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders(poolsOnly)
  await page.goto(`${veMezoOnly}/vote`)
  await expect(shownType(page, "veBTC gauges")).toBeVisible()
  // Pool gauges are funded, but its locks cannot vote them: it says so.
  await expect(
    page.getByText(
      /^No veBTC gauges funded in Epoch \d+\. Pool gauges are, and voting them needs a veBTC lock\.$/,
    ),
  ).toBeVisible()
})
