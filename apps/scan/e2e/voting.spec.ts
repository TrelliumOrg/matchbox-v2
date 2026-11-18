import { expect, type Page, test } from "@playwright/test"
import { fixtureWallet as wallet } from "../scripts/routes.mjs"
import { fixtureGauge, fixturePoolGauge } from "../scripts/routes-voting.mjs"

/**
 * The Voting and Locks pages (gauges, epochs, locks) against the fixtures:
 * each renders without console errors, shows the fixtures' figures,
 * degrades to "Not available yet" while the API's database is not bound,
 * says "Still filling" instead of zeros, and keeps one canonical URL.
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
  { path: "/gauges", heading: "Gauges", figure: "12.80%" },
  { path: "/gauges?type=pool", heading: "Gauges", figure: "88.1000 veBTC" },
  {
    path: `/gauges/${fixtureGauge}`,
    heading: /Kiln Labs/,
    figure: "1.09M to go",
  },
  {
    path: `/gauges/${fixturePoolGauge}`,
    heading: /BTC\/MUSD/,
    figure: "BTC swapped into BTC/MUSD",
  },
  { path: "/epochs", heading: "Epochs", figure: "1,916,000 MEZO" },
  { path: "/epochs/47", heading: "Epoch 47", figure: "Northfield Nodes" },
  { path: "/epochs/45", heading: "Epoch 45", figure: "Top validators" },
  { path: "/locks", heading: "Locks", figure: "3.1047 BTC" },
  { path: "/locks?escrow=vemezo", heading: "Locks", figure: "250,000.00 MEZO" },
  { path: "/locks/vebtc/604", heading: "veBTC #604", figure: "1.2400 BTC" },
  {
    path: "/locks/vemezo/2207",
    heading: "veMEZO #2207",
    figure: "18,402.55 MEZO",
  },
  {
    path: "/locks/vemezo/604",
    heading: "veMEZO #604",
    figure: "5,200.00 MEZO",
  },
]

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

test.describe("a lock the chain has and the store does not yet", () => {
  // Hard loads: the server renders each page from its own loader, as a
  // visitor arriving from mezo.org would see it (a click-through never
  // hydrates a new page state).
  test("its page shows the chain's figures and what is not indexed yet", async ({
    page,
  }) => {
    const errors = watchErrors(page)
    const response = await page.goto("/locks/vebtc/6179")
    expect(response?.status()).toBe(200)
    // Edge cached like any lock: the chain is read at most once a minute.
    expect(response?.headers()["cache-control"]).toContain("s-maxage=15,")
    await expect(
      page.getByRole("heading", { level: 1, name: "veBTC #6179" }),
    ).toBeVisible()
    await expect(page.getByText("Owned by")).toBeVisible()
    const cards = page.locator("dl")
    await expect(cards.getByText("Amount locked")).toBeVisible()
    await expect(cards.getByText("0.0500 BTC")).toBeVisible()
    await expect(cards.getByText("Auto max")).toBeVisible()
    await expect(cards.getByText("Voting power")).toBeVisible()
    await expect(cards.getByText("0.0500 veBTC")).toBeVisible()
    await expect(cards.getByText("Not voted")).toBeVisible()
    // History and older votes are the indexer's: never made up.
    await expect(page.getByText("Not indexed yet")).toHaveCount(2)
    await expect(page.getByText("No activity")).toHaveCount(0)
    await page.waitForLoadState("networkidle")
    expect(errors).toEqual([])
  })

  test("its owner's address page lists it", async ({ page }) => {
    const errors = watchErrors(page)
    const response = await page.goto(`/address/${wallet}`)
    expect(response?.status()).toBe(200)
    const link = page.locator('a[href="/locks/vebtc/6179"]')
    await expect(link.first()).toBeAttached()
    await expect(page.getByText("veBTC #6179").first()).toBeAttached()
    await page.waitForLoadState("networkidle")
    expect(errors).toEqual([])
  })

  test("a stored lock shows its voting power from the chain", async ({
    page,
  }) => {
    await page.goto("/locks/vemezo/2207")
    const cards = page.locator("dl")
    await expect(cards.getByText("Voting power")).toBeVisible()
    await expect(cards.getByText("6,054 veMEZO")).toBeVisible()
    await expect(page.getByText("Not indexed yet")).toHaveCount(0)
  })
})

test("a gauge type tab filters the table", async ({ page }) => {
  await page.goto("/gauges?type=validator")
  await expect(
    page.getByRole("heading", { level: 2, name: "Validator gauges" }),
  ).toBeVisible()
  const table = page.getByRole("table", { name: "Validator gauges" })
  await expect(table.getByText("Northfield Nodes")).toBeVisible()
  await expect(table.getByText("Kiln Labs")).toHaveCount(0)
})

test("the gauge type tabs sit with the list they filter and keep the scroll", async ({
  page,
}) => {
  await page.goto("/gauges")
  const tabs = page.getByRole("navigation", { name: "Gauge types" })
  const box = async (locator: typeof tabs) => {
    const found = await locator.boundingBox()
    if (found === null) throw new Error("not on screen")
    return found
  }
  const panel = await box(
    page.getByRole("region", { name: "MEZO emissions by epoch" }),
  )
  const heading = await box(
    page.getByRole("heading", { level: 2, name: "All gauges" }),
  )
  const row = await box(tabs)
  const order = await box(page.getByRole("navigation", { name: "Order" }))
  const table = await box(page.getByRole("table", { name: "All gauges" }))
  // Under the summary panels and the list's heading, over the table.
  expect(row.y).toBeGreaterThan(panel.y + panel.height)
  expect(row.y).toBeGreaterThan(heading.y)
  expect(table.y).toBeGreaterThan(row.y)
  expect(order.y).toBeLessThan(table.y)
  // On a wide screen the tabs and the order share one row.
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    expect(
      Math.abs(order.y + order.height / 2 - (row.y + row.height / 2)),
    ).toBeLessThan(2)
  }
  // Switching tabs keeps the reader where they were.
  await tabs.scrollIntoViewIfNeeded()
  const before = await page.evaluate(() => window.scrollY)
  expect(before).toBeGreaterThan(0)
  await tabs.getByRole("link", { name: /Validators/ }).click()
  await page.waitForURL(/[?&]type=validator/)
  await expect(
    page.getByRole("heading", { level: 2, name: "Validator gauges" }),
  ).toBeVisible()
  const after = await page.evaluate(() => window.scrollY)
  expect(Math.abs(after - before)).toBeLessThan(2)
  await expect(tabs).toBeInViewport()
  // On a wide screen the row stays under the top edge down the list.
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    await page.goto("/gauges")
    await page
      .getByRole("navigation", { name: "Pages, end of list" })
      .scrollIntoViewIfNeeded()
    await expect(tabs).toBeInViewport()
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(table.y)
  }
})

test("a tab switched deep in the list goes back to the list's top", async ({
  page,
}) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) < 1024,
    "the tab row follows the list only on a wide screen",
  )
  const tabs = page.getByRole("navigation", { name: "Gauge types" })
  const deep = async (): Promise<void> => {
    await page
      .getByRole("navigation", { name: "Pages, end of list" })
      .scrollIntoViewIfNeeded()
  }
  // To a list as long: from its foot to its top, not the same depth.
  await page.goto("/gauges")
  await deep()
  await tabs.getByRole("link", { name: /veBTC gauges/ }).click()
  await page.waitForURL(/[?&]type=vebtc/)
  await expect(
    page.getByRole("heading", { level: 2, name: "veBTC gauges" }),
  ).toBeVisible()
  const top = await page
    .locator("section[aria-labelledby=all-gauges]")
    .evaluate((section) => section.getBoundingClientRect().top)
  expect(Math.abs(top)).toBeLessThan(2)
  // To a short list: its heading, tabs and rows are on screen.
  await page.goto("/gauges")
  await deep()
  await tabs.getByRole("link", { name: /MEZO gauges/ }).click()
  await page.waitForURL(/[?&]type=mezo/)
  await expect(
    page.getByRole("heading", { level: 2, name: "MEZO gauges" }),
  ).toBeInViewport()
  await expect(
    page.getByRole("table", { name: "MEZO gauges" }),
  ).toBeInViewport()
})

test("at 360 wide the current gauge type tab is in view", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto("/gauges?type=pool")
  const tabs = page.getByRole("navigation", { name: "Gauge types" })
  const current = tabs.getByRole("link", { name: /Pools/ })
  await expect(current).toHaveAttribute("aria-current", "page")
  // Down the page to the row (the page only), then the row's own view.
  await tabs.scrollIntoViewIfNeeded()
  await expect(current).toBeInViewport({ ratio: 1 })
  // The row fades the side that has more tabs.
  await expect(tabs.getByRole("list")).toHaveAttribute("data-more-start", "")
})

test.describe("the gauge directory at production size", () => {
  // Plain links: paging needs no script.
  test.use({ javaScriptEnabled: false })

  test("shows one page and links to the next", async ({ page }) => {
    await page.goto("/gauges")
    const pages = page.getByRole("navigation", { name: "Gauge pages" })
    await expect(pages).toContainText("Gauges 1 to 50 of 774")
    // The pager sits above the table as well as below it.
    const table = page.getByRole("table", { name: "All gauges" })
    const pagerBox = await pages.boundingBox()
    const tableBox = await table.boundingBox()
    expect(pagerBox?.y ?? 0).toBeLessThan(tableBox?.y ?? 0)
    await expect(
      page.getByRole("navigation", { name: "Pages, end of list" }),
    ).toContainText("Gauges 1 to 50 of 774")
    await expect(table.getByRole("row")).toHaveCount(51)
    await pages.getByRole("link", { name: "Next 50" }).click()
    await page.waitForURL(/[?&]after=0x[0-9a-f]{40}/)
    await expect(pages).toContainText("Gauges 51 to 100 of 774")
    await expect(table.getByText("Kiln Labs")).toHaveCount(0)
    await pages.getByRole("link", { name: "From the top" }).click()
    await page.waitForURL((url) => !url.search.includes("after="))
    await expect(pages).toContainText("Gauges 1 to 50 of 774")
  })
})

test("the unlock order says expired locks come first", async ({ page }) => {
  await page.goto("/locks?order=unlock")
  await expect(
    page.getByRole("link", { name: "By unlock date" }),
  ).toHaveAttribute("aria-current", "page")
  await expect(
    page.getByText(
      "Locks past their unlock date and not yet withdrawn come first",
    ),
  ).toBeVisible()
})

test("unknown gauges, epochs and locks are not found", async ({ page }) => {
  for (const path of [
    `/gauges/0x${"12".repeat(20)}`,
    "/epochs/48",
    "/locks/vebtc/999999",
  ]) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(404)
    // Never kept at the edge: a lock minted just after is found as soon as
    // the API's minute-long chain answer runs out.
    expect(response?.headers()["cache-control"], path).toBe("no-store")
  }
})

test("voting URLs redirect to one canonical form", async ({ page }) => {
  const cases = [
    ["/epochs/047", "/epochs/47"],
    ["/locks/VEMEZO/02207", "/locks/vemezo/2207"],
    [
      `/gauges/${fixtureGauge.toUpperCase().replace("0X", "0x")}`,
      `/gauges/${fixtureGauge}`,
    ],
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

test("each voting page has its cache class", async ({ baseURL }) => {
  const cases = [
    ["/gauges", "s-maxage=4,"],
    ["/epochs", "s-maxage=4,"],
    ["/locks", "s-maxage=4,"],
    [`/gauges/${fixtureGauge}`, "s-maxage=15,"],
    ["/epochs/47", "s-maxage=15,"],
    ["/epochs/45", "s-maxage=86400,"],
    ["/locks/vemezo/2207", "s-maxage=15,"],
  ] as const
  for (const [path, policy] of cases) {
    const response = await fetch(`${baseURL}${path}`)
    expect(response.headers.get("cache-control"), path).toContain(policy)
  }
})

test("no voting page scrolls sideways", async ({ page }) => {
  for (const each of pages) {
    await page.goto(each.path)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow, each.path).toBeLessThanOrEqual(0)
  }
})

test.describe("while the API's database is not bound (503)", () => {
  test.use({ extraHTTPHeaders: { "x-scan-fixture": "disabled" } })

  test("the pages stand, their sections say not available yet", async ({
    page,
  }) => {
    for (const each of [
      { path: "/gauges", heading: "Gauges" },
      { path: `/gauges/${fixtureGauge}`, heading: /Gauge/ },
      { path: "/epochs", heading: "Epochs" },
      { path: "/epochs/47", heading: "Epoch 47" },
      { path: "/locks", heading: "Locks" },
      { path: "/locks/vebtc/604", heading: "veBTC #604" },
    ]) {
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

test.describe("while the aggregates are still filling", () => {
  test.use({ extraHTTPHeaders: { "x-scan-fixture": "filling" } })

  test("an epoch not computed yet shows no figures", async ({ page }) => {
    const response = await page.goto("/epochs/47")
    expect(response?.status()).toBe(200)
    await expect(page.getByText(/^Still filling/).first()).toBeVisible()
    await expect(page.getByText("1,916,000 MEZO")).toHaveCount(0)
  })

  test("lists and gauge history say so", async ({ page }) => {
    await page.goto("/epochs")
    await expect(page.getByText(/^Still filling/).first()).toBeVisible()
    await page.goto(`/gauges/${fixtureGauge}`)
    await expect(page.getByText(/^Still filling/).first()).toBeVisible()
  })
})

test.describe("while the copy step has halted tables", () => {
  test.use({ extraHTTPHeaders: { "x-scan-fixture": "delayed" } })

  test("every page says, quietly, that some data is delayed", async ({
    page,
  }) => {
    for (const path of ["/gauges", "/network/blocks"]) {
      const response = await page.goto(path)
      expect(response?.status(), path).toBe(200)
      await expect(
        page.getByRole("status").filter({ hasText: /^Some data is delayed/ }),
        path,
      ).toBeVisible()
    }
  })
})

test.describe("while the live Borrow snapshot is behind", () => {
  test.use({ extraHTTPHeaders: { "x-scan-fixture": "delayed" } })

  test("pages that show loans say Borrow data is delayed, others do not", async ({
    page,
  }) => {
    // Borrow pages from their own reads, address pages from /status.
    for (const path of ["/borrow", `/address/${wallet}`]) {
      await page.goto(path)
      await expect(page.getByText(/^Borrow data is delayed/), path).toHaveCount(
        1,
      )
    }
    await page.goto("/gauges")
    await expect(page.getByText(/^Borrow data is delayed/)).toHaveCount(0)
  })
})

test("a page whose data is current says nothing about delays", async ({
  page,
}) => {
  await page.goto("/gauges")
  await expect(page.getByText(/^Some data is delayed/)).toHaveCount(0)
})
