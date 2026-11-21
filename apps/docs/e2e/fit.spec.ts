import { expect, type Page, test } from "@playwright/test"

/**
 * Whole, clear and big enough to tap (live audit, 20 Nov 2026): the API
 * reference's paths are never cut (D2), the Ctrl K bar never sits over
 * content (as Pro's gutter, P10), and on a 360 phone every control is at
 * least 40 by 40 and every illustration label whole (D3). Each page is
 * hard-loaded.
 */

type Box = { x: number; y: number; width: number; height: number }

async function box(page: Page, selector: string): Promise<Box> {
  const found = await page.locator(selector).first().boundingBox()
  if (found === null) throw new Error(`${selector} is not shown`)
  return found
}

/** Text in these elements is cut: it overflows a box that hides it. */
async function cutText(page: Page, scope: string): Promise<string[]> {
  return page.locator(scope).evaluateAll((roots) =>
    roots.flatMap((root) =>
      [root, ...root.querySelectorAll("*")]
        .filter((element) => {
          if (!(element instanceof HTMLElement)) return false
          if ((element.textContent ?? "").trim() === "") return false
          if (element.getClientRects().length === 0) return false
          return element.scrollWidth > element.clientWidth + 1
        })
        .map((element) => (element.textContent ?? "").trim()),
    ),
  )
}

test.describe("the API reference", () => {
  const paths = "main section li a span.font-mono.block"

  test("shows every operation's path whole", async ({ page, isMobile }) => {
    if (isMobile) await page.setViewportSize({ width: 360, height: 740 })
    await page.goto("/developer/reference")
    await expect(page.locator(paths).first()).toBeVisible()
    expect(await page.locator(paths).count()).toBeGreaterThan(10)
    expect(await cutText(page, paths)).toEqual([])
    // Each path is the operation's own text, starting at a slash.
    for (const text of await page.locator(paths).allTextContents())
      expect(text).toMatch(/^\/\S+$/)
  })

  test("uses the whole article column on desktop", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "desktop width")
    await page.goto("/developer/reference")
    const main = await box(page, "main#content")
    const grid = await box(page, "main#content section >> xpath=..")
    expect(grid.width).toBe(main.width)
    // In two cards a row at 1440, the longest paths wrap once at most.
    const lines = await page
      .locator(paths)
      .evaluateAll((spans) =>
        spans.map((span) =>
          Math.round(
            span.getBoundingClientRect().height /
              Number.parseFloat(getComputedStyle(span).lineHeight),
          ),
        ),
      )
    expect(Math.max(...lines)).toBeLessThanOrEqual(2)
  })
})

test.describe("the Ctrl K bar", () => {
  test.skip(({ isMobile }) => isMobile, "phones hide the bar")
  const bar = 'button[aria-keyshortcuts="Control+K Meta+K"]'

  /** Whether what is painted at a point belongs to the page's content. */
  async function contentAt(page: Page, x: number, y: number): Promise<boolean> {
    return page.evaluate(
      ([px, py]) =>
        document.elementFromPoint(px ?? 0, py ?? 0)?.closest("main") != null,
      [x, y],
    )
  }

  for (const path of [
    "/developer/reference",
    "/concepts/epochs",
    "/developer/api/incentives/list-incentives",
  ]) {
    for (const width of [1440, 1024]) {
      test(`covers no content on first view of ${path} at ${width}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(path)
        await expect(page.locator("main h1")).toBeVisible()
        await expect(page.locator(bar)).toBeVisible()
        const kbar = await box(page, bar)
        const main = await box(page, "main#content")
        // Level with the bar and just above it, across the column, the
        // page shows only the bar and the clear strip under it.
        for (const y of [kbar.y + kbar.height / 2, kbar.y - 8]) {
          for (const x of [main.x + 12, kbar.x - 8, main.x + main.width - 12])
            expect(await contentAt(page, x, y), `${x}, ${y}`).toBe(false)
        }
        // The strip is under the bar: the bar still opens search.
        await page.locator(bar).click()
        await expect(page.getByRole("dialog")).toBeVisible()
      })
    }
  }

  test("the end of a page clears the bar", async ({ page }) => {
    await page.goto("/developer/reference")
    await expect(page.locator("main h1")).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    const kbar = await box(page, bar)
    const last = await page.evaluate(() =>
      Math.max(
        ...[...document.querySelectorAll("main *")]
          .filter(
            (element) =>
              element.getClientRects().length > 0 &&
              (element.textContent ?? "").trim() !== "",
          )
          .map((element) => element.getBoundingClientRect().bottom),
      ),
    )
    expect(last).toBeLessThanOrEqual(kbar.y)
  })
})

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
        if (
          element.closest("[aria-hidden='true'], [hidden], dialog:not([open])")
        )
          return false
        if (rect.right < 0 || rect.left > window.innerWidth) return false
        const style = getComputedStyle(element)
        if (style.visibility === "hidden" || style.position === "fixed")
          return false
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

  for (const path of [
    "/",
    "/pro/vote",
    "/developer/reference",
    "/developer/sdk",
  ]) {
    test(`every control on ${path} is at least 40 by 40`, async ({ page }) => {
      await page.goto(path)
      await page.waitForLoadState("networkidle")
      expect(await smallTargets(page)).toEqual([])
    })
  }

  test("home shows the install command whole", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("main code").last()).toBeVisible()
    expect(await cutText(page, "main code")).toEqual([])
    // It wraps between words, never inside the package name.
    const name = page.locator("main code span", {
      hasText: "@matchbox-dev/sdk",
    })
    expect(await name.evaluate((span) => span.getClientRects().length)).toBe(1)
  })

  test("the Vote illustration shows every label whole", async ({ page }) => {
    await page.goto("/pro/vote")
    const figure = page.locator("main figure").first()
    await figure.scrollIntoViewIfNeeded()
    await expect(figure).toContainText("Validator gauges")
    expect(await cutText(page, "main figure")).toEqual([])
  })
})
