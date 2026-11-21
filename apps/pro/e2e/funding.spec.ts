import { expect, test } from "@playwright/test"

/**
 * Funded means a cent and more of priced incentives, or a registry token
 * without a USD value, and an APY needs a dollar of incentives and a
 * floor of votes (P6, 19 Nov 2026: "3,648.26% APY" on $0.28, and
 * "$0.00" gauges counted as funded). The fixtures carry mainnet's two
 * small pool gauges: MUSD/mSolvBTC CL200 with $0.28 (the API rates it
 * 3,648.26%) and mSolvBTC/MUSD Stable with $0.004 (13.00%).
 */

function card(page: import("@playwright/test").Page, name: RegExp) {
  return page
    .locator("[data-gauge-list] > li")
    .filter({ has: page.getByRole("link", { name }) })
}

test("a pool gauge on a few cents shows its dollars and no APY", async ({
  page,
}) => {
  await page.goto("/vote/pools")
  const tiny = card(page, /^MUSD\/mSolvBTC CL200$/)
  await expect(tiny).toBeVisible()
  await expect(tiny.getByText("$0.28")).toBeVisible()
  await expect(tiny.getByText("n/a", { exact: true })).toBeVisible()
  await expect(tiny.getByText(/3,648/)).toHaveCount(0)
  // Dust is not funding: no incentives, and no 13.00%.
  const dust = card(page, /^mSolvBTC\/MUSD Stable$/)
  await expect(dust.getByText("No incentives")).toBeVisible()
  await expect(dust.getByText("13.00")).toHaveCount(0)
})

test("Funded counts a cent and more", async ({ page }) => {
  await page.goto("/vote/pools?tab=funded")
  await expect(card(page, /^MUSD\/mSolvBTC CL200$/)).toBeVisible()
  await expect(card(page, /^mSolvBTC\/MUSD Stable$/)).toHaveCount(0)
  // Sorted by APY, the $0.28 gauge does not lead.
  await page.goto("/vote/pools?sort=apy")
  const first = page.locator("[data-gauge-list] > li").first()
  await expect(first).toBeVisible()
  await expect(first.getByRole("link", { name: /MUSD\/mSolvBTC/ })).toHaveCount(
    0,
  )
})

test("Protocol's funded list leaves out dust", async ({ page }) => {
  await page.goto("/protocol")
  const funded = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Funded this epoch" }) })
  await expect(funded.getByText("$0.28")).toBeVisible()
  await expect(funded.getByText("$0.00")).toHaveCount(0)
  // The API's 17 less the dust row and the unregistered token's.
  await expect(funded.getByRole("link", { name: "See all 15" })).toBeVisible()
})

test("a gauge holding unpriced tokens shows them, never No incentives", async ({
  page,
}) => {
  await page.goto("/vote/pools")
  // A registry token the API left without a USD value: funded, unpriced.
  const unpriced = card(page, /^mUSDT\/MUSD CL50$/)
  await expect(unpriced).toBeVisible()
  // Beside the coin marks, in the same line.
  await expect(unpriced.getByText("Unpriced")).toBeVisible()
  await expect(unpriced.getByText("n/a", { exact: true })).toBeVisible()
  await expect(
    unpriced.getByRole("img", { name: "USDC" }).first(),
  ).toBeVisible()
  await expect(unpriced.getByText("No incentives")).toHaveCount(0)
  // Priced and unpriced together, with the APY the priced part earns.
  const mixed = card(page, /^MUSD\/mUSDT Stable$/)
  await expect(mixed.getByText("$1.15 + 1 unpriced")).toBeVisible()
  await expect(mixed.getByText("0.52")).toBeVisible()
  // An unregistered token is held, but never funds the gauge.
  const unregistered = card(page, /^FAKEBTC\/MUSD Stable$/)
  await expect(unregistered.getByText("Unpriced")).toBeVisible()
  await page.goto("/vote/pools?tab=funded")
  await expect(card(page, /^mUSDT\/MUSD CL50$/)).toBeVisible()
  await expect(card(page, /^FAKEBTC\/MUSD Stable$/)).toHaveCount(0)
})

test("Protocol lists unpriced incentives, and never an unregistered token", async ({
  page,
}) => {
  await page.goto("/protocol")
  const funded = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Funded this epoch" }) })
  await expect(funded.getByText("Unpriced", { exact: true })).toBeVisible()
  await expect(funded.getByText("$1.15 + 1 unpriced")).toBeVisible()
  await expect(funded.getByText(/FAKEBTC/)).toHaveCount(0)
})
