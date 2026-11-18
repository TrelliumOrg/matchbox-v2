import { expect, type Page, test } from "@playwright/test"

import {
  borrowEnclavePosition as enclave,
  borrowMarket as market,
  borrowWallet as wallet,
} from "../scripts/routes-borrow.mjs"

/**
 * Borrow pages on the fixtures (src/data/scan/fixtures/borrow.ts): the
 * overview and its tabs, a Morpho market and position, a trove and an
 * Enclave position. Each renders without console errors and shows the
 * fixtures' figures, degrades to "Not available yet" on a 503, redirects
 * to its canonical URL, 404s what does not exist and fits a phone.
 */

const nobody = `0x${"0".repeat(40)}`
const upper = (hex: string) => `0x${hex.slice(2).toUpperCase()}`

/** Fails the test on any console error or uncaught exception. */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

const pages = [
  { path: "/borrow", heading: "Borrow", figure: "1,840,221.40 MUSD" },
  { path: "/borrow/enclaves", heading: "Borrow", figure: "33,000.00 MUSD" },
  { path: "/borrow/markets", heading: "Borrow", figure: "BTC / MUSD" },
  { path: "/borrow/positions", heading: "Borrow", figure: "70,349 MUSD" },
  {
    path: "/borrow/liquidations",
    heading: "Borrow",
    figure: "-2,192.30 MUSD, -0.0310 BTC",
  },
  { path: "/borrow/troves", heading: "Borrow", figure: "200.2%" },
  {
    path: `/borrow/markets/${market}`,
    heading: "BTC / mUSDC",
    figure: "1,800,000.00 mUSDC",
  },
  {
    path: `/borrow/markets/${market}/${wallet}`,
    heading: "0x4582…f901",
    figure: "53,937 mUSDC",
  },
  {
    path: `/borrow/troves/${wallet}`,
    heading: "0x4582…f901",
    figure: "10,012.50 MUSD",
  },
  {
    path: `/borrow/enclaves/${enclave}`,
    heading: "0x00000000…7c1a7e01",
    figure: "25,000.00 MUSD",
  },
]

for (const each of pages) {
  test(`${each.path} renders the fixtures without console errors`, async ({
    page,
  }) => {
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

test("a position shows the API's health figures", async ({ page }) => {
  await page.goto(`/borrow/markets/${market}/${wallet}`)
  await expect(page.getByText("1.37", { exact: true })).toBeVisible()
  await expect(page.getByText("LTV 62.7% of 86% LLTV")).toBeVisible()
  await expect(page.getByText("27.1% below BTC")).toBeVisible()
  await expect(
    page.getByRole("link", { name: /Manage on Mezo/ }),
  ).toHaveAttribute("href", "https://mezo.org/borrow")
})

test("the overview leads with MUSD borrowed and lists Enclaves", async ({
  page,
}) => {
  await page.goto("/borrow")
  await expect(page.getByText("723,361 MUSD")).toBeVisible()
  await expect(page.getByText("3.5% in Enclaves")).toBeVisible()
  await expect(page.getByText("1 Enclave, 4 Morpho, 3 troves")).toBeVisible()
  await expect(page.getByText("57,360.75 MUSD")).toBeVisible()
  const enclaves = page.getByRole("table", { name: "Enclave positions" })
  await enclaves.getByRole("link", { name: "0x00000000…7c1a7e01" }).click()
  await expect(page).toHaveURL(`/borrow/enclaves/${enclave}`)
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible()
  await page
    .getByRole("navigation", { name: /breadcrumb/i })
    .getByRole("link", { name: "Enclaves" })
    .click()
  await expect(page).toHaveURL("/borrow/enclaves")
  await expect(
    page.getByRole("heading", { name: "Enclave positions" }),
  ).toBeVisible()
})

test("a veBTC lock pledged to an Enclave says so", async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto("/locks/vebtc/604")
  await expect(
    page.getByRole("link", { name: /Enclave collateral/ }),
  ).toHaveAttribute("href", `/borrow/enclaves/${enclave}`)
  await expect(
    page.getByRole("link", { name: "View position" }),
  ).toHaveAttribute("href", `/borrow/enclaves/${enclave}`)
  await page.waitForLoadState("networkidle")
  expect(errors).toEqual([])
})

test("a market page computes supply APY, liquidity and the incentive", async ({
  page,
}) => {
  await page.goto(`/borrow/markets/${market}`)
  await expect(page.getByText("3.8%", { exact: true })).toBeVisible()
  await expect(page.getByText("4.38%", { exact: true })).toBeVisible()
  await expect(page.getByText("700,000.00 mUSDC")).toBeVisible()
  // The debt column's second line, as the APR it replaces: wide screens.
  const share = page.getByText("11.0% of debt").first()
  if (test.info().project.name === "desktop") await expect(share).toBeVisible()
  else await expect(share).toBeAttached()
})

test("the tabs and the period toggle navigate", async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto("/borrow")
  await page.waitForLoadState("networkidle")
  await page
    .getByRole("navigation", { name: "Borrow" })
    .getByRole("link", { name: "Troves" })
    .click()
  await expect(page).toHaveURL("/borrow/troves")
  await expect(page.getByRole("heading", { name: "Open troves" })).toBeVisible()
  await page.goto("/borrow")
  await page.getByRole("link", { name: "90d" }).first().click()
  await expect(page).toHaveURL("/borrow?range=90d")
  expect(errors).toEqual([])
})

test.describe("while the API's database is not bound (503)", () => {
  test.use({ extraHTTPHeaders: { "x-scan-fixture": "disabled" } })

  for (const each of pages) {
    test(`${each.path} says its data is not available yet`, async ({
      page,
    }) => {
      const response = await page.goto(each.path)
      expect(response?.status()).toBe(200)
      expect(response?.headers()["cache-control"]).toBe("no-store")
      await expect(page.getByText("Not available yet").first()).toBeVisible()
    })
  }
})

test("borrow URLs redirect to one canonical form", async ({ page }) => {
  const cases = [
    [`/borrow/markets/${upper(market)}`, `/borrow/markets/${market}`],
    [
      `/borrow/markets/${market}/${upper(wallet)}`,
      `/borrow/markets/${market}/${wallet}`,
    ],
    [`/borrow/troves/${upper(wallet)}`, `/borrow/troves/${wallet}`],
    [`/borrow/enclaves/${upper(enclave)}`, `/borrow/enclaves/${enclave}`],
    ["/borrow/enclaves/0012", "/borrow/enclaves/12"],
  ] as const
  for (const [from, to] of cases) {
    const response = await page.request.get(from, { maxRedirects: 0 })
    expect(response.status(), from).toBe(301)
    expect(
      new URL(response.headers().location ?? "", "http://x").pathname,
      from,
    ).toBe(to)
  }
})

test("borrow entities that do not exist are 404s", async ({ page }) => {
  for (const path of [
    "/borrow/markets/0xzz",
    `/borrow/markets/0x${"ab".repeat(32)}`,
    `/borrow/markets/${market}/${nobody}`,
    `/borrow/troves/${nobody}`,
    "/borrow/enclaves/abc",
    "/borrow/enclaves/12",
  ]) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(404)
    await expect(page.getByText("Not found").first(), path).toBeVisible()
  }
  const tab = await page.goto("/borrow/nope")
  expect(tab?.status()).toBe(404)
})

