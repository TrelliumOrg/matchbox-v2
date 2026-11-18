import { expect, type Page, test } from "@playwright/test"

/** The demo wallet (it has a Mezo ID, pyke.mezo) and an empty wallet. */
const userAddress = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"
const user = `/${userAddress}`
const empty = "/0x3f90c2d4e6f8a0b1c3d5e7f9a1b3c5d7e9f0a17c"

/** Fails the test on any console error or uncaught exception. */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

const routes = [
  { name: "Overview signed out", path: "/", text: "Incentives this epoch" },
  { name: "Overview", path: user, text: "Claimable" },
  { name: "Overview, no locks", path: empty, text: "New lock" },
  { name: "Vote", path: `${user}/vote`, text: "Kiln Labs" },
  {
    name: "Vote, no voting power",
    path: `${empty}/vote`,
    text: "No veMEZO lock",
  },
  {
    name: "Rewards",
    path: `${user}/rewards`,
    text: "Ready to claim, Epoch 46",
  },
  {
    name: "Rewards, nothing to claim",
    path: `${empty}/rewards`,
    text: "Nothing to claim",
  },
  {
    name: "Activity",
    path: `${user}/activity`,
    text: "Incentive to Sats Collective",
  },
  { name: "Activity, none", path: `${empty}/activity`, text: "No activity" },
  { name: "Protocol", path: "/protocol", text: "Incentives this epoch" },
  {
    name: "Gauge profile",
    path: "/gauges/0x4da4c05483324ea9cfc951510a5e77cc79541159",
    text: "Validator ops on Mezo since genesis",
  },
]

for (const route of routes) {
  test(`${route.name} renders without console errors`, async ({ page }) => {
    const errors = watchErrors(page)
    const response = await page.goto(route.path)
    expect(response?.status()).toBe(200)
    await expect(page.getByText(route.text).first()).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect(errors).toEqual([])
  })
}

test("old ?address= links redirect to clean wallet paths", async ({ page }) => {
  const response = await page.request.get(`/vote?address=${userAddress}`, {
    maxRedirects: 0,
  })
  expect(response.status()).toBe(301)
  expect(response.headers().location).toBe(`/${userAddress}/vote`)
  await page.goto(`${user}/vote?tab=funded`)
  await expect(page).toHaveURL(`/${userAddress}/vote?tab=funded`)
})

test("a wallet with a Mezo ID loads by address on every page", async ({
  page,
}) => {
  for (const path of ["", "/vote", "/rewards", "/activity"]) {
    const response = await page.request.get(`${user}${path}`, {
      maxRedirects: 0,
    })
    expect(response.status(), path).toBe(200)
  }
})

test("unknown gauges and pages are not found", async ({ page }) => {
  const response = await page.goto(`/gauges/0x${"0".repeat(40)}`)
  expect(response?.status()).toBe(404)
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible()
})

test("the address carries across navigation", async ({ page, isMobile }) => {
  const errors = watchErrors(page)
  await page.goto(user)
  await page.waitForLoadState("networkidle")
  const nav = page
    .getByRole("navigation", { name: "Pro" })
    .filter({ visible: true })
  await nav.getByRole("link", { name: "Rewards" }).click()
  await expect(page).toHaveURL(new RegExp(`/${userAddress}/rewards$`))
  await expect(page.getByText("Ready to claim, Epoch 46")).toBeVisible()
  if (!isMobile) {
    await nav.getByRole("link", { name: "Protocol" }).click()
    await expect(page.getByText("Funded this epoch")).toBeVisible()
  }
  expect(errors).toEqual([])
})

