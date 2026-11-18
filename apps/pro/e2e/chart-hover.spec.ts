import { inspectable } from "@matchbox/ui/inspect-e2e"
import { expect, type Page, test } from "@playwright/test"

/**
 * Pro's charts read out the epoch under the pointer
 * (`@matchbox/ui/inspect`): a gauge's votes chart writes the epoch's votes
 * into the Votes headline and puts the latest back on leave; the
 * protocol's incentives bars show each epoch's dollars in a tooltip. Each
 * test waits for the charts to listen (the page hydrated) first.
 */

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

test.describe("chart inspection", () => {
  test.skip(({ isMobile }) => isMobile, "hover is a pointer's")

  test("a gauge's votes chart reads an epoch into its headline", async ({
    page,
  }) => {
    const errors = watchErrors(page)
    await page.goto("/gauges/0x4da4c05483324ea9cfc951510a5e77cc79541159")
    await inspectable(page)
    const chart = page.locator("svg[data-inspect]")
    await chart.scrollIntoViewIfNeeded()
    await expect(chart).toBeVisible()
    const section = page.locator("[data-inspect-scope]", { has: chart })
    const value = section.locator(
      '[data-inspect-slot="value"] > [data-inspect-live]',
    )
    const note = section.locator(
      '[data-inspect-slot="note"] > [data-inspect-live]',
    )
    const rest = section.locator(
      '[data-inspect-slot="value"] > [data-inspect-rest]',
    )
    const latest = (await rest.textContent()) ?? ""
    const points = chart.locator("[data-inspect-point]")
    const first = points.first()

    const box = await chart.boundingBox()
    if (box === null) throw new Error("no chart box")
    // The left edge of the chart is the first epoch.
    await page.mouse.move(box.x + 4, box.y + box.height / 2)
    await expect(value).toHaveText(
      (await first.getAttribute("data-inspect-value")) ?? "",
    )
    await expect(note).toContainText(
      (await first.getAttribute("data-inspect-label")) ?? "",
    )
    await expect(rest).toBeHidden()
    // A vertical line has no width, so Playwright never calls it visible.
    await expect(chart.locator("[data-inspect-guide]")).toHaveCSS(
      "visibility",
      "visible",
    )

    await page.mouse.move(box.x + box.width / 2, box.y - 200)
    await expect(rest).toBeVisible()
    await expect(rest).toHaveText(latest)
    await expect(value).toBeHidden()
    expect(errors).toEqual([])
  })

  test("the protocol's incentives bars show each epoch in a tooltip", async ({
    page,
  }) => {
    const errors = watchErrors(page)
    await page.goto("/protocol")
    await inspectable(page)
    const bars = page.locator("[data-inspect] [data-inspect-point]")
    await bars.first().scrollIntoViewIfNeeded()
    const bar = bars.nth(1)
    await bar.hover()
    const tip = page.locator("[data-inspect-tip]")
    await expect(tip).toBeVisible()
    await expect(tip).toContainText(
      (await bar.getAttribute("data-inspect-label")) ?? "",
    )
    await expect(tip).toContainText(
      (await bar.getAttribute("data-inspect-value")) ?? "",
    )
    await page.mouse.move(2, 2)
    await expect(tip).toBeHidden()
    expect(errors).toEqual([])
  })
})
