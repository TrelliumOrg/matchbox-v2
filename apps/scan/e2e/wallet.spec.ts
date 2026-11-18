import { inspectable } from "@matchbox/ui/inspect-e2e"
import { expect as baseExpect, test } from "@playwright/test"
import {
  fixtureAddress as address,
  fixtureWallet as wallet,
} from "../scripts/routes.mjs"

/**
 * The wallet panels load after the page hydrates, which takes a few
 * seconds with every test's browser at once: their checks wait longer.
 */
const expect = baseExpect.configure({ timeout: 15_000 })

/**
 * A lock owner's address page (`eSwId--0MF`): rewards earned, the voting
 * streak, veMEZO votes and claimable from the read models Matchbox Pro
 * reads, the Rewards tab and rewards by epoch, against the fixtures (the
 * demo wallet's rewards, the fixture wallet's lock votes).
 */

test.describe("a lock owner's address page", () => {
  test("shows the wallet tiles and claims on Matchbox", async ({ page }) => {
    await page.goto(`/address/${wallet}`)
    const tiles = page.getByRole("region", { name: "Overview" })
    // Loaded after the page, in the places held for them.
    await expect(tiles.getByText("Rewards claimed")).toBeVisible()
    await expect(tiles.getByText("$2,457.40")).toBeVisible()
    await expect(tiles.getByText("4 epochs", { exact: true })).toBeVisible()
    // Votes in Epochs 45 to 47, none in 44.
    await expect(tiles.getByText("Locks' voting streak")).toBeVisible()
    await expect(tiles.getByText("3 epochs", { exact: true })).toBeVisible()
    await expect(tiles.getByText("Missed Epoch 44")).toBeVisible()
    await expect(tiles.getByText("41,260")).toBeVisible()
    await expect(tiles.getByText("100% of power used")).toBeVisible()
    await expect(tiles.getByText("$212.48")).toBeVisible()
    await expect(tiles.getByText("Epoch 46 votes")).toBeVisible()
    await expect(tiles.getByText("5.15% projected APR")).toBeVisible()
    await expect(
      tiles.getByRole("link", { name: "Claim on Matchbox" }),
    ).toHaveAttribute("href", "https://pro.matchbox.markets/rewards")
  })

  test("draws rewards by epoch and the recent activity", async ({ page }) => {
    await page.goto(`/address/${wallet}`)
    const panel = page.getByRole("region", { name: "Rewards by epoch" })
    await expect(panel.getByText("$207.14")).toBeVisible()
    const bars = panel.locator("[data-inspect-point]")
    // Epochs 42 to 46, then 47 projected.
    await expect(bars).toHaveCount(6)
    await expect(bars.last()).toHaveAttribute(
      "data-inspect-label",
      "Epoch 47 projected",
    )
    await expect(
      page.getByRole("region", { name: "Recent activity" }),
    ).toBeVisible()
  })

  test("an epoch's bar reads into the figure", async ({ page, isMobile }) => {
    test.skip(isMobile, "hover is a pointer's")
    await page.goto(`/address/${wallet}`)
    const panel = page.getByRole("region", { name: "Rewards by epoch" })
    const first = panel.locator("[data-inspect-point]").first()
    await expect(first).toBeVisible()
    await inspectable(page)
    await first.hover()
    await expect(
      panel.locator('[data-inspect-slot="value"] > [data-inspect-live]'),
    ).toHaveText((await first.getAttribute("data-inspect-value")) ?? "")
  })

  test("the period keeps the latest epochs", async ({ page }) => {
    await page.goto(`/address/${wallet}?range=30d`)
    const panel = page.getByRole("region", { name: "Rewards by epoch" })
    await expect(panel.locator("[data-inspect-point]")).toHaveCount(5)
    // Only the period shown is current.
    const periods = panel.getByRole("navigation", { name: "Rewards period" })
    await expect(periods.locator("[aria-current]")).toHaveCount(1)
    await expect(periods.getByRole("link", { name: "30d" })).toHaveAttribute(
      "aria-current",
      /true|page/,
    )
  })

  test("lists claimable by lock and every claim", async ({ page }) => {
    await page.goto(`/address/${wallet}/rewards`)
    const tabs = page.getByRole("navigation", { name: "Address" })
    await expect(tabs.getByRole("link", { name: /Rewards/ })).toHaveAttribute(
      "aria-current",
      "page",
    )
    const claimable = page.getByRole("list", { name: "Claimable by lock" })
    await expect(claimable.getByText("veBTC #4120")).toBeVisible()
    await expect(claimable.getByText("$203.78")).toBeVisible()
    const claims = page.getByRole("list", { name: "Claims" })
    await expect(claims.getByText("Claimed $654.60, Epoch 45")).toBeVisible()
  })

  test("the page holds the wallet tiles' places before they load", async ({
    page,
  }) => {
    // The server's page: placeholders where the tiles will be.
    const response = await page.request.get(`/address/${wallet}`)
    const html = await response.text()
    expect(html).toContain("Locks&#x27; voting streak")
    expect(html).not.toContain("$2,457.40")
    // The panels' read held back, so the placeholders are what is measured.
    await page.route("**/_serverFn/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      await route.continue()
    })
    for (const width of [1440, 390, 360]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`/address/${wallet}`)
      const tiles = page.getByRole("region", { name: "Overview" })
      await expect(tiles.getByText("Loading").first()).toBeAttached()
      const before = await tiles.boundingBox()
      await expect(tiles.getByText("$2,457.40")).toBeVisible()
      expect((await tiles.boundingBox())?.height, `${width}px`).toBe(
        before?.height,
      )
    }
  })

  test("an address with no locks has no Rewards tab", async ({ page }) => {
    await page.goto(`/address/${address}`)
    const tabs = page.getByRole("navigation", { name: "Address" })
    await expect(tabs.getByRole("link", { name: "Positions" })).toBeVisible()
    await expect(tabs.getByRole("link", { name: /Rewards/ })).toHaveCount(0)
    await expect(page.getByText("Claimable")).toHaveCount(0)
  })
})