test("Vote shows each type, and a voted lock saves for the next epoch", async ({
  page,
  isMobile,
}) => {
  const errors = watchErrors(page)
  await page.goto(`${user}/vote`)
  await page.waitForLoadState("networkidle")
  // The demo veMEZO lock voted this epoch: still picked, its votes loaded,
  // and the ballot saves for Epoch 48 instead of signing.
  const lock = page.getByRole("checkbox", { name: /#2207/ })
  await expect(lock).toBeEnabled()
  await expect(lock).toBeChecked()
  await expect(page.getByText("Voted this epoch").first()).toBeVisible()
  await expect(
    page
      .getByRole("button", { name: "Save for Epoch 48" })
      .filter({ visible: true })
      .first(),
  ).toBeVisible()
  const types = page.getByRole("navigation", { name: "Gauge types" })
  await types
    .getByRole("link", { name: /Validator gauges/ })
    .filter({ visible: true })
    .first()
    .click()
  await expect(page).toHaveURL(new RegExp(`/${userAddress}/vote/validators$`))
  await expect(page.getByRole("checkbox", { name: /#4120/ })).toBeVisible()
  if (!isMobile) {
    await page.getByRole("button", { name: /^Funded/ }).click()
    await expect(page).toHaveURL(/tab=funded/)
  }
  expect(errors).toEqual([])
})

test("Optimize can be undone from the ballot bar", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "the phone's bar has no Optimize button")
  const errors = watchErrors(page)
  await page.goto(`${user}/vote`)
  await page.waitForLoadState("networkidle")
  // At 1440 the ballot is the bar; the rail takes over from 1600.
  const bar = page.getByRole("region", { name: /^Epoch \d+ ballot/ })
  const mark = bar.getByRole("img")
  const before = await mark.getAttribute("aria-label")
  await bar.getByRole("button", { name: /^Optimize \+\$/ }).click()
  const undo = bar.getByRole("button", { name: /^Undo \+\$/ })
  await expect(undo).toBeVisible()
  await expect(mark).not.toHaveAttribute("aria-label", before ?? "")
  await undo.click()
  await expect(mark).toHaveAttribute("aria-label", before ?? "")
  await expect(
    bar.getByRole("button", { name: /^Optimize \+\$/ }),
  ).toBeVisible()
  expect(errors).toEqual([])
})

test("Protocol's live activity loads more and filters by event", async ({
  page,
}) => {
  const errors = watchErrors(page)
  await page.goto("/protocol")
  await page.waitForLoadState("networkidle")
  const feed = page.locator("section", {
    has: page.getByRole("heading", { name: "Live activity" }),
  })
  await feed.scrollIntoViewIfNeeded()
  const rows = feed.locator("tbody tr")
  const painted = await rows.count()
  expect(painted).toBeGreaterThan(0)
  await feed.getByRole("button", { name: "Load more" }).click()
  await expect.poll(() => rows.count()).toBeGreaterThan(painted)
  // Votes only: the rows loaded so far that are votes, then more of them.
  await feed.getByLabel("Events").selectOption("votes")
  await expect(rows.first()).toBeVisible()
  for (const label of await rows
    .locator("td:first-child .font-semibold")
    .allTextContents()) {
    expect(["Voted", "Boosted"]).toContain(label)
  }
  const votes = await rows.count()
  await feed.getByRole("button", { name: "Load more" }).click()
  await expect.poll(() => rows.count()).toBeGreaterThan(votes)
  await expect(feed.getByRole("button", { name: "Load more" })).toHaveCount(0)
  expect(errors).toEqual([])
})

test("Vote does not move while it hydrates", async ({ page }) => {
  // A section that hydrates late and is handed new props before it does is
  // emptied for a frame. The lock picker did that on 13 Nov 2026: the list
  // jumped 144px up and back (layout shift 0.098 on a phone). On desktop
  // the bar's Optimize button used to widen when its gain arrived.
  await page.addInitScript(() => {
    const shifts: number[] = []
    Object.assign(window, { layoutShifts: shifts })
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        shifts.push(Reflect.get(entry, "value"))
      }
    }).observe({ type: "layout-shift", buffered: true })
  })
  await page.goto(`${user}/vote`)
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1_500)
  const shifts: number[] = await page.evaluate(() =>
    Reflect.get(window, "layoutShifts"),
  )
  expect(shifts.reduce((sum, value) => sum + value, 0)).toBe(0)
})

test("a gauge profile lists the facts of its kind", async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto("/gauges/0x4da4c05483324ea9cfc951510a5e77cc79541159")
  await page.waitForLoadState("networkidle")
  const facts = page.locator("[data-gauge-facts]")
  await facts.scrollIntoViewIfNeeded()
  await expect(facts.getByRole("heading", { name: "Details" })).toBeVisible()
  // Kiln Labs is a veBTC gauge: its lock, its boost and what 5× takes.
  await expect(facts.getByText("veBTC #7", { exact: true })).toBeVisible()
  await expect(facts.getByText("Votes for 5×")).toBeVisible()
  await expect(facts.getByText("Auto max")).toBeVisible()
  expect(errors).toEqual([])
})