test("no borrow page scrolls sideways", async ({ page }) => {
  for (const { path } of pages) {
    await page.goto(path)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow, path).toBeLessThanOrEqual(0)
  }
})

test.describe("while the live Borrow snapshot is behind", () => {
  test.use({ extraHTTPHeaders: { "x-scan-fixture": "delayed" } })

  test("each page with live Borrow reads says so in its content", async ({
    page,
  }) => {
    for (const path of [
      "/borrow",
      "/borrow/markets",
      "/borrow/positions",
      "/borrow/troves",
      `/borrow/markets/${market}`,
      `/borrow/markets/${market}/${wallet}`,
      `/borrow/troves/${wallet}`,
    ]) {
      await page.goto(path)
      await expect(
        page.locator("main").getByText(/^Borrow data is delayed/),
        path,
      ).toBeVisible()
    }
    // Liquidations are history: no live read, no note in the content.
    await page.goto("/borrow/liquidations")
    await expect(
      page.locator("main").getByText(/^Borrow data is delayed/),
    ).toHaveCount(0)
  })
})

test("a current snapshot says nothing about delays", async ({ page }) => {
  await page.goto("/borrow")
  await expect(page.getByText(/^Borrow data is delayed/)).toHaveCount(0)
})

test("the closest to liquidation ranks troves beside Morpho positions", async ({
  page,
}) => {
  await page.goto("/borrow")
  const table = page.getByRole("table", { name: "Closest to liquidation" })
  await expect(table.getByText("MUSD trove").first()).toBeVisible()
  await expect(
    page.getByText("Morpho positions and troves, by health factor"),
  ).toBeVisible()
})

test("a market found on chain has its row, its page and its position", async ({
  page,
}) => {
  const discovered =
    "0x4bff245ddc101cd43e365aa1faff97351ab36a225e43d9a76aab82ff763030b8"
  await page.goto("/borrow/markets")
  await expect(page.getByText("BTC / MUSD (0x4bff…30b8)").first()).toBeVisible()
  const response = await page.goto(`/borrow/markets/${discovered}`)
  expect(response?.status()).toBe(200)
  // Its one borrower, sized with the decimals the market list carries.
  await expect(page.getByText("1,000.00 MUSD").first()).toBeVisible()
})
