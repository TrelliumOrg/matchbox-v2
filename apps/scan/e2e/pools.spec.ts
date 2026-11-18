import { expect, type Page, test } from "@playwright/test"

import { curvePool, poolsRoutes, tigrisPool } from "../scripts/routes-pools.mjs"

/**
 * Pools and the cross-chain token sections against the fixtures
 * (`/internal/scan/crosschain/*`): each renders without console errors,
 * the filters are links, pools under $25,000 hide until asked for and
 * never show a rate, the phone tabs carry Pools with Network under More,
 * nothing scrolls sideways (the page's content at 360px too), and with
 * empty tables (production's first state) every figure says "not counted
 * yet", never $0 or $1.
 */

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

const pages = [
  { path: "/pools", heading: "Pools", figure: "Total value locked" },
  {
    path: `/pools/ethereum/${curvePool}`,
    heading: "MUSD/2pool",
    figure: "$3,355,432",
  },
  {
    path: `/pools/${tigrisPool}`,
    heading: "mUSDC/MUSD CL10",
    // A Mezo pool's own figures, from its swaps and reserves.
    figure: "Volume to reserves",
  },
]

test("the perf gates measure these pages", () => {
  expect(poolsRoutes).toEqual(pages.map((each) => each.path))
})

for (const each of pages) {
  test(`${each.path} renders without console errors`, async ({ page }) => {
    const errors = watchErrors(page)
    const response = await page.goto(each.path)
    expect(response?.status()).toBe(200)
    await expect(
      page.getByRole("heading", { level: 1, name: each.heading }),
    ).toBeVisible()
    await expect(
      page.getByText(each.figure).filter({ visible: true }).first(),
    ).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect(errors).toEqual([])
  })
}

test("unknown pools are not found, Mezo pools have one URL", async ({
  page,
}) => {
  const missing = await page.goto(
    "/pools/base/0x0000000000000000000000000000000000000001",
  )
  expect(missing?.status()).toBe(404)
  await page.goto(`/pools/mezo/${tigrisPool}`)
  await expect(page).toHaveURL(new RegExp(`/pools/${tigrisPool}$`))
})

test("the chain filter is a link that narrows the table", async ({ page }) => {
  await page.goto("/pools")
  const chains = page.getByRole("navigation", { name: "Chain" })
  await chains.getByRole("link", { name: /Ethereum/ }).click()
  await expect(page).toHaveURL(/chain=ethereum/)
  const table = page.getByRole("table", { name: "Pools" })
  await expect(table.getByText("MUSD/2pool")).toBeVisible()
  await expect(table.getByText("Savings vault")).toHaveCount(0)
})

test("pools under $25,000 hide until asked for, with no rate", async ({
  page,
}) => {
  await page.goto("/pools")
  const table = page.getByRole("table", { name: "Pools" })
  await expect(table.getByText("MEZO/BTC CL2000")).toHaveCount(0)
  await page.getByRole("link", { name: /Show 3 pools under \$25,000/ }).click()
  await expect(page).toHaveURL(/small=true/)
  const thin = table.getByRole("row").filter({ hasText: "MEZO/BTC CL2000" })
  await expect(thin).toHaveCount(1)
  await expect(thin).not.toContainText("370")
  await expect(
    table.getByRole("row").filter({ hasText: "legacy pool" }),
  ).toHaveCount(2)
})

test("a pool off Mezo links out to its venue and explorer", async ({
  page,
}) => {
  await page.goto(`/pools/ethereum/${curvePool}`)
  await expect(
    page.getByRole("link", { name: "Add liquidity on Curve" }),
  ).toHaveAttribute("href", /curve\.finance/)
  await expect(
    page.getByRole("link", { name: "Etherscan" }).first(),
  ).toHaveAttribute("href", `https://etherscan.io/address/${curvePool}`)
})

