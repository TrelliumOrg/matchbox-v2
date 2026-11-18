import { inspectable } from "@matchbox/ui/inspect-e2e"
import { expect, type Locator, test } from "@playwright/test"

/**
 * Charts read out the point under the pointer (`@matchbox/ui/inspect`):
 * hovering an epoch's bar writes its value and epoch into the panel's
 * figure, leaving puts the latest back, the arrow keys move between bars,
 * and a split bar's part shows a tooltip. Against the fixtures, once the
 * page has hydrated and the charts listen.
 */

function live(panel: Locator, slot: "value" | "note"): Locator {
  return panel.locator(`[data-inspect-slot="${slot}"] > [data-inspect-live]`)
}

test.describe("chart inspection", () => {
  test.skip(({ isMobile }) => isMobile, "hover is a pointer's")

  test("an epoch bar reads into the figure and the latest comes back", async ({
    page,
  }) => {
    await page.goto("/gauges")
    await inspectable(page)
    const panel = page.getByRole("region", { name: "MEZO emissions by epoch" })
    const figure = panel.locator('[data-inspect-slot="value"]')
    const latest =
      (await figure.locator("[data-inspect-rest]").textContent()) ?? ""
    const bars = panel.locator("[data-inspect-point]")
    const first = bars.first()
    const value = await first.getAttribute("data-inspect-value")
    const label = await first.getAttribute("data-inspect-label")
    expect(value).not.toBeNull()

    const before = await figure.boundingBox()
    await first.hover()
    await expect(live(panel, "value")).toHaveText(value ?? "")
    await expect(live(panel, "note")).toContainText(label ?? "")
    await expect(live(panel, "value")).toBeVisible()
    await expect(figure.locator("[data-inspect-rest]")).toBeHidden()
    await expect(first).toHaveAttribute("data-active", "")
    // The figure keeps its width while it reads: nothing moves.
    expect((await figure.boundingBox())?.width).toBe(before?.width)

    // The next bar along shows its change from this one.
    const second = bars.nth(1)
    await second.hover()
    await expect(live(panel, "value")).toHaveText(
      (await second.getAttribute("data-inspect-value")) ?? "",
    )
    await expect(live(panel, "note")).toContainText(/[+-]\d+\.\d%|0\.0%/)

    await page.mouse.move(2, 2)
    await expect(figure.locator("[data-inspect-rest]")).toBeVisible()
    await expect(figure.locator("[data-inspect-rest]")).toHaveText(latest)
    await expect(live(panel, "value")).toBeHidden()
    await expect(panel.locator("[data-active]")).toHaveCount(0)
  })

  test("the arrow keys move between epochs", async ({ page }) => {
    await page.goto("/gauges")
    await inspectable(page)
    const panel = page.getByRole("region", { name: "MEZO emissions by epoch" })
    const bars = panel.locator("[data-inspect-point]")
    const count = await bars.count()
    expect(count).toBeGreaterThan(2)
    await bars.last().focus()
    await page.keyboard.press("ArrowLeft")
    const previous = bars.nth(count - 2)
    await expect(previous).toBeFocused()
    await expect(live(panel, "value")).toHaveText(
      (await previous.getAttribute("data-inspect-value")) ?? "",
    )
    await page.keyboard.press("Home")
    await expect(bars.first()).toBeFocused()
    await expect(live(panel, "value")).toHaveText(
      (await bars.first().getAttribute("data-inspect-value")) ?? "",
    )
  })

  test("a split bar's part shows its value in a tooltip", async ({ page }) => {
    await page.goto("/gauges")
    await inspectable(page)
    const panel = page.getByRole("region", { name: "Where veBTC votes go" })
    const part = panel.locator("[data-inspect-point]").first()
    await part.hover()
    const tip = page.locator("[data-inspect-tip]")
    await expect(tip).toBeVisible()
    await expect(tip).toContainText(
      (await part.getAttribute("data-inspect-label")) ?? "",
    )
    await expect(tip).toContainText(
      (await part.getAttribute("data-inspect-value")) ?? "",
    )
    await page.mouse.move(2, 2)
    await expect(tip).toBeHidden()
  })
})
