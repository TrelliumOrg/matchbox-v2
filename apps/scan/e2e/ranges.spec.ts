import { expect, type Page, test } from "@playwright/test"

/**
 * Chart periods against the fixtures: All draws a bar per week, every bar
 * wider than nothing, with readouts that say what a bar covers; a custom
 * span comes from the URL or the calendar popover, reproduces from its
 * link, and a range link drops it.
 */

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

/** The widths of a bar chart's bars, by the chart's accessible name. */
async function barWidths(page: Page, name: RegExp): Promise<number[]> {
  const chart = page.getByRole("img", { name }).first()
  await expect(chart).toBeVisible()
  return chart.evaluate((element) =>
    [...element.querySelectorAll("[data-inspect-point]")].map(
      (bar) => bar.getBoundingClientRect().width,
    ),
  )
}

test("All draws a bar per week, none of them 0 px wide", async ({ page }) => {
  const errors = watchErrors(page)
  const response = await page.goto("/network?range=All")
  expect(response?.status()).toBe(200)
  // The fixtures hold days from 11 Dec 2025: about 48 weeks.
  for (const name of [/^Transactions per day/, /^Daily active addresses/]) {
    const widths = await barWidths(page, name)
    expect(widths.length).toBeGreaterThan(40)
    expect(widths.length).toBeLessThan(60)
    expect(Math.min(...widths)).toBeGreaterThan(1)
  }
  const bars = page
    .getByRole("img", { name: /^Transactions per day/ })
    .locator("[data-inspect-point]")
  await expect(bars.nth(1)).toHaveAttribute(
    "data-inspect-label",
    "Week of 15 Dec",
  )
  await expect(bars.last()).toHaveAttribute("data-inspect-label", /so far$/)
  await page.waitForLoadState("networkidle")
  expect(errors).toEqual([])
})

test("an aggregated bar reads out its week on hover and from the keyboard", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "hover is a pointer's")
  await page.goto("/network?range=All")
  await page.waitForLoadState("networkidle")
  const chart = page.getByRole("img", { name: /^Transactions per day/ }).first()
  const panel = page.locator("section", { has: chart }).first()
  const bars = chart.locator("[data-inspect-point]")
  await bars.nth(1).hover()
  await expect(panel.getByText("Week of 15 Dec").first()).toBeVisible()
  await chart.focus()
  await page.keyboard.press("End")
  await expect(panel.getByText("9 Nov so far").first()).toBeVisible()
  await page.keyboard.press("Home")
  await expect(panel.getByText("11 to 14 Dec").first()).toBeVisible()
})

test("a custom span from the URL draws its days and shows as picked", async ({
  page,
}) => {
  const errors = watchErrors(page)
  await page.goto("/network?from=2026-01-01&to=2026-03-31")
  const toggle = page.getByRole("navigation", { name: "Period" }).first()
  const custom = toggle.getByRole("button", { name: /^Custom period/ })
  await expect(custom).toHaveAttribute("aria-current", "true")
  await expect(toggle.getByRole("link", { name: "30d" })).not.toHaveAttribute(
    "aria-current",
    /.+/,
  )
  // 90 days: daily bars, from 1 Jan to 31 Mar.
  const widths = await barWidths(page, /^Transactions per day/)
  expect(widths).toHaveLength(90)
  expect(Math.min(...widths)).toBeGreaterThan(1)
  const bars = page
    .getByRole("img", { name: /^Transactions per day/ })
    .locator("[data-inspect-point]")
  await expect(bars.first()).toHaveAttribute("data-inspect-label", "1 Jan")
  await expect(bars.last()).toHaveAttribute("data-inspect-label", "31 Mar")
  // A range link drops the span.
  await toggle.getByRole("link", { name: "90d" }).click()
  await expect(page).toHaveURL(/\/network\?range=90d$/)
  await expect(
    page
      .getByRole("navigation", { name: "Period" })
      .first()
      .getByRole("button", { name: "Custom period" }),
  ).not.toHaveAttribute("aria-current", /.+/)
  await page.waitForLoadState("networkidle")
  expect(errors).toEqual([])
})

