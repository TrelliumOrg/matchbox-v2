import { expect, test } from "@playwright/test"
import { benchRoutes } from "../scripts/routes.mjs"
import { axe, watch } from "./helpers"

/**
 * Every page hard-loaded on desktop 1440 and Pixel 7 (a click-through never
 * tests hydration): a 200 from the static assets, its heading, axe, no
 * console error or uncaught exception after hydration, no horizontal page
 * scroll, and no response from the Worker. The data is the real run
 * (matchbench2-final): 15 entries, three runs each.
 */

const headings: Record<string, string> = {
  "/": "Which model answers Mezo questions best?",
  "/questions": "Questions",
  "/method": "Method",
  "/runs": "Runs",
}

for (const path of benchRoutes) {
  test(`${path} hard-loads, hydrates cleanly and passes axe`, async ({
    page,
  }) => {
    const seen = watch(page)
    const response = await page.goto(path)
    expect(response?.status()).toBe(200)
    expect(response?.headers()["x-bench-worker"]).toBeUndefined()
    await expect(
      page.getByRole("heading", { level: 1, name: headings[path] ?? path }),
    ).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0)
    expect(await axe(page)).toEqual([])
    expect(seen.errors).toEqual([])
    expect(seen.worker).toEqual([])
  })
}

test("the real run has no sample notice and is open to search", async ({
  page,
}) => {
  for (const path of benchRoutes) {
    const response = await page.goto(path)
    expect(response?.headers()["x-robots-tag"]).toBeUndefined()
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0)
    await expect(page.getByText("Sample figures.")).toHaveCount(0)
  }
})

test("the page leads with what this run shows", async ({ page }) => {
  await page.goto("/")
  const block = page.getByRole("region", { name: "What this run shows" })
  await expect(block).toBeVisible()
  await expect(block.locator("[data-finding]")).toHaveCount(4)
  await expect(block.locator('[data-finding="leaders"]')).toContainText(
    "Inside Stuart, Sonnet 5.5 at max effort leads with 74.4%.",
  )
  await expect(block.locator('[data-finding="leaders"]')).toContainText(
    "five entries are level at the top",
  )
})

test("the leaderboard lists every entry and marks Stuart's", async ({
  page,
}) => {
  await page.goto("/")
  const rows = page.locator("table.bench-board tbody tr")
  await expect(rows).toHaveCount(15)
  await expect(rows.filter({ hasText: "Runs Stuart today" })).toHaveCount(1)
  // The track's range is stated: every run of every entry lies in it.
  await expect(
    page.getByText(/The track runs from 40% to 80%, not from zero\./),
  ).toBeVisible()
})

test("the controls filter models and effort levels", async ({ page }) => {
  const seen = watch(page)
  await page.goto("/")
  await page.waitForLoadState("networkidle")
  const rows = page.locator("table.bench-board tbody tr")
  const grid = page.getByRole("region", { name: "Score by kind of question" })
  await expect(grid.locator("tbody tr")).toHaveCount(3)

  await page.getByRole("button", { name: "Opus 5.5" }).click()
  await expect(rows).toHaveCount(10)
  await expect(grid.locator("tbody tr")).toHaveCount(2)

  await page.getByText("All", { exact: true }).click()
  await expect(grid.locator("tbody tr")).toHaveCount(10)

  await page.getByRole("button", { name: "Opus 5.5" }).click()
  await expect(rows).toHaveCount(15)
  await expect(grid.locator("tbody tr")).toHaveCount(15)
  expect(seen.errors).toEqual([])
})

test("the leaderboard ranks by any of the three scores", async ({ page }) => {
  const seen = watch(page)
  await page.goto("/")
  await page.waitForLoadState("networkidle")
  const first = page.locator("table.bench-board tbody tr").first()
  const picker = page.getByRole("radiogroup", { name: "Rank by" })
  await expect(first).toHaveAttribute("data-entry", "sonnet-5-5.max")
  await picker.getByText("Within 20 s", { exact: true }).click()
  await expect(first).toHaveAttribute("data-entry", "opus-5-5.low")
  // The header row stays in the accessibility tree on phones too.
  await expect(
    page.getByRole("columnheader", { name: "Within 20 s", exact: true }),
  ).toHaveAttribute("aria-sort", "descending")
  await picker.getByText("Ignoring length", { exact: true }).click()
  await expect(first).toHaveAttribute("data-entry", "sonnet-5-5.max")
  await expect(page.getByText(/^Ignoring length\. Shading runs/)).toBeVisible()
  await picker.getByText("Inside Stuart", { exact: true }).click()
  await expect(first).toHaveAttribute("data-entry", "sonnet-5-5.max")
  expect(seen.errors).toEqual([])
})

