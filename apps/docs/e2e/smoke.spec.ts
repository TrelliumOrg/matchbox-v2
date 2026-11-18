import { expect, type Page, test } from "@playwright/test"
import { axe, watch } from "./helpers"

/**
 * The docs smoke suite, on desktop 1440 and Pixel 7. Every page test fails
 * on a console error or an uncaught exception, and on any response that
 * came from the Worker (`x-docs-worker`): a page view, a client navigation
 * and a search must all be served by static assets.
 */

const pages = [
  { path: "/", heading: "Learn Matchbox" },
  { path: "/pro/vote", heading: "Vote" },
  { path: "/concepts/epochs", heading: "Epochs" },
  {
    path: "/developer/api/incentives/list-incentives",
    heading: "List incentives for an epoch",
  },
  { path: "/developer/reference", heading: "API reference" },
  { path: "/developer/mcp/tools/rank-gauges", heading: "Rank gauges" },
  { path: "/developer/oidc", heading: "Sign in with Matchbox" },
]

for (const item of pages) {
  test(`${item.path} renders, passes axe and never reaches the Worker`, async ({
    page,
  }) => {
    const seen = watch(page)
    const response = await page.goto(item.path)
    expect(response?.status()).toBe(200)
    expect(response?.headers()["x-docs-worker"]).toBeUndefined()
    await expect(
      page.getByRole("heading", { level: 1, name: item.heading }),
    ).toBeVisible()
    await expect(page.locator("main")).toHaveCount(1)
    await page.waitForLoadState("networkidle")
    expect(await axe(page)).toEqual([])
    expect(seen.errors).toEqual([])
    expect(seen.worker).toEqual([])
  })
}

test("headings never skip a level", async ({ page }) => {
  for (const path of ["/pro/vote", "/concepts/boost", "/developer/errors"]) {
    await page.goto(path)
    const levels = await page
      .locator("main h1, main h2, main h3, main h4")
      .evaluateAll((elements) =>
        elements.map((element) => Number(element.tagName.slice(1))),
      )
    expect(levels[0], path).toBe(1)
    levels.forEach((level, index) => {
      if (index > 0)
        expect(level - (levels[index - 1] ?? 1), path).toBeLessThanOrEqual(1)
    })
  }
})

test("the epoch clock is computed in the browser", async ({ page }) => {
  const seen = watch(page)
  await page.goto("/concepts/epochs")
  await expect(page.getByText(/^Epoch \d+$/)).toBeVisible()
  await expect(page.getByText(/until Epoch \d+/)).toBeVisible()
  expect(seen.errors).toEqual([])
})

test("client navigation loads static chunks only", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "the section navigation is a sheet on phones")
  const seen = watch(page)
  await page.goto("/concepts/epochs")
  await page.waitForLoadState("networkidle")
  await page
    .getByRole("navigation", { name: "Pages in this section" })
    .getByRole("link", { name: "Boost" })
    .click()
  await expect(page).toHaveURL(/\/concepts\/boost$/)
  await expect(
    page.getByRole("heading", { level: 1, name: "Boost" }),
  ).toBeVisible()
  expect(seen.worker).toEqual([])
  expect(seen.errors).toEqual([])
})

test("search finds a page and opens it from the keyboard", async ({
  page,
  isMobile,
}) => {
  const seen = watch(page)
  await page.goto("/concepts/epochs")
  await page.waitForLoadState("networkidle")
  if (isMobile)
    await page
      .getByRole("button", { name: "Ask Stuart or search docs" })
      .first()
      .click()
  else await page.keyboard.press("Control+k")
  const box = page.getByRole("combobox", { name: "Ask Stuart or search docs" })
  await expect(box).toBeFocused()
  await box.fill("optimize")
  await expect(page.getByRole("option").first()).toContainText("Optimize")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/pro\/optimize/)
  await expect(
    page.getByRole("heading", { level: 1, name: "Optimize" }),
  ).toBeVisible()
  expect(seen.errors).toEqual([])
  expect(seen.worker).toEqual([])
})

test("search says when nothing matches", async ({ page }) => {
  await page.goto("/concepts/epochs")
  await page.waitForLoadState("networkidle")
  await page
    .getByRole("button", { name: "Ask Stuart or search docs" })
    .first()
    .click()
  await page.getByRole("combobox").fill("zzqx")
  await expect(page.getByText("No pages for zzqx")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("combobox")).toBeHidden()
})

