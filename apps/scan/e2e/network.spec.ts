import { expect, type Page, test } from "@playwright/test"

import { networkRoutes } from "../scripts/routes-network.mjs"

/**
 * The Network overview and the Tokens pages against the fixtures (the
 * shared series, prices and activity routes): each renders without
 * console errors and shows its panels, a backfill-only series says where
 * it ends, a token page has one URL, and every page degrades to "Not
 * available yet" while the API's database is not bound.
 */

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
  { path: "/network", heading: "Network", figure: "Daily active addresses" },
  { path: "/tokens", heading: "Tokens", figure: "Solv Protocol solvBTC" },
  { path: "/tokens/musd", heading: /MUSD/, figure: "Trove collateral" },
  { path: "/tokens/mezo", heading: /MEZO/, figure: "1,916,000 MEZO" },
]

test("the perf gates measure these pages", () => {
  expect(networkRoutes).toEqual(
    pages.map((each) => each.path).filter((path) => path !== "/tokens"),
  )
})

for (const each of pages) {
  test(`${each.path} renders its figures without console errors`, async ({
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

test("the overview sits beside Transactions and Blocks", async ({ page }) => {
  await page.goto("/network")
  const tabs = page.getByRole("navigation", { name: "Network" })
  await expect(tabs.getByRole("link", { name: "Overview" })).toHaveAttribute(
    "aria-current",
    "page",
  )
  await expect(page.getByText("Ends 31 Oct 2026").first()).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Latest activity" }),
  ).toBeVisible()
  await tabs.getByRole("link", { name: "Transactions" }).click()
  await expect(page).toHaveURL(/\/network\/transactions$/)
})

test("the period toggle keeps to the URL", async ({ page }) => {
  await page.goto("/network")
  await page
    .getByRole("navigation", { name: "Period" })
    .first()
    .getByRole("link", { name: "90d" })
    .click()
  await expect(page).toHaveURL(/\/network\?range=90d$/)
  await expect(
    page
      .getByRole("navigation", { name: "Period" })
      .first()
      .getByRole("link", { name: "90d" }),
  ).toHaveAttribute("aria-current", /.+/)
})

test("tokens open their page or their address", async ({ page }) => {
  await page.goto("/tokens")
  const table = page.getByRole("table", { name: "Tracked tokens" })
  await table.getByRole("link", { name: "MUSD", exact: true }).click()
  await expect(page).toHaveURL(/\/tokens\/musd$/)
  await expect(
    page.getByRole("link", { name: /Borrow on Mezo/ }),
  ).toHaveAttribute("href", "https://mezo.org/borrow")
  await page.goto("/tokens")
  await expect(
    table.getByRole("link", { name: "mUSDC", exact: true }),
  ).toHaveAttribute(
    "href",
    "/address/0x04671c72aab5ac02a03c1098314b1bb6b560c197",
  )
})

test("the token list says how each figure is known", async ({ page }) => {
  await page.goto("/tokens")
  const table = page.getByRole("table", { name: "Tracked tokens" })
  await expect(
    table.getByRole("columnheader", { name: "Holders" }),
  ).toBeAttached()
  await expect(table.getByText("$105,710").first()).toBeVisible()
  // MUSD is never priced at the API's $1: without our on-chain price it is
  // not counted yet. Bridged dollars say what they are priced as. sMUSD
  // has no rows yet.
  const musd = table.getByRole("row").filter({ hasText: "Mezo USD" })
  await expect(musd.getByText("Not counted yet")).toBeVisible()
  await expect(table.getByText("Taken as $1")).toHaveCount(0)
  await expect(table.getByText("Bridged, priced as USDC")).toBeVisible()
  // The fixtures price MEZO on its Aerodrome fallback: the pool is named,
  // as plain text. No page links out to a price source.
  await expect(table.getByText("Aerodrome MEZO/MUSD on Base")).toBeVisible()
  await expect(
    page.getByRole("link", { name: /CoinGecko/ }).filter({ visible: true }),
  ).toHaveCount(0)
  await expect(table.getByText("Not available yet").first()).toBeVisible()
})

test("a token page has one URL", async ({ page }) => {
  const cases = [
    ["/tokens/MUSD", "/tokens/musd"],
    ["/tokens/0x7B7c000000000000000000000000000000000001", "/tokens/mezo"],
  ] as const
  for (const [from, to] of cases) {
    const response = await page.request.get(from, { maxRedirects: 0 })
    expect(response.status(), from).toBe(301)
    expect(
      new URL(response.headers().location ?? "", "http://x").pathname,
      from,
    ).toBe(to)
  }
  // The period asked for survives the redirect.
  const ranged = await page.request.get("/tokens/MUSD?range=90d", {
    maxRedirects: 0,
  })
  expect(ranged.status()).toBe(301)
  const location = new URL(ranged.headers().location ?? "", "http://x")
  expect(`${location.pathname}${location.search}`).toBe(
    "/tokens/musd?range=90d",
  )
  const missing = await page.goto("/tokens/btc")
  expect(missing?.status()).toBe(404)
})

test("each page has its cache class", async ({ baseURL }) => {
  const cases = [
    ["/network", "s-maxage=4,"],
    ["/tokens", "s-maxage=15,"],
    ["/tokens/musd", "s-maxage=15,"],
    ["/tokens/mezo", "s-maxage=15,"],
  ] as const
  for (const [path, policy] of cases) {
    const response = await fetch(`${baseURL}${path}`)
    expect(response.headers.get("cache-control"), path).toContain(policy)
  }
})

test("no network or token page scrolls sideways", async ({ page }) => {
  for (const each of pages) {
    await page.goto(each.path)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow, each.path).toBeLessThanOrEqual(0)
  }
})

test.describe("while the aggregates are still filling, as live", () => {
  test.use({ extraHTTPHeaders: { "x-scan-fixture": "filling" } })

  test("a price too new for a 7d change says so", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/tokens")
    const table = page.getByRole("table", { name: "Tracked tokens" })
    const btc = table.getByRole("row").filter({ hasText: "$105,710" }).first()
    const note = btc.getByText("Not enough history yet")
    // Phones reflow the table without its 7d column.
    if (isMobile) await expect(note).toBeAttached()
    else await expect(note).toBeVisible()
  })

  test("its panel says not available yet, not that there are none", async ({
    page,
  }) => {
    await page.goto("/network")
    const panel = page
      .getByRole("region", { name: "Daily active addresses" })
      .first()
    await expect(panel.getByText("Not available yet")).toBeVisible()
    await expect(page.getByText("No active addresses yet")).toHaveCount(0)
  })
})

test.describe("while the API's database is not bound (503)", () => {
  test.use({ extraHTTPHeaders: { "x-scan-fixture": "disabled" } })

  test("the pages stand, their sections say not available yet", async ({
    page,
  }) => {
    for (const each of pages) {
      const errors = watchErrors(page)
      const response = await page.goto(each.path)
      expect(response?.status(), each.path).toBe(200)
      expect(response?.headers()["cache-control"], each.path).toBe("no-store")
      await expect(
        page.getByRole("heading", { level: 1, name: each.heading }),
      ).toBeVisible()
      await expect(page.getByText("Not available yet").first()).toBeVisible()
      await page.waitForLoadState("networkidle")
      expect(errors, each.path).toEqual([])
    }
  })
})

test("a transaction's identical rows show once, with how many", async ({
  page,
}) => {
  await page.goto("/network")
  const activity = page.getByRole("list", { name: "Activity" })
  await expect(activity.getByText("Refreshed votes, 4 times")).toHaveCount(1)
  await expect(activity.getByText(/Refreshed votes ons*$/)).toHaveCount(0)
})

test("blocks show their times and named proposers", async ({
  page,
  isMobile,
}) => {
  await page.goto("/network/blocks")
  const panel = page.getByRole("region", { name: "Block time" })
  await expect(panel.getByText("average")).toBeVisible()
  await expect(panel.getByText(/^Slowest /)).toBeVisible()
  if (!isMobile) {
    await expect(page.getByRole("columnheader", { name: "Took" })).toBeVisible()
  }
  await expect(
    page.getByRole("link", { name: "Harbor Stake" }).first(),
  ).toBeVisible()
  await page.goto("/")
  await expect(page.getByText(/^\d+\.\ds average$/)).toBeVisible()
})

test("block time reads over the last day and over 30 days", async ({
  page,
}) => {
  await page.goto("/network/blocks")
  const panel = page.getByRole("region", { name: "Block time" })
  const periods = panel.getByRole("navigation", { name: "Block time period" })
  await periods.getByRole("link", { name: "Last day" }).click()
  await expect(page).toHaveURL(/window=24h/)
  // The real span between the two daily reads, never taken as 24h.
  await expect(panel.getByText(/^average, [\d.]+h, \d+ \w+$/)).toBeVisible()
  await expect(panel.getByText(/^Blocks, [\d.]+h$/)).toBeVisible()
  await periods.getByRole("link", { name: "30 days" }).click()
  await expect(page).toHaveURL(/window=30d/)
  await expect(panel.getByText(/^average, [\d.]+ days?$/)).toBeVisible()
  // A bar a span, each inspectable.
  await expect(panel.locator("[data-inspect-point]").first()).toHaveAttribute(
    "data-inspect-value",
    /^\d+\.\ds$/,
  )
  await expect(periods.getByRole("link", { name: "30 days" })).toHaveAttribute(
    "aria-current",
    /true|page/,
  )
})

test("MUSD's tabs show holders, transfers and the contract", async ({
  page,
}) => {
  const errors = watchErrors(page)
  await page.goto("/tokens/musd?tab=holders")
  const tabs = page.getByRole("navigation", { name: "Token" })
  await expect(tabs.getByRole("link", { name: /Holders/ })).toHaveAttribute(
    "aria-current",
    "page",
  )
  await expect(page.getByText("74.6%").first()).toBeVisible()
  await tabs.getByRole("link", { name: "Transfers" }).click()
  await expect(page).toHaveURL(/\/tokens\/musd\?tab=transfers$/)
  await expect(
    page.getByRole("navigation", { name: "Transfer pages" }),
  ).toBeVisible()
  await tabs.getByRole("link", { name: "Contract" }).click()
  await expect(page.getByText("v0.8.20+commit.a1b79de6")).toBeVisible()
  await page.goto("/tokens?sort=holders")
  await expect(
    page.getByRole("navigation", { name: "Sort" }).getByRole("link", {
      name: "Holders",
    }),
  ).toHaveAttribute("aria-current", "page")
  await page.waitForLoadState("networkidle")
  expect(errors).toEqual([])
})

test("transactions read in plain words, with category tabs", async ({
  page,
}) => {
  const errors = watchErrors(page)
  await page.goto("/network/transactions")
  await expect(page.getByText("Contract call").first()).toBeVisible()
  const tabs = page.getByRole("navigation", { name: "Transaction types" })
  await expect(tabs.getByRole("link", { name: "All" })).toHaveAttribute(
    "aria-current",
    "page",
  )
  await tabs.getByRole("link", { name: "Votes" }).click()
  await expect(page).toHaveURL(/\/network\/transactions\?tab=votes$/)
  await expect(page.getByText(/^Voted /).first()).toBeVisible()
  await tabs.getByRole("link", { name: "Swaps" }).click()
  await expect(page.getByText(/^Swapped /).first()).toBeVisible()
  await page.waitForLoadState("networkidle")
  expect(errors).toEqual([])
})