test("the leaderboard stays a table on every screen", async ({ page }) => {
  await page.goto("/")
  await page.waitForLoadState("networkidle")
  const table = page.getByRole("table", { name: /Leaderboard/ })
  // The header row and the 15 entries, each with its nine cells named.
  await expect(table.getByRole("row")).toHaveCount(16)
  await expect(table.getByRole("columnheader")).toHaveCount(9)
  const row = table.getByRole("row").nth(1)
  await expect(row.getByRole("cell")).toHaveCount(9)
})

test("the question stepper moves through the published questions", async ({
  page,
}) => {
  await page.goto("/")
  await page.waitForLoadState("networkidle")
  const card = page.getByRole("article", { name: "Published question" })
  const first = await card.locator("p").first().textContent()
  await page.getByRole("button", { name: "Next question" }).click()
  await expect(card.locator("p").first()).not.toHaveText(first ?? "")
  await page.getByRole("button", { name: "Previous" }).click()
  await expect(card.locator("p").first()).toHaveText(first ?? "")
  await expect(card.locator(".bench-answer").first()).toBeVisible()
  // Each answer leads with its sentence, and the card's rows wait folded.
  const folded = card.locator("details").first()
  await expect(folded).not.toHaveAttribute("open", "")
  await folded.getByText("What the card showed").click()
  await expect(folded).toHaveAttribute("open", "")
  await expect(folded.locator("p").first()).toBeVisible()
})

test("the published answers load only when a reader asks", async ({ page }) => {
  // The answers are most of the results file: no page loads them on first
  // paint, and opening a question loads them once for every question.
  const seen = watch(page)
  const answers: string[] = []
  page.on("response", async (response) => {
    if (!response.url().includes("/assets/")) return
    const body = await response.body().catch(() => Buffer.from(""))
    // Only the answers module holds the file's keys quoted, as JSON.
    if (body.includes('"modelText":')) answers.push(response.url())
  })
  await page.goto("/questions")
  await page.waitForLoadState("networkidle")
  expect(answers).toEqual([])
  const first = page.locator("main ol > li").first()
  await expect(first.locator(".bench-answer")).toHaveCount(0)
  await first.getByText(/Show the \d+ answers/).click()
  await expect(first.locator(".bench-answer").first()).toBeVisible()
  await expect(first.getByText("Loading the answers")).toHaveCount(0)
  expect(answers).toHaveLength(1)
  const second = page.locator("main ol > li").nth(1)
  await second.getByText(/Show the \d+ answers/).click()
  await expect(second.locator(".bench-answer").first()).toBeVisible()
  expect(answers).toHaveLength(1)
  expect(seen.errors).toEqual([])
})

test("each chart is one tab stop, and the arrow keys move", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "keyboard order is checked on desktop")
  await page.goto("/")
  await page.waitForLoadState("networkidle")
  const chart = page.locator("figure").first()
  await expect(chart.locator("[data-point][tabindex='0']")).toHaveCount(1)
  await expect(chart.locator("[data-point][tabindex='-1']")).toHaveCount(14)
  const start = chart.locator("[data-point][tabindex='0']")
  await start.focus()
  const before = await start.getAttribute("data-point")
  await page.keyboard.press("ArrowRight")
  const focused = page.locator("[data-point]:focus")
  await expect(focused).toHaveCount(1)
  expect(await focused.getAttribute("data-point")).not.toBe(before)
  await expect(chart.locator("[data-point][tabindex='0']")).toHaveCount(1)
  await page.keyboard.press("Home")
  expect(
    await page.locator("[data-point]:focus").getAttribute("data-point"),
  ).toBe(before)
})