test("a lock card's vote line opens the gauges behind it", async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto(user)
  await page.waitForLoadState("networkidle")
  // A tap on a phone, focus on a keyboard: both open the list. A `title`
  // did neither on a phone.
  const line = page
    .locator("[data-vote-line]")
    .filter({ visible: true })
    .first()
  await line.scrollIntoViewIfNeeded()
  await line.focus()
  const tip = page.getByRole("tooltip").filter({ hasText: "%" })
  await expect(tip).toBeVisible()
  await expect(tip).toContainText(/\d+%/)
  expect(errors).toEqual([])
})

test("a gauge's type icon is big enough to tap on a phone", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "the hit area is for fingers")
  await page.goto(`${user}/vote`)
  await page.waitForLoadState("networkidle")
  const icon = page
    .locator('[data-vote] article [role="img"][tabindex="0"]')
    .first()
  // Mid-screen, clear of the ballot bar fixed at the bottom.
  await icon.evaluate((element) => element.scrollIntoView({ block: "center" }))
  const box = await icon.boundingBox()
  if (box === null) throw new Error("no type icon")
  // The icon itself stays small.
  expect(box.width).toBeLessThanOrEqual(20)
  const area = await icon.evaluate((element) => {
    const style = getComputedStyle(element, "::after")
    return [Number.parseFloat(style.width), Number.parseFloat(style.height)]
  })
  expect(area[0]).toBeGreaterThanOrEqual(44)
  expect(area[1]).toBeGreaterThanOrEqual(44)
  // A tap 16px to the side of the icon's centre still opens its tooltip.
  await page.touchscreen.tap(box.x + box.width / 2 + 16, box.y + box.height / 2)
  await expect(page.getByRole("tooltip").first()).toBeVisible()
})

// A gauge with a profile picture takes a different path from one with
// initials. On 13 Nov 2026 every first load of such a profile failed to
// hydrate on the live site and lost everything below its header; no fixture
// gauge had a picture, so nothing here saw it. Two fixture gauges have one
// now (see fixture-gauges), and this loads each profile the hard way.
// The veBTC one is on the list's last page, so its picture stays out of
// Vote's first page, which the budget measures.
for (const list of ["vote?page=2", "vote/validators"]) {
  test(`a gauge profile with a picture hydrates on a first load (${list})`, async ({
    page,
  }) => {
    await page.goto(`${user}/${list}`)
    await page.waitForLoadState("networkidle")
    const href = await page
      .locator("[data-vote] article", {
        has: page.locator('img[src^="data:image/gif"]'),
      })
      .first()
      .locator('a[href*="/gauges/"]')
      .first()
      .getAttribute("href")
    if (href === null) throw new Error("no fixture gauge with a picture")

    // A first load, not a click from the list: only this hydrates.
    const errors = watchErrors(page)
    await page.goto(href)
    await page.waitForLoadState("networkidle")
    await expect(
      page.locator('main img[src^="data:image/gif"]').first(),
    ).toBeVisible()
    const below = page.locator('[data-island="gauge-details"]')
    await below.scrollIntoViewIfNeeded()
    for (const heading of ["About", "Strategy", "Votes"]) {
      await expect(
        below.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible()
    }
    expect(errors).toEqual([])
  })
}

test("a veBTC gauge's Boost opens the calculator on its figures", async ({
  page,
}) => {
  const errors = watchErrors(page)
  await page.goto("/gauges/0x4da4c05483324ea9cfc951510a5e77cc79541159")
  await page.waitForLoadState("networkidle")
  await page.locator("[data-gauge-calculate]").click()
  await expect(page).toHaveURL(/calc=1/)
  await expect(page).toHaveURL(/vebtc=3\.1047/)
  await expect(page).toHaveURL(/vemezo=5880000/)
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByText("Boost calculator")).toBeVisible()
  // Kiln Labs: 3.1047 veBTC and 5.88M veMEZO, the boost its profile shows.
  await expect(sheet.locator("input").first()).toHaveValue(/3\.1047/)
  await page.goBack()
  await expect(page).not.toHaveURL(/calc=1/)
  expect(errors).toEqual([])
})

