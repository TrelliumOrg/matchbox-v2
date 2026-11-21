import { expect, type Page, test } from "@playwright/test"

/**
 * Vote's gauge list: pages in the URL with the pager above the list, the
 * compact view, the whole card as the gauge's link, and the gauge page's
 * "Vote" link coming back to the same place. Fixtures mode serves 30 veBTC
 * gauges (two pages of 24) and mainnet's pools that share a pair.
 */

const userAddress = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"
const user = `/${userAddress}`

function gaugeList(page: Page) {
  return page.locator("[data-gauge-list]")
}

test("pages live in the URL, with the pager above the list", async ({
  page,
}) => {
  await page.goto(`${user}/vote/vebtc`)
  await page.waitForLoadState("networkidle")
  const top = page.getByRole("navigation", { name: "Gauge pages" })
  await expect(top.getByText("1 to 24 of 30")).toBeVisible()
  const listBox = await gaugeList(page).boundingBox()
  const topBox = await top.boundingBox()
  expect(topBox?.y ?? 0).toBeLessThan(listBox?.y ?? 0)

  await top.getByRole("link", { name: "Next page" }).click()
  await expect(page).toHaveURL(/[?&]page=2/)
  await expect(top.getByText("25 to 30 of 30")).toBeVisible()
  await expect(gaugeList(page).locator(":scope > li")).toHaveCount(6)

  // Back and forward walk the pages.
  await page.goBack()
  await expect(page).not.toHaveURL(/page=/)
  await expect(top.getByText("1 to 24 of 30")).toBeVisible()
  await page.goForward()
  await expect(top.getByText("25 to 30 of 30")).toBeVisible()

  // A new sort starts again at page 1.
  await sortTrigger(page).click()
  await page.getByRole("menuitemradio", { name: "APY" }).click()
  await expect(page).toHaveURL(/sort=apy/)
  await expect(page).not.toHaveURL(/page=/)
})

function sortTrigger(page: Page) {
  return page.getByRole("button", { name: /^Sort by/ })
}

/** The gauges' names on the page shown, in order. */
function cardNames(page: Page): Promise<string[]> {
  return gaugeList(page)
    .locator("[data-card-link]")
    .evaluateAll((links) => links.map((link) => link.firstChild?.textContent))
    .then((names) => names.map((name) => name ?? ""))
}

/** A tab's count, from the grey number after its label. */
async function tabCount(page: Page, name: string): Promise<number> {
  const tab = page
    .getByRole("group", { name: "Gauge filter" })
    .getByRole("button", { name: new RegExp(`^${name}`) })
  return Number(((await tab.textContent()) ?? "").replace(/\D/g, ""))
}

test("every sort orders every row, the locks' own gauges too", async ({
  page,
}) => {
  // The demo wallet votes for Kiln Labs ($1,180) and veBTC #604 ($519.42).
  // Those once sat above the sort, so #604 came before Northgate ($802).
  await page.goto(`${user}/vote/vebtc`)
  await page.waitForLoadState("networkidle")
  expect((await cardNames(page)).slice(0, 3)).toEqual([
    "Kiln Labs",
    "Northgate Capital",
    "veBTC #604",
  ])
  // By votes Hearth Capital (6.4M, no incentives) leads, above Kiln Labs.
  await page.goto(`${user}/vote/vebtc?sort=votes`)
  await page.waitForLoadState("networkidle")
  expect((await cardNames(page)).slice(0, 2)).toEqual([
    "Hearth Capital",
    "Kiln Labs",
  ])
  // The pages continue one order: page 2 picks up where page 1 stops.
  const first = await cardNames(page)
  await page.goto(`${user}/vote/vebtc?sort=votes&page=2`)
  await page.waitForLoadState("networkidle")
  const second = await cardNames(page)
  expect(first).toHaveLength(24)
  expect(new Set([...first, ...second]).size).toBe(30)
})

test("a tab's count is the rows it lists, for this gauge type only", async ({
  page,
}) => {
  // Watching a pool gauge, then opening veBTC gauges.
  await page.addInitScript(() => {
    localStorage.setItem(
      "mbx-watching",
      JSON.stringify(["0x21d7f14f42c560edd409b815d2c6e9be1b0f209e"]),
    )
  })
  await page.goto(`${user}/vote/vebtc`)
  await page.waitForLoadState("networkidle")
  // The watch list is read once the page runs: the tab answering a click
  // means it has, and its count is no longer the server's.
  const watchingTab = page
    .getByRole("group", { name: "Gauge filter" })
    .getByRole("button", { name: /^Watching/ })
  await expect(async () => {
    await watchingTab.click()
    await expect(page).toHaveURL(/tab=watching/, { timeout: 1_000 })
  }).toPass()
  await expect(page.getByText("No gauges")).toBeVisible()
  expect(await tabCount(page, "Watching")).toBe(0)
  await page.goto(`${user}/vote/pools?tab=watching`)
  await page.waitForLoadState("networkidle")
  await expect.poll(() => tabCount(page, "Watching")).toBe(1)
  await expect(gaugeList(page).locator(":scope > li")).toHaveCount(1)
})