test("pages describe themselves for search and link previews", async ({
  page,
  request,
}) => {
  await page.goto("/runs")
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://bench.matchbox.markets/runs",
  )
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    "https://bench.matchbox.markets/runs",
  )
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Runs, Matchbench",
  )
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://bench.matchbox.markets/og.png",
  )
  await expect(page.locator('meta[property="og:description"]')).toHaveCount(1)
  const robots = await request.get("/robots.txt")
  expect(robots.status()).toBe(200)
  expect(await robots.text()).toContain("User-agent: *")
  const image = await request.get("/og.png")
  expect(image.status()).toBe(200)
  expect(image.headers()["content-type"]).toBe("image/png")
})

test("a missing page gets the static 404", async ({ page }) => {
  const seen = watch(page)
  const response = await page.goto("/no-such-page")
  expect(response?.status()).toBe(404)
  await expect(
    page.getByRole("heading", { level: 1, name: "Page not found" }),
  ).toBeVisible()
  // The browser logs the page's own 404 status; nothing else may fail.
  expect(
    seen.errors.filter((error) => !error.includes("status of 404")),
  ).toEqual([])
})

test("the page shows which answers Stuart did not show, and why", async ({
  page,
}) => {
  await page.goto("/")
  await page.waitForLoadState("networkidle")
  const card = page.getByRole("region", {
    name: "Answers Stuart did not show",
  })
  await expect(card.getByRole("listitem").first()).toBeVisible()
  await expect(
    card.getByRole("img", {
      name: /answers not shown \([\d.]+%\): \d+ more than two sentences/,
    }),
  ).toHaveCount(3)
  await expect(
    card.getByText("More than two sentences (three for Mezo support)"),
  ).toBeVisible()
  await card.getByRole("link", { name: "The rules" }).click()
  await expect(page).toHaveURL(/\/method#not-shown$/)
  await expect(
    page.getByRole("heading", { name: "Answers Stuart did not show" }),
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Limits of this benchmark" }),
  ).toBeVisible()
})

test("the runs page shows the commit and the fingerprint", async ({ page }) => {
  await page.goto("/runs")
  await expect(page.getByText("Benchmark commit and fingerprint")).toBeVisible()
  await expect(page.getByText("b0336947 eeb32dfc509b7199")).toBeVisible()
  await expect(
    page.getByText(
      "The answers were collected on 17 Nov 2026 and re-checked offline against the final Stuart code, with every decision to show or set aside an answer reproduced.",
    ),
  ).toBeVisible()
})

test("screenshots of the leaderboard", async ({ page }, testInfo) => {
  await page.goto("/")
  await page.waitForLoadState("networkidle")
  await page.screenshot({
    path: testInfo.outputPath(`leaderboard-${testInfo.project.name}.png`),
    fullPage: true,
  })
  await page.emulateMedia({ colorScheme: "dark" })
  await page.reload()
  await page.waitForLoadState("networkidle")
  await page.screenshot({
    path: testInfo.outputPath(`leaderboard-${testInfo.project.name}-dark.png`),
    fullPage: true,
  })
})

/**
 * Cloudflare's zone injects its Web Analytics beacon into every page as it
 * is served: this adds the same tag (served locally) and reads what the
 * page CSP lets through. The beacon loads and reports to this origin, and
 * a script from any other host is still refused.
 */
test("the page CSP runs Cloudflare's beacon and nothing else from outside", async ({
  page,
}) => {
  await page.route(
    /^https:\/\/(static\.cloudflareinsights\.com|example\.com)\//,
    (route) =>
      route.fulfill({
        contentType: "text/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: "window.beaconRan = true",
      }),
  )
  await page.goto("/")
  const result = await page.evaluate(async () => {
    const violations: string[] = []
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push(`${event.effectiveDirective} ${event.blockedURI}`)
    })
    function load(src: string): Promise<boolean> {
      return new Promise((resolve) => {
        const script = document.createElement("script")
        script.type = "module"
        script.crossOrigin = "anonymous"
        script.src = src
        script.onload = () => resolve(true)
        script.onerror = () => resolve(false)
        document.body.appendChild(script)
      })
    }
    const beacon = await load(
      "https://static.cloudflareinsights.com/beacon.min.js/v1",
    )
    const other = await load("https://example.com/beacon.min.js")
    navigator.sendBeacon("/cdn-cgi/rum?", "{}")
    await new Promise((resolve) => setTimeout(resolve, 200))
    return { beacon, other, violations }
  })
  expect(result.beacon).toBe(true)
  expect(result.other).toBe(false)
  expect(result.violations).toEqual([
    "script-src-elem https://example.com/beacon.min.js",
  ])
})
