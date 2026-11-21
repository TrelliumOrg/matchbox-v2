import { expect, type Page, test } from "@playwright/test"
import { benchRoutes } from "../scripts/routes.mjs"

/**
 * Tap targets (B1, live audit 20 Nov 2026): on a 360 phone every control is
 * at least 40 by 40, and the desktop layout keeps its dense 36 and 38 tall
 * controls. Each page is hard-loaded.
 */

/**
 * Controls under 40 px on either side, by their text. Links and terms
 * set inline in a sentence are left out (WCAG 2.5.8's inline exception),
 * and so is the skip link, which is off screen until focused.
 */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const blocks = "p, li, td, dd, dt, figcaption, h1, h2, h3, h4"
    return [...document.querySelectorAll("a[href], button, summary")]
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return false
        if (element.closest("[aria-hidden='true'], [hidden]")) return false
        if (rect.right < 0 || rect.left > window.innerWidth) return false
        if (getComputedStyle(element).visibility === "hidden") return false
        if (element.getAttribute("href") === "#content") return false
        const block = element.parentElement?.closest(blocks)
        const own = (element.textContent ?? "").trim()
        if (
          getComputedStyle(element).display.startsWith("inline") &&
          !getComputedStyle(element).display.includes("flex") &&
          block != null &&
          (block.textContent ?? "").trim() !== own
        )
          return false
        return rect.width < 40 || rect.height < 40
      })
      .map((element) => {
        const rect = element.getBoundingClientRect()
        const name =
          element.getAttribute("aria-label") ??
          (element.textContent ?? "").trim().slice(0, 40)
        return `${name} ${Math.round(rect.width)}x${Math.round(rect.height)}`
      })
  })
}

test.describe("on a 360 phone", () => {
  test.skip(({ isMobile }) => !isMobile, "phone")
  test.use({ viewport: { width: 360, height: 740 } })

  for (const path of benchRoutes) {
    test(`every control on ${path} is at least 40 by 40`, async ({ page }) => {
      await page.goto(path)
      await page.waitForLoadState("networkidle")
      expect(await smallTargets(page)).toEqual([])
    })
  }
})

test("desktop keeps its dense controls", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop")
  await page.goto("/")
  const height = async (name: string): Promise<number> =>
    Math.round(
      (await page.getByRole("button", { name, exact: true }).boundingBox())
        ?.height ?? 0,
    )
  expect(await height("Haiku 5.5")).toBe(36)
  expect(await height("Best of each model")).toBe(38)
  expect(
    Math.round(
      (await page.getByRole("radio", { name: "Inside Stuart" }).boundingBox())
        ?.height ?? 0,
    ),
  ).toBe(36)
  await page.goto("/questions")
  const chip = page
    .getByRole("navigation", { name: "Kinds of question" })
    .getByRole("link")
    .first()
  expect(Math.round((await chip.boundingBox())?.height ?? 0)).toBe(36)
})