test("unknown paths get the static not-found page", async ({ page }) => {
  const seen = watch(page)
  const response = await page.goto("/guides/nothing-here")
  expect(response?.status()).toBe(404)
  expect(response?.headers()["x-docs-worker"]).toBeUndefined()
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible()
  await expect(page.getByText("/guides/nothing-here")).toBeVisible()
  // The document itself is a 404, which Chromium logs.
  expect(
    seen.errors.filter((error) => !error.includes("status of 404")),
  ).toEqual([])
})

test("old matchdocs and console URLs redirect to real pages", async ({
  page,
}) => {
  const response = await page.goto("/docs/guides/voting/")
  expect(response?.status()).toBe(200)
  // Marked, so no 301 cached from Classic can catch it (README, cutover).
  await expect(page).toHaveURL(/\/pro\/vote\?from=matchdocs$/)
  await page.goto("/developer/errors#rate_limited")
  await expect(page.locator("tr#rate_limited")).toBeVisible()
})

test("code blocks copy with the keyboard", async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(isMobile, "clipboard permissions are desktop only in this run")
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await page.goto("/developer")
  await page.waitForLoadState("networkidle")
  const copy = page.getByRole("button", { name: "Copy code" }).first()
  await copy.focus()
  await expect(copy).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(
    page.getByRole("status").filter({ hasText: "Copied" }).first(),
  ).toBeAttached()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "@matchbox-dev/sdk",
  )
})

test("the skip link moves focus to the content", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard first")
  await page.goto("/pro/vote")
  await page.keyboard.press("Tab")
  const skip = page.getByRole("link", { name: "Skip to content" })
  await expect(skip).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/#content$/)
})

test("phone sheets open and close", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone layout")
  const seen = watch(page)
  await page.goto("/pro/vote")
  await page.waitForLoadState("networkidle")
  await page.getByRole("button", { name: "Menu" }).click()
  const nav = page.getByRole("dialog", { name: "Navigation" })
  await expect(nav).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(nav).toBeHidden()
  await page.getByRole("button", { name: /On this page/ }).click()
  await expect(page.getByRole("dialog", { name: "On this page" })).toBeVisible()
  expect(seen.errors).toEqual([])
})

test("dark mode follows the system before paint", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" })
  const page = await context.newPage()
  await page.goto("/pro/vote")
  expect(await page.locator("html").getAttribute("data-theme")).toBe("graphite")
  await context.close()
})

/**
 * Every data-theme value <html> carries, from before the parser inserts it.
 * Watches the whole document, since <html> does not exist yet when an init
 * script runs.
 */
async function recordThemes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { themes: string[] }).themes = seen
    new MutationObserver(() => {
      const theme = document.documentElement?.getAttribute("data-theme") ?? null
      if (theme !== null && seen.at(-1) !== theme) seen.push(theme)
    }).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-theme"],
    })
  })
}

test("the shared appearance cookie sets the theme before paint", async ({
  browser,
}) => {
  const context = await browser.newContext({ colorScheme: "light" })
  await context.addCookies([
    {
      name: "mbx-appearance",
      value: "dark.linen.walnut",
      domain: "localhost",
      path: "/",
    },
  ])
  const page = await context.newPage()
  await recordThemes(page)
  const seen = watch(page)
  await page.goto("/pro/vote")
  await page.waitForLoadState("networkidle")
  // Set once by the inline script, never changed after: no flash.
  expect(
    await page.evaluate(
      () => (window as unknown as { themes: string[] }).themes,
    ),
  ).toEqual(["walnut"])
  expect(seen.errors).toEqual([])
  await context.close()
})

test("an invalid appearance cookie is ignored", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "light" })
  await context.addCookies([
    {
      name: "mbx-appearance",
      value: "dark.neon.walnut",
      domain: "localhost",
      path: "/",
    },
  ])
  const page = await context.newPage()
  await recordThemes(page)
  await page.goto("/pro/vote")
  await page.waitForLoadState("networkidle")
  expect(
    await page.evaluate(
      () => (window as unknown as { themes: string[] }).themes,
    ),
  ).toEqual(["paper"])
  await context.close()
})

/**
 * "Ask about this page": in the page header from tablet up, in the bottom
 * page bar on phones. Whichever is on screen.
 */
function askButton(page: Page) {
  return page
    .getByRole("button", { name: "Ask about this page" })
    .filter({ visible: true })
    .first()
}

