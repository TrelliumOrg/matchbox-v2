import { inspectable } from "@matchbox/ui/inspect-e2e"
import { expect, type Locator, type Page, test } from "@playwright/test"

/**
 * Mezo's markets over time (Matchscan batch 2) against the fixtures:
 * Network's TVL and DEX volume per day, a pool's liquidity and share of
 * DEX, MUSD borrowed and repaid per day and in each pool, and collateral
 * ratios on Borrow. Each chart reads a day into its figure when hovered,
 * and every page renders without console errors.
 */

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

function region(page: Page, name: string): Locator {
  return page.getByRole("region", { name, exact: true })
}

/** A panel's chart days (its share bar's parts are inspectable too). */
function days(panel: Locator): Locator {
  return panel.locator('[data-inspect="x"] [data-inspect-point]')
}

/**
 * The chart's first day reads into the figure: focus the chart and press
 * Home (a line's days are zero-size circles, read by position or key).
 */
async function readsOut(panel: Locator): Promise<void> {
  const first = days(panel).first()
  const value = await first.getAttribute("data-inspect-value")
  expect(value).toMatch(/[0-9]/)
  await panel.locator('[data-inspect="x"]').focus()
  await panel.page().keyboard.press("Home")
  await expect(
    panel.locator('[data-inspect-slot="value"] > [data-inspect-live]'),
  ).toHaveText(value ?? "")
}

/** The Mezo pool the fixtures' cross-chain catalog leads with. */
const pool = "/pools/0xcc372b7e15535ab225fe17c1075831d38ef7ac1a"
const market =
  "/borrow/markets/0x6f88e79e8acb3a3ac2f990dcfb83b42ddae96ef406cd735f1721b2a2e1b733db"

test("Network charts TVL and DEX volume per day", async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto("/network")
  const tvl = region(page, "Total value locked")
  await expect(tvl.getByText(/^[+-]\$.* in 30d$/)).toBeVisible()
  await expect(
    tvl.getByText("veBTC, trove collateral and DEX pools at each day's close"),
  ).toBeVisible()
  await expect(days(tvl)).toHaveCount(30)
  const dex = region(page, "DEX volume")
  for (const label of ["7d", "30d", "Liquidity"]) {
    await expect(
      dex.getByRole("term").filter({ hasText: new RegExp(`^${label}$`) }),
    ).toBeVisible()
  }
  await expect(dex.getByText(/^Peak /)).toBeVisible()
  await expect(dex.getByRole("list", { name: "Volume by pool" })).toBeVisible()
  await expect(days(dex)).toHaveCount(30)
  await page.waitForLoadState("networkidle")
  expect(errors).toEqual([])
})

test("the period toggle carries TVL and DEX volume", async ({ page }) => {
  await page.goto("/network?range=90d")
  await expect(
    region(page, "Total value locked").getByText(/ in 90d$/),
  ).toBeVisible()
  await expect(days(region(page, "DEX volume"))).toHaveCount(90)
})

test("a Mezo pool draws its charts after paint, nothing moving", async ({
  page,
}) => {
  const errors = watchErrors(page)
  // Hold the after-paint reads: the panel is laid out in full without them.
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/_serverFn/**", async (route) => {
    await held
    await route.continue()
  })
  await page.goto(pool)
  const liquidity = region(page, "Liquidity")
  await expect(liquidity.getByText("90d high")).toBeVisible()
  await expect(liquidity.getByText("Share of DEX")).toBeVisible()
  await expect(liquidity.getByText(/^[+-]\$.* in 90d$/)).toBeVisible()
  await expect(page.getByText(/^[0-9.]+% of DEX$/).first()).toBeVisible()
  const volume = region(page, "Volume and fees")
  await expect(days(liquidity)).toHaveCount(0)
  await expect(days(volume)).toHaveCount(0)
  const waiting = await liquidity.boundingBox()
  const volumeWaiting = await volume.boundingBox()
  release()
  await expect(days(liquidity)).toHaveCount(90)
  await expect(days(volume)).toHaveCount(30)
  const drawn = await liquidity.boundingBox()
  expect(drawn?.height).toBe(waiting?.height)
  expect(drawn?.y).toBe(waiting?.y)
  expect((await volume.boundingBox())?.height).toBe(volumeWaiting?.height)
  await page.waitForLoadState("networkidle")
  expect(errors).toEqual([])
})

test("MUSD shows borrowed and repaid per day and MUSD in each pool", async ({
  page,
}) => {
  const errors = watchErrors(page)
  await page.goto("/tokens/musd")
  const borrowed = region(page, "MUSD borrowed per day")
  // Read after first paint (musdLater): slower when the suite runs whole.
  await expect(borrowed.getByText("Borrowed 30d")).toBeVisible({
    timeout: 15_000,
  })
  const repaid = region(page, "MUSD repaid per day")
  for (const label of ["Repaid 30d", "Redeemed 30d", "Liquidated 30d"]) {
    await expect(repaid.getByText(label)).toBeVisible()
  }
  await expect(days(region(page, "MUSD in DEX pools")).first()).toBeAttached()
  const sits = region(page, "Where MUSD sits")
  await expect(sits.getByText("DEX pools", { exact: true })).toBeVisible()
  const byPool = region(page, "MUSD by pool")
  await expect(byPool.getByText("mUSDC/MUSD Stable")).toBeVisible()
  await expect(byPool.getByText("Other pools")).toBeVisible()
  await page.waitForLoadState("networkidle")
  expect(errors).toEqual([])
})

test("Borrow charts the troves' collateral ratio", async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto("/borrow")
  const troves = region(page, "Troves")
  await expect(
    troves.getByText("Collateral ratio, BTC at each day's close"),
  ).toBeVisible()
  await expect(days(troves).first()).toBeAttached()
  await page.waitForLoadState("networkidle")
  expect(errors).toEqual([])
})

test("a market charts its collateral and collateral ratio", async ({
  page,
}) => {
  const errors = watchErrors(page)
  await page.goto(market)
  for (const name of ["Collateral", "Collateral ratio"]) {
    await expect(days(region(page, name)).first()).toBeAttached()
  }
  await expect(
    region(page, "Collateral ratio")
      .getByText(/^[0-9,]+\.[0-9]%$/)
      .first(),
  ).toBeVisible()
  await page.waitForLoadState("networkidle")
  expect(errors).toEqual([])
})

test.describe("reading a day", () => {
  test("Home reads the first day into TVL, DEX volume and liquidity", async ({
    page,
  }) => {
    await page.goto("/network")
    await inspectable(page)
    await readsOut(region(page, "Total value locked"))
    await readsOut(region(page, "DEX volume"))
    await page.goto(pool)
    await inspectable(page)
    await readsOut(region(page, "Liquidity"))
  })
})

test.describe("while the API's database is not bound (503)", () => {
  test.use({ extraHTTPHeaders: { "x-scan-fixture": "disabled" } })

  test("the market panels say not available yet", async ({ page }) => {
    const errors = watchErrors(page)
    expect((await page.goto("/network"))?.status()).toBe(200)
    await expect(
      region(page, "DEX volume").getByText("Not available yet"),
    ).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect(errors).toEqual([])
  })
})