test("a reversed or impossible span never breaks the page", async ({
  page,
}) => {
  const reversed = await page.goto("/network?from=2026-03-31&to=2026-01-01")
  expect(reversed?.status()).toBe(200)
  const bars = page
    .getByRole("img", { name: /^Transactions per day/ })
    .locator("[data-inspect-point]")
  await expect(bars.first()).toHaveAttribute("data-inspect-label", "1 Jan")
  const odd = await page.goto("/network?from=2026-02-31&to=nope")
  expect(odd?.status()).toBe(200)
  await expect(bars).toHaveCount(30)
})

test("the calendar popover sets a span, and Escape gives focus back", async ({
  page,
}) => {
  await page.goto("/network")
  await page.waitForLoadState("networkidle")
  const toggle = page.getByRole("navigation", { name: "Period" }).first()
  const button = toggle.getByRole("button", { name: "Custom period" })
  await button.click()
  const box = page.getByRole("dialog", { name: "Custom period" }).first()
  await expect(box).toBeVisible()
  await expect(box.getByLabel("From")).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(box).toBeHidden()
  await expect(button).toBeFocused()
  // Keyboard only: open, type both days, apply.
  await page.keyboard.press("Enter")
  await expect(box).toBeVisible()
  await box.getByLabel("From").fill("2026-02-01")
  await box.getByLabel("To").fill("2026-02-28")
  await box.getByRole("button", { name: "Apply" }).click()
  // A plain GET: the page loads at the toggle (the form's fragment).
  await expect(page).toHaveURL(
    /\/network\?from=2026-02-01&to=2026-02-28#[\w-]+$/,
  )
  await expect(box).toBeHidden()
  await expect(
    page
      .getByRole("navigation", { name: "Period" })
      .first()
      .getByRole("button", { name: "Custom period, 1 Feb to 28 Feb" }),
  ).toHaveAttribute("aria-current", "true")
  await expect(
    page
      .getByRole("img", { name: /^Transactions per day/ })
      .locator("[data-inspect-point]"),
  ).toHaveCount(28)
  // A click outside closes it too.
  await button.click()
  await expect(box).toBeVisible()
  await page.mouse.click(5, 5)
  await expect(box).toBeHidden()
})

test("after a link, the calendar still opens on From", async ({
  page,
  isMobile,
}) => {
  await page.goto("/network")
  await page.waitForLoadState("networkidle")
  // Left by a full load, kept by the router's own navigation.
  await page.evaluate(() => Reflect.set(window, "stayed", true))
  // A phone has Locks under More.
  if (isMobile) await page.getByRole("button", { name: "More" }).click()
  await page.locator('a[href="/locks"]:visible').first().click()
  await expect(page).toHaveURL(/\/locks$/)
  // Drawn by the client (not the server's HTML, which has `autofocus`).
  await expect(
    page.getByRole("heading", { level: 1, name: "Locks" }),
  ).toBeVisible()
  expect(await page.evaluate(() => Reflect.get(window, "stayed"))).toBe(true)
  const button = page
    .getByRole("navigation", { name: "Period" })
    .first()
    .getByRole("button", { name: "Custom period" })
  const box = page.getByRole("dialog", { name: "Custom period" }).first()
  await button.click()
  await expect(box).toBeVisible()
  await expect(box.getByLabel("From")).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(button).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(box.getByLabel("From")).toBeFocused()
})

test("other pages take a span: a token, a gauge-free page, Borrow", async ({
  page,
}) => {
  const errors = watchErrors(page)
  for (const path of [
    "/tokens/musd?from=2026-01-01&to=2026-03-31",
    "/locks?from=2026-01-01&to=2026-03-31",
    "/borrow?from=2026-01-01&to=2026-03-31",
  ]) {
    const response = await page.goto(path)
    expect(response?.status()).toBe(200)
    await expect(
      page
        .getByRole("button", { name: /^Custom period, 1 Jan to 31 Mar/ })
        .first(),
    ).toHaveAttribute("aria-current", "true")
  }
  await page.goto("/tokens/musd?range=All")
  await expect(
    page.getByRole("img", { name: /^MUSD supply/ }).first(),
  ).toBeVisible()
  await page.waitForLoadState("networkidle")
  expect(errors).toEqual([])
})