test("Calculate keeps a real, eighteen-decimal weight short", async ({
  page,
}) => {
  // The fixture gauge with a picture also has a weight as the chain gives
  // it: 0.167908630464777048.
  await page.goto(`${user}/vote?page=2`)
  await page.waitForLoadState("networkidle")
  const href = await page
    .locator("[data-vote] article", {
      has: page.locator('img[src^="data:image/gif"]'),
    })
    .first()
    .locator('a[href*="/gauges/"]')
    .first()
    .getAttribute("href")
  if (href === null) throw new Error("no fixture gauge with a picture")
  await page.goto(href)
  await page.waitForLoadState("networkidle")
  await page.locator("[data-gauge-calculate]").click()
  await expect(page).toHaveURL(/[?&]vebtc=0\.167908(&|$)/)
  await expect(page.getByRole("dialog").locator("input").first()).toHaveValue(
    "0.167908",
  )
})

test("the block ticker follows new blocks", async ({ page, isMobile }) => {
  test.skip(isMobile, "phones show the block in the price popover")
  await page.goto("/")
  const ticker = page.getByRole("link", { name: /Latest block/ })
  const first = await ticker.getAttribute("aria-label")
  await expect
    .poll(async () => ticker.getAttribute("aria-label"), { timeout: 12_000 })
    .not.toBe(first)
})

test("the Account panel opens Appearance and switches the theme", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "one viewport is enough")
  await page.goto(user)
  await page.waitForLoadState("networkidle")
  await page.getByRole("button", { name: /^Account/ }).click()
  await page.getByRole("button", { name: /^Appearance/ }).click()
  await page.getByRole("radio", { name: "Dark" }).click()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite")
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite")
})

test("the Account panel lists tokens beyond BTC, MEZO and MUSD", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "one viewport is enough")
  await page.goto(user)
  await page.waitForLoadState("networkidle")
  await page.getByRole("button", { name: /^Account/ }).click()
  const panel = page.getByRole("dialog")
  await expect(panel.getByText("Savings MUSD")).toBeVisible()
  await expect(panel.getByText("620.00 sMUSD")).toBeVisible()
  await expect(panel.getByText("$634.88")).toBeVisible()
  await expect(panel.getByText("Mezo USDC")).toBeVisible()
})

test("search lists Pro's pages and the wallet's locks", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "phones search from the sheet; the rows are the same")
  const errors = watchErrors(page)
  // Another wallet's Vote page: nobody is connected in this suite.
  await page.goto(`${user}/vote`)
  await page.waitForLoadState("networkidle")
  const box = page.getByRole("combobox", { name: /Ask Stuart or search/ })
  await box.click()
  await box.fill("2207")
  const results = page.getByRole("listbox", { name: "Search results" })
  await expect(results.getByText("Locks", { exact: true })).toBeVisible()
  // The lock opens on the wallet it belongs to, the one being viewed.
  await results.getByRole("option", { name: /veMEZO #2207/ }).click()
  await expect(page).toHaveURL(new RegExp(`/${userAddress}$`))
  await expect(page.getByText("veMEZO #2207").first()).toBeVisible()
  await box.click()
  await box.fill("proto")
  await expect(results.getByText("Pages", { exact: true })).toBeVisible()
  await results.getByRole("option", { name: /^Protocol/ }).click()
  await expect(page).toHaveURL(/\/protocol$/)
  expect(errors).toEqual([])
})

test("a token breakdown popover is never covered by the rows below it", async ({
  page,
}) => {
  await page.goto(`${user}/activity`)
  await page.waitForLoadState("networkidle")
  const trigger = page.locator("main button[aria-expanded]").first()
  await trigger.hover()
  const popover = page.locator("[popover]:popover-open")
  await expect(popover).toBeVisible()
  const covered = await popover.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    )
    return hit !== null && !element.contains(hit)
  })
  expect(covered).toBe(false)
})

/** Protocol's epoch bars; the pressed one is the selected epoch. */
function epochBars(page: Page) {
  return page.locator("fieldset button[aria-pressed]")
}

/** Waits until `epoch` is selected: in the URL and as the pressed bar. */
async function expectEpoch(page: Page, epoch: number, latest: number) {
  await expect(page).toHaveURL(
    epoch === latest ? /\/protocol$/ : new RegExp(`/protocol/${epoch}$`),
  )
  await expect(
    page.getByRole("button", { name: `Epoch ${epoch}`, exact: true }),
  ).toHaveAttribute("aria-pressed", "true")
}