test("search finds a gauge by its lock id, and the tabs count what it finds", async ({
  page,
}) => {
  await page.goto(`${user}/vote/vebtc?page=2`)
  await page.waitForLoadState("networkidle")
  // The card reads "Northgate Capital #31".
  await page.getByRole("searchbox").fill("#31")
  await expect(page).not.toHaveURL(/page=/)
  await expect.poll(() => cardNames(page)).toEqual(["Northgate Capital"])
  expect(await tabCount(page, "All")).toBe(1)
  expect(await tabCount(page, "Funded")).toBe(1)
  // Search and tab together, and both in the URL.
  await page
    .getByRole("group", { name: "Gauge filter" })
    .getByRole("button", { name: /^Funded/ })
    .click()
  await expect(page).toHaveURL(/tab=funded/)
  await expect(page).toHaveURL(/q=%2331/)
  await expect.poll(() => cardNames(page)).toEqual(["Northgate Capital"])
  await page.reload()
  await page.waitForLoadState("networkidle")
  await expect(page.getByRole("searchbox")).toHaveValue("#31")
  await expect.poll(() => cardNames(page)).toEqual(["Northgate Capital"])
})

test("the sort menu opens on the page's surface and chooses a sort", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" })
  await page.goto(`${user}/vote/vebtc`)
  await page.waitForLoadState("networkidle")
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite")
  await expect(sortTrigger(page)).toHaveText(/Incentives/)
  await sortTrigger(page).click()
  const menu = page.getByRole("menu", { name: "Sort by" })
  await expect(menu).toBeVisible()
  // In the top layer, on the popover surface of the dark theme.
  const surface = await menu.evaluate((element) => {
    const panel = element.parentElement
    if (panel === null) return null
    const probe = document.createElement("div")
    probe.style.background = "var(--pop)"
    panel.appendChild(probe)
    const expected = getComputedStyle(probe).backgroundColor
    probe.remove()
    return {
      open: panel.matches(":popover-open"),
      background: getComputedStyle(panel).backgroundColor,
      expected,
    }
  })
  expect(surface?.open).toBe(true)
  expect(surface?.background).toBe(surface?.expected)
  expect(surface?.background).toBe("rgb(30, 30, 28)")
  await expect(
    page.getByRole("menuitemradio", { name: "Incentives" }),
  ).toHaveAttribute("aria-checked", "true")
  await page.getByRole("menuitemradio", { name: "Votes" }).click()
  await expect(menu).toBeHidden()
  await expect(page).toHaveURL(/sort=votes/)
  await expect(sortTrigger(page)).toHaveText(/Votes/)
  // The default sort leaves the URL.
  await sortTrigger(page).click()
  await page.getByRole("menuitemradio", { name: "Incentives" }).click()
  await expect(page).not.toHaveURL(/sort=/)
})

test("the sort menu works from the keyboard", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard on the desktop viewport")
  await page.goto(`${user}/vote/vebtc`)
  await page.waitForLoadState("networkidle")
  await sortTrigger(page).focus()
  await page.keyboard.press("ArrowDown")
  const menu = page.getByRole("menu", { name: "Sort by" })
  await expect(menu).toBeVisible()
  await expect(
    page.getByRole("menuitemradio", { name: "Incentives" }),
  ).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(page.getByRole("menuitemradio", { name: "APY" })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  await expect(sortTrigger(page)).toBeFocused()
  await expect(page).not.toHaveURL(/sort=/)

  await page.keyboard.press("Enter")
  await expect(menu).toBeVisible()
  await page.keyboard.press("r")
  await expect(
    page.getByRole("menuitemradio", { name: "Room to 5×" }),
  ).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(menu).toBeHidden()
  await expect(page).toHaveURL(/sort=room/)
  await expect(sortTrigger(page)).toBeFocused()
  await expect(sortTrigger(page)).toHaveText(/Room to 5×/)
})

for (const theme of ["paper", "graphite"] as const) {
  test(`the open sort menu in ${theme}`, async ({ page }, testInfo) => {
    await page.emulateMedia({
      colorScheme: theme === "paper" ? "light" : "dark",
    })
    // The narrowest phone the layout is checked at.
    if (testInfo.project.name === "phone") {
      await page.setViewportSize({ width: 390, height: 844 })
    }
    await page.goto(`${user}/vote/vebtc`)
    await page.waitForLoadState("networkidle")
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme)
    await sortTrigger(page).scrollIntoViewIfNeeded()
    await sortTrigger(page).click()
    const menu = page.getByRole("menu", { name: "Sort by" })
    await expect(menu).toBeVisible()
    // Inside the viewport, wherever the trigger wraps to.
    const box = await menu.boundingBox()
    const viewport = page.viewportSize()
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      viewport?.width ?? 0,
    )
    // Let the fade in finish before the picture.
    await page.waitForTimeout(250)
    await page.screenshot({
      path: testInfo.outputPath(`sort-menu-${theme}.png`),
    })
  })
}

test("an out-of-range page shows the last page", async ({ page }) => {
  await page.goto(`${user}/vote/vebtc?page=9`)
  await page.waitForLoadState("networkidle")
  await expect(page).toHaveURL(/[?&]page=2/)
  await expect(
    page
      .getByRole("navigation", { name: "Gauge pages" })
      .getByText("25 to 30 of 30"),
  ).toBeVisible()
})

