import { expect, type Locator, type Page, test } from "@playwright/test"

// A wallet's history past its stored document: Activity and Rewards page
// back epoch by epoch (src/data/fixture-history.ts). `long` voted in every
// epoch from Epoch 0 and made a lock the week before it; `pending` has
// older epochs not stored yet.

const long = `/0x5050${"0".repeat(32)}0050`
const pending = `/0x5050${"0".repeat(32)}0051`

function earlier(page: Page): Locator {
  return page.getByRole("button", { name: "Show earlier epochs" })
}

function span(page: Page): Locator {
  return page.locator("main [data-epoch-span]")
}

/** The range line around the span: the live region focus moves to. */
function rangeLine(page: Page): Locator {
  return page.locator("main p:has(> [data-epoch-span])")
}

/**
 * Shows the next page and waits until it is in: the epochs shown change.
 * A click before hydration does nothing, so the first one is retried.
 */
async function showEarlier(page: Page): Promise<void> {
  const before = await span(page).textContent()
  await expect(async () => {
    await earlier(page).click({ timeout: 2_000 })
    await expect(span(page)).not.toHaveText(before ?? "", { timeout: 2_000 })
  }).toPass()
}

/** Shows earlier epochs until there are none. */
async function showAll(page: Page): Promise<void> {
  for (let guard = 0; guard < 20; guard += 1) {
    if ((await earlier(page).count()) === 0) return
    await showEarlier(page)
  }
  throw new Error("Show earlier epochs never ran out")
}

test("Activity pages back to the oldest epoch", async ({ page }) => {
  await page.goto(`${long}/activity`)
  await expect(span(page)).toHaveText(/^Epoch \d+ to \d+$/)
  const first = await span(page).textContent()
  await showAll(page)
  // Every epoch, down to the lock made the week before Epoch 0.
  await expect(span(page)).toHaveText(/^Before Epoch 0 to Epoch \d+$/)
  expect(first?.replace(/^Epoch \d+ to /, "")).toBe(
    (await span(page).textContent())?.replace(/^.* to Epoch /, ""),
  )
  await expect(
    page.getByText("Epoch 0,", { exact: false }).first(),
  ).toBeVisible()
  await expect(earlier(page)).toHaveCount(0)
  await expect(page.getByText(/still being added/)).toHaveCount(0)
  // The button went with the last page: focus is on the range line, which
  // says how many rows arrived.
  await expect(rangeLine(page)).toBeFocused()
  await expect(rangeLine(page)).toContainText(/\d+ rows? added/)
})

test("Activity says when older epochs are not stored yet", async ({ page }) => {
  await page.goto(`${pending}/activity`)
  await expect(span(page)).toHaveText(/^Epoch \d+ to \d+$/)
  await showAll(page)
  // Stored from Epoch 20; its first claim pays Epoch 19, as its row says.
  await expect(span(page)).toHaveText(/^Epoch 19 to \d+$/)
  await expect(
    page.getByText("Epoch 19 and earlier are still being added", {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByText("Check back in a few days", { exact: true }),
  ).toBeVisible()
})

test("a failed older page keeps the list and can be tried again", async ({
  page,
}) => {
  await page.goto(`${long}/activity`)
  await expect(span(page)).toHaveText(/^Epoch \d+ to \d+$/)
  // Past the stored document: the first page of the stored history fails.
  await showEarlier(page)
  let failed = false
  await page.route(
    (url) =>
      /_serverFn/.test(url.pathname) &&
      /h\.\d{10}/.test(decodeURIComponent(url.search)),
    async (route) => {
      if (failed) return route.continue()
      failed = true
      return route.abort()
    },
  )
  const rows = page.locator("main li")
  const before = await rows.count()
  const shown = await span(page).textContent()
  await earlier(page).click()
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible()
  await expect(
    page.getByRole("alert").filter({ hasText: "Not loaded" }),
  ).toBeVisible()
  expect(await rows.count()).toBe(before)
  await expect(span(page)).toHaveText(shown ?? "")
  await page.getByRole("button", { name: "Try again" }).click()
  await expect(span(page)).not.toHaveText(shown ?? "")
  await expect(page.getByRole("alert")).toHaveCount(0)
  expect(await rows.count()).toBeGreaterThan(before)
})

test("Rewards history pages back to the first claim", async ({ page }) => {
  await page.goto(`${long}/rewards`)
  // Earned counts every claim; the list starts with the latest twelve.
  await expect(page.getByText(/Epoch 0 to \d+$/).first()).toBeVisible()
  const history = page.locator("section", {
    has: page.getByRole("heading", { name: "History" }),
  })
  await expect(history.locator("li")).toHaveCount(12)
  await showAll(page)
  await expect(span(page)).toHaveText(/^Epoch 0 to \d+$/)
  const claims = await history.locator("li").count()
  expect(claims).toBeGreaterThanOrEqual(48)
  await expect(earlier(page)).toHaveCount(0)
})