async function latestEpoch(page: Page): Promise<number> {
  const bars = epochBars(page)
  // Hydrated: the current epoch's bar is pressed.
  await expect(bars.last()).toHaveAttribute("aria-pressed", "true")
  return Number(
    (await bars.last().getAttribute("aria-label"))?.replace("Epoch ", ""),
  )
}

test("picks Protocol epochs from bars, numbers and arrow keys", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "phones page by 6, covered below")
  await page.goto("/protocol")
  const bars = epochBars(page)
  const latest = await latestEpoch(page)
  const count = await bars.count()
  await expect(
    page.getByText(`Epoch ${latest - count + 1} to ${latest}`, { exact: true }),
  ).toBeVisible()

  // A click before hydration does nothing; retry until the URL follows.
  await expect(async () => {
    await bars.nth(count - 3).click()
    await expect(page).toHaveURL(new RegExp(`/protocol/${latest - 2}$`), {
      timeout: 1_000,
    })
  }).toPass()
  await expectEpoch(page, latest - 2, latest)

  await page
    .locator('[aria-hidden="true"] > button', {
      hasText: new RegExp(`^${latest - 4}$`),
    })
    .click()
  await expectEpoch(page, latest - 4, latest)

  await page
    .getByRole("button", { name: `Epoch ${latest - 4}`, exact: true })
    .focus()
  await page.keyboard.press("ArrowRight")
  await expectEpoch(page, latest - 3, latest)

  const next = page.getByRole("button", { name: "Next epoch" })
  for (const epoch of [latest - 2, latest - 1, latest]) {
    await next.click()
    await expectEpoch(page, epoch, latest)
  }

  const old = await page.goto(`/protocol?epoch=${latest - 1}`)
  expect(old?.status()).toBe(200)
  await expectEpoch(page, latest - 1, latest)
})

test("pages Protocol epochs by 6 on phones", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the wide layout shows 12 a page")
  await page.goto("/protocol")
  const bars = epochBars(page)
  const latest = await latestEpoch(page)
  await expect(bars).toHaveCount(6)
  const latestPage = page.getByText(`Epoch ${latest - 5} to ${latest}`, {
    exact: true,
  })
  await expect(latestPage).toBeVisible()

  // The page moves; the selection (the URL) stays.
  const earlier = page.getByRole("button", { name: "Earlier epochs" })
  await expect(async () => {
    await earlier.click()
    await expect(latestPage).toBeHidden({ timeout: 1_000 })
  }).toPass()
  await expect(bars.first()).toHaveAttribute("aria-label", /^Epoch \d+$/)
  await expect(page).toHaveURL(/\/protocol$/)
  await page.getByRole("button", { name: "Later epochs" }).click()
  await expect(latestPage).toBeVisible()

  // A swipe right shows earlier epochs too.
  const chart = page.locator("fieldset").locator("..").locator("..")
  await chart.dispatchEvent("pointerdown", {
    pointerType: "touch",
    clientX: 100,
  })
  await chart.dispatchEvent("pointerup", { pointerType: "touch", clientX: 260 })
  await expect(latestPage).toBeHidden()

  // An earlier selection opens on its own page.
  await page.goto(`/protocol/${latest - 7}`)
  await expect(
    page.getByRole("button", { name: `Epoch ${latest - 7}`, exact: true }),
  ).toHaveAttribute("aria-pressed", "true")
})

test("a wallet with no locks sees what it could lock", async ({ page }) => {
  await page.goto(empty)
  await expect(page.getByText("Available to lock")).toBeVisible()
  await expect(page.getByText("Claimable")).toHaveCount(0)
  await expect(page.getByRole("button", { name: /BTC/ }).first()).toBeVisible()
  await expect(page.getByRole("button", { name: /MEZO/ }).first()).toBeVisible()
})

test("the signed-out Overview counts every gauge and lists funded ones", async ({
  page,
}) => {
  await page.goto("/")
  // The demo directory has 8 gauges; the summary, not a page of it, counts.
  await expect(page.getByText(/of 8 gauges funded/)).toBeVisible()
  await expect(page.getByRole("link", { name: "See all 8" })).toBeVisible()
  await expect(page.getByText("No incentives")).toHaveCount(0)
})