/** Stuart's origin in this build's page CSP, or null when built without it. */
async function stuartOriginOf(page: Page): Promise<string | null> {
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content")
  const connect = (csp ?? "")
    .split(";")
    .map((directive) => directive.trim().split(" "))
    .find((parts) => parts[0] === "connect-src")
  return connect?.[2] ?? null
}

test("Ask about this page answers from Stuart's notes, this page first", async ({
  page,
}) => {
  const seen = watch(page)
  await page.goto("/concepts/rewards")
  await page.waitForLoadState("networkidle")
  const origin = await stuartOriginOf(page)
  test.skip(origin === null, "built without VITE_STUART_URL")
  const sent: unknown[] = []
  await page.route(`${origin}/docs/ask`, async (route) => {
    if (route.request().method() === "POST") {
      sent.push(route.request().postDataJSON())
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "access-control-allow-origin": "http://localhost:4183",
        "access-control-allow-headers": "content-type",
      },
      body: JSON.stringify({
        version: "test",
        notes: [
          {
            id: "rewards.claim",
            title: "Claiming rewards",
            answer: "Rewards are claimable from Thursday 00:00 UTC.",
            detail: [],
            sources: [
              {
                label: "Matchbox Docs, Rewards",
                url: "https://docs.matchbox.markets/concepts/rewards",
              },
            ],
            onPage: true,
          },
        ],
      }),
    })
  })
  await askButton(page).click()
  const panel = page.getByRole("dialog", { name: "Ask about this page" })
  const box = panel.getByLabel("Your question")
  await expect(box).toBeFocused()
  await box.fill("when can i claim")
  await page.keyboard.press("Enter")
  await expect(panel.getByText("Claiming rewards")).toBeVisible()
  await expect(panel.getByText("This page", { exact: true })).toBeVisible()
  expect(sent).toEqual([
    { question: "when can i claim", page: "/concepts/rewards" },
  ])
  expect(await axe(page)).toEqual([])
  expect(seen.errors).toEqual([])
})

test("Ask about this page falls back to search when Stuart is unavailable", async ({
  page,
}) => {
  await page.goto("/concepts/rewards")
  await page.waitForLoadState("networkidle")
  const origin = await stuartOriginOf(page)
  await askButton(page).click()
  const search = page.getByRole("combobox", {
    name: "Ask Stuart or search docs",
  })
  if (origin === null) {
    // No Stuart in this build: the button is search, seeded with the page.
    await expect(search).toHaveValue("Rewards")
    return
  }
  await page.route(`${origin}/docs/ask`, (route) =>
    route.abort("connectionrefused"),
  )
  const panel = page.getByRole("dialog", { name: "Ask about this page" })
  await panel.getByLabel("Your question").fill("when can i claim")
  await page.keyboard.press("Enter")
  await expect(search).toBeVisible()
  await expect(search).toHaveValue("when can i claim")
  await expect(panel).toBeHidden()
})

test("every lazily rendered page type is whole without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  const pages = [
    // An operation, a tool, the reference index and the epoch clock: each
    // renders from its own chunk.
    ["/developer/api/gauge-profiles/get-gauge-profile", "Response"],
    ["/developer/mcp/tools/explain-gauge", "explain_gauge"],
    ["/developer/reference", "Gauge profiles"],
    ["/concepts/epochs", "Epoch"],
  ] as const
  for (const [path, text] of pages) {
    await page.goto(path)
    const article = page.locator("main#content")
    await expect(article, path).toBeVisible()
    // The 834 section pill also names the page, hidden at this width.
    await expect(
      article.getByText(text).filter({ visible: true }).first(),
      path,
    ).toBeVisible()
    expect(await page.locator('div[hidden][id^="S:"]').count(), path).toBe(0)
  }
  await context.close()
})

test("the live epoch clock fills in without moving anything", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const shifts: number[] = []
    ;(window as unknown as { shifts: number[] }).shifts = shifts
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        shifts.push((entry as unknown as { value: number }).value)
      }
    }).observe({ type: "layout-shift", buffered: true })
  })
  await page.goto("/concepts/epochs")
  await page.waitForLoadState("networkidle")
  // The clock fills in after hydration: wait until it shows the epoch.
  await expect(page.getByText(/^Epoch \d+$/).first()).toBeVisible()
  await page.waitForTimeout(300)
  const shifts = await page.evaluate(
    () => (window as unknown as { shifts: number[] }).shifts,
  )
  expect(shifts).toEqual([])
})