test("the bottom pager brings the new page's top into view", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "one viewport is enough")
  await page.goto(`${user}/vote/vebtc`)
  await page.waitForLoadState("networkidle")
  const bottom = page.getByRole("navigation", { name: "Pages, end of list" })
  await bottom.scrollIntoViewIfNeeded()
  // The bottom pager's code loads as it comes into view; before that its
  // links are plain links (a full page load, also at the top).
  await page.waitForLoadState("networkidle")
  await bottom.getByRole("link", { name: "Page 2" }).click()
  await expect(page).toHaveURL(/[?&]page=2/)
  const top = page.getByRole("navigation", { name: "Gauge pages" })
  await expect(top).toBeInViewport()
  await expect(gaugeList(page)).toBeFocused()
})

test("compact rows fit at least 12 gauges and the choice is remembered", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "measured on a 13-inch laptop screen")
  await page.setViewportSize({ width: 1440, height: 760 })
  await page.goto(`${user}/vote/vebtc`)
  await page.waitForLoadState("networkidle")
  await page.getByRole("button", { name: "Compact view" }).click()
  await expect(page.locator("html")).toHaveAttribute(
    "data-gauge-view",
    "compact",
  )
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute(
    "data-gauge-view",
    "compact",
  )
  await expect(
    page.getByRole("button", { name: "Compact view" }),
  ).toHaveAttribute("aria-pressed", "true")
  await page
    .getByRole("navigation", { name: "Gauge pages", exact: true })
    .evaluate((element) => element.scrollIntoView({ block: "start" }))
  const visible = await gaugeList(page).evaluate((list) => {
    const rows = [...list.children].map((row) => row.getBoundingClientRect())
    return rows.filter((row) => row.top >= 0 && row.bottom <= innerHeight)
      .length
  })
  expect(visible).toBeGreaterThanOrEqual(12)
})

test("pool gauges name their pool type, and search finds it", async ({
  page,
}) => {
  await page.goto(`${user}/vote/pools`)
  await page.waitForLoadState("networkidle")
  for (const name of [
    "BTC/MUSD Volatile",
    "BTC/MUSD CL200",
    "BTC/MUSD CL2000",
  ]) {
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible()
  }
  await page.getByRole("searchbox").fill("btc/musd cl2000")
  await expect(gaugeList(page).locator(":scope > li")).toHaveCount(1)
  await expect(page).toHaveURL(/q=btc/)
})

test("the whole card opens the gauge, and Vote comes back to the same place", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "one viewport is enough")
  await page.goto(`${user}/vote/vebtc?page=2&sort=votes`)
  await page.waitForLoadState("networkidle")
  const card = gaugeList(page).locator("article").nth(5)
  await card.scrollIntoViewIfNeeded()
  const scrolled = await page.evaluate(() => window.scrollY)
  // The link's own text, without the id it carries for screen readers.
  const name = await card
    .locator("[data-card-link]")
    .evaluate((link) => link.firstChild?.textContent ?? "")
  // Not the name: the card's empty space opens it too.
  const box = await card.boundingBox()
  if (box === null) throw new Error("no card")
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 60)
  await expect(page).toHaveURL(/\/gauges\/0x/)
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name)

  await page.getByRole("link", { name: /^Vote, / }).click()
  await expect(page).toHaveURL(/vote\/vebtc\?/)
  await expect(page).toHaveURL(/page=2/)
  await expect(page).toHaveURL(/sort=votes/)
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(scrolled - 40)
  // Back in history, not a new entry: forward returns to the gauge.
  await page.goForward()
  await expect(page).toHaveURL(/\/gauges\/0x/)
})

test("the ballot check does not open the gauge", async ({ page }) => {
  await page.goto(`${user}/vote/vebtc`)
  await page.waitForLoadState("networkidle")
  const check = page.getByRole("button", { name: /^Add .* to ballot$/ }).first()
  await check.click()
  await expect(page).toHaveURL(/vote\/vebtc/)
  await expect(
    page.getByRole("button", { name: /^Remove .* from ballot$/ }).first(),
  ).toBeVisible()
})

test("a gauge opened directly links back to its type", async ({ page }) => {
  await page.goto(user)
  await page.waitForLoadState("networkidle")
  await page.goto(`/gauges/0x4da4c05483324ea9cfc951510a5e77cc79541159`)
  await page.waitForLoadState("networkidle")
  await page.getByRole("link", { name: /^Vote, / }).click()
  await expect(page).toHaveURL(/\/vote\/vebtc/)
})

test("an empty or unknown tab or sort in the URL shows the whole list", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(String(error)))
  for (const query of ["?tab=", "?tab=bogus", "?sort=", "?sort=bogus&tab="]) {
    await page.goto(`/vote/pools${query}`)
    await expect(gaugeList(page).locator("> li").first()).toBeVisible()
    await expect(page.getByText("Data unavailable")).toHaveCount(0)
  }
  expect(errors).toEqual([])
})