test("the MUSD page heads with our price and counts supply once", async ({
  page,
}) => {
  await page.goto("/tokens/musd")
  await expect(
    page.getByText("On chain, liquidity-weighted").first(),
  ).toBeVisible()
  const supply = page.getByRole("region", { name: "Supply by chain" })
  await expect(supply.getByText("Minted on Mezo, counted once")).toBeVisible()
  await expect(supply.getByText("not counted again")).toBeVisible()
  await expect(page.getByRole("region", { name: "Bridged MUSD" })).toBeVisible()
})

test("phones carry Pools in the tabs and Network under More", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "the bottom tabs are a phone's")
  await page.goto("/pools")
  const tabs = page.getByRole("navigation", { name: "Matchscan tabs" })
  await expect(tabs.getByRole("link", { name: "Pools" })).toHaveAttribute(
    "aria-current",
    "page",
  )
  await expect(tabs.getByRole("link", { name: "Network" })).toHaveCount(0)
  await tabs.getByRole("button", { name: "More" }).click()
  await expect(page.getByRole("link", { name: "Network" }).last()).toBeVisible()
})

const crossChainPaths = [...poolsRoutes, "/tokens/musd", "/tokens/mezo"]

test("no pools or token page scrolls sideways", async ({ page }) => {
  for (const path of crossChainPaths) {
    await page.goto(path)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow, path).toBeLessThanOrEqual(0)
  }
})

test.describe("at 360 wide", () => {
  test.skip(({ isMobile }) => !isMobile, "phone layout")
  test.use({ viewport: { width: 360, height: 780 } })

  test("no pools or token page scrolls sideways", async ({ page }) => {
    for (const path of [...crossChainPaths, "/pools?small=true"]) {
      await page.goto(path)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
      expect(overflow, path).toBeLessThanOrEqual(0)
    }
  })
})

test.describe("before the first reading, as production starts", () => {
  test.use({ extraHTTPHeaders: { "x-scan-fixture": "filling" } })

  test("every figure says not counted yet, never $0 or $1", async ({
    page,
  }) => {
    await page.goto("/pools")
    await expect(page.getByText("Not available yet").first()).toBeVisible()
    const text = ((await page.locator("#main").textContent()) ?? "").replace(
      /\s+/g,
      " ",
    )
    expect(text).not.toMatch(/\$0\b|\$0\.00|\$1\.00/)
    await page.goto("/tokens/musd")
    await expect(page.getByText("Price not counted yet")).toBeVisible()
    await expect(
      page.getByText("Supply by chain not counted yet"),
    ).toBeVisible()
    await page.goto("/tokens")
    const musd = page.getByRole("row").filter({ hasText: "Mezo USD" })
    await expect(musd.getByText("Not counted yet")).toBeVisible()
    await expect(musd).not.toContainText("$1.00")
  })
})

test.describe("with Mezo's daily pool rows missing, as production", () => {
  test.use({ extraHTTPHeaders: { "x-scan-fixture": "partial" } })

  test("Mezo pools stay listed, their figures not available", async ({
    page,
  }) => {
    await page.goto("/pools?chain=mezo")
    const table = page.getByRole("table", { name: "Pools" })
    const row = table.getByRole("row").filter({ hasText: "mUSDC/MUSD CL10" })
    await expect(row).toHaveCount(1)
    await expect(row.getByText("Not available yet").first()).toBeAttached()
    await expect(row).not.toContainText("Under $25k")
    await expect(row).not.toContainText("$0")
    const text = ((await page.locator("#main").textContent()) ?? "").replace(
      /\s+/g,
      " ",
    )
    expect(text).not.toMatch(/\$0\b|\$0\.00/)
    const response = await page.goto(`/pools/${tigrisPool}`)
    expect(response?.status()).toBe(200)
    await expect(
      page.getByRole("heading", { level: 1, name: "mUSDC/MUSD CL10" }),
    ).toBeVisible()
    await expect(page.getByText("Not available yet").first()).toBeVisible()
  })
})

test.describe("while the API's database is not bound", () => {
  test.use({ extraHTTPHeaders: { "x-scan-fixture": "disabled" } })

  test("pools say not available yet", async ({ page }) => {
    const response = await page.goto("/pools")
    expect(response?.status()).toBe(200)
    await expect(page.getByText("Not available yet").first()).toBeVisible()
  })
})
