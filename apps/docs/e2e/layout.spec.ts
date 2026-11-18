import { expect, type Page, test } from "@playwright/test"
import { axe, watch } from "./helpers"

/**
 * Layout v2 (Doop `WC_9ztyeY-`): the two-row header and at most three
 * columns, measured at 1440, 1280, 1024 and 834, and the phone. Widths
 * are set per test, so these run in the desktop project. The phone project
 * runs the phone checks at Pixel 7.
 */

const epochs = "/concepts/epochs"
const operation = "/developer/api/incentives/list-incentives"

type Box = { x: number; y: number; width: number; height: number }

async function box(page: Page, selector: string): Promise<Box> {
  const found = await page.locator(selector).first().boundingBox()
  if (found === null) throw new Error(`${selector} is not shown`)
  return found
}

async function open(page: Page, width: number, path: string): Promise<void> {
  await page.setViewportSize({ width, height: 900 })
  await page.goto(path)
  await page.waitForLoadState("networkidle")
}

const sectionNav = 'nav[aria-label="Pages in this section"]'
const outline = "aside:has(nav[aria-labelledby]) nav[aria-labelledby]"

test.describe("desktop and tablet", () => {
  test.skip(({ isMobile }) => isMobile, "set widths, desktop project")

  test("no page scrolls sideways at any width", async ({ page }) => {
    // Eight pages at six widths.
    test.setTimeout(150_000)
    const paths = [
      "/",
      epochs,
      operation,
      "/pro/vote",
      "/developer/reference",
      "/developer/mcp/tools/rank-gauges",
      "/developer/errors",
      "/no/such/page",
    ]
    for (const width of [1920, 1440, 1280, 1024, 834, 390]) {
      for (const path of paths) {
        await open(page, width, path)
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        )
        expect(overflow, `${path} at ${width}`).toBe(0)
      }
    }
  })

  test("the header is two rows, 104 tall, with real product links", async ({
    page,
    request,
  }) => {
    // Prerendered HTML: links and aria-current before any script runs.
    for (const [path, active] of [
      ["/", "Home"],
      [epochs, "Concepts"],
      ["/pro/vote", "Pro"],
      [operation, "Developer"],
    ] as const) {
      const html = await (await request.get(path)).text()
      const row = /<nav aria-label="Products"[\s\S]*?<\/nav>/.exec(html)?.[0]
      expect(row, path).toBeDefined()
      expect(row?.match(/<a [^>]*href="\//g)?.length, path).toBe(7)
      expect(row, path).toMatch(
        new RegExp(`aria-current="page"[^>]*>[\\s\\S]*?${active}</a>`),
      )
    }
    await open(page, 1440, epochs)
    const header = page.locator("header").first()
    expect((await header.boundingBox())?.height).toBe(104)
    const products = page.getByRole("navigation", { name: "Products" })
    await expect(products.getByRole("link")).toHaveCount(7)
    await expect(
      products.getByRole("link", { name: "Concepts" }),
    ).toHaveAttribute("aria-current", "page")
    // The first product icon shares the lockup's left edge, at x 40.
    const lockup = await box(page, 'header a[href="/"] [role="img"]:visible')
    const home = await box(page, 'nav[aria-label="Products"] a svg')
    expect(Math.round(lockup.x)).toBe(40)
    expect(Math.round(home.x)).toBe(40)
    // Row 1: Copy, Edit, Ask about this page, then Appearance.
    for (const name of [
      "Copy page as Markdown",
      "Edit on GitHub",
      "Ask about this page",
      "Appearance",
    ]) {
      await expect(
        header.getByRole(name === "Edit on GitHub" ? "link" : "button", {
          name,
        }),
      ).toBeVisible()
    }
    // Docs home: Appearance only.
    await open(page, 1440, "/")
    await expect(
      page.locator("header").first().getByRole("button"),
    ).toHaveCount(1)
    await expect(
      page
        .locator("header")
        .first()
        .getByRole("button", { name: "Appearance" }),
    ).toBeVisible()
  })

  test("the lockup is DOCS at 1180 and below", async ({ page }) => {
    await open(page, 1181, epochs)
    expect(
      (await box(page, 'header a[href="/"] [role="img"]:visible')).width,
    ).toBeGreaterThan(200)
    await open(page, 1180, epochs)
    expect(
      (await box(page, 'header a[href="/"] [role="img"]:visible')).width,
    ).toBeLessThan(150)
  })

  test("columns follow the spec at each width", async ({ page }) => {
    await open(page, 1440, epochs)
    expect(await box(page, "main#content")).toMatchObject({
      x: 344,
      width: 792,
    })
    expect(await box(page, outline)).toMatchObject({ x: 1200, width: 200 })
    expect((await box(page, sectionNav)).x).toBeLessThan(344)
    // Text stops at 620. The clock card uses the full column.
    expect((await box(page, "main#content p")).width).toBeLessThanOrEqual(620)
    expect((await box(page, "main#content figure")).width).toBe(792)

    await open(page, 1280, epochs)
    expect(await box(page, "main#content")).toMatchObject({
      x: 328,
      width: 664,
    })
    expect(await box(page, outline)).toMatchObject({ x: 1040, width: 200 })

    await open(page, 1024, epochs)
    expect(await box(page, "main#content")).toMatchObject({
      x: 308,
      width: 676,
    })
    await expect(page.locator(outline)).toBeHidden()
    await expect(page.locator(sectionNav).first()).toBeVisible()
    await expect(
      page.getByRole("button", { name: "On this page" }),
    ).toBeVisible()

    await open(page, 834, epochs)
    expect(await box(page, "main#content")).toMatchObject({ x: 32, width: 770 })
    await expect(page.locator(sectionNav).first()).toBeHidden()
    await expect(page.getByRole("button", { name: /^Concepts/ })).toBeVisible()
    await expect(
      page.getByRole("button", { name: "On this page" }),
    ).toBeVisible()

    // Above 1440 everything stops at 1360 and centres.
    await open(page, 1920, epochs)
    expect((await box(page, "main#content")).x).toBe(344 + 240)
  })

  test("API pages put the samples in On this page's slot", async ({ page }) => {
    await open(page, 1440, operation)
    expect(await box(page, 'aside[aria-label="Samples"]')).toMatchObject({
      x: 928,
      width: 472,
    })
    await open(page, 1280, operation)
    expect(await box(page, 'aside[aria-label="Samples"]')).toMatchObject({
      x: 840,
      width: 400,
    })
    await open(page, 1024, operation)
    await expect(page.locator('aside[aria-label="Samples"]')).toBeHidden()
    // Inline, after the description.
    await expect(page.locator("main#content pre").first()).toBeVisible()
  })

  test("the header, section navigation and On this page stay put", async ({
    page,
  }) => {
    await open(page, 1440, epochs)
    await page.mouse.wheel(0, 1600)
    await page.waitForTimeout(300)
    expect((await box(page, "header")).y).toBe(0)
    expect((await box(page, sectionNav)).y).toBeGreaterThanOrEqual(128)
    expect((await box(page, sectionNav)).y).toBeLessThan(160)
    expect((await box(page, outline)).y).toBeGreaterThanOrEqual(128)
    expect((await box(page, outline)).y).toBeLessThan(160)
    await open(page, 1440, operation)
    await page.mouse.wheel(0, 1600)
    await page.waitForTimeout(300)
    expect((await box(page, 'aside[aria-label="Samples"]')).y).toBe(128)
  })

  test("the Ctrl K bar is centred on the article column", async ({ page }) => {
    const bar = 'button[aria-keyshortcuts="Control+K Meta+K"]'
    for (const [width, path] of [
      [1440, epochs],
      [1280, epochs],
      [1024, epochs],
      [834, epochs],
      [1440, operation],
      [1280, operation],
    ] as const) {
      await open(page, width, path)
      const main = await box(page, "main#content")
      const kbar = await box(page, bar)
      const centre = main.x + main.width / 2
      expect(
        Math.abs(kbar.x + kbar.width / 2 - centre),
        `${path} at ${width}`,
      ).toBeLessThanOrEqual(1)
      expect(Math.round(900 - kbar.y - kbar.height)).toBe(28)
    }
    await open(page, 1440, "/")
    await expect(page.locator(bar)).toHaveCount(1)
  })

  test("On this page opens as a 264 popover below 1280", async ({ page }) => {
    await open(page, 1024, epochs)
    await page.getByRole("button", { name: "On this page" }).click()
    const popover = page.locator("[data-mbx-pop]")
    await expect(popover).toBeVisible()
    // Measured after the open animation, which scales it in.
    await expect
      .poll(() => popover.evaluate((el) => (el as HTMLElement).offsetWidth))
      .toBe(264)
    await expect(popover.getByRole("link").first()).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(popover).toBeHidden()
    await expect(
      page.getByRole("button", { name: "On this page" }),
    ).toBeFocused()
  })

  test("Open Pro and Open Matchscan moved to the footer and the trees", async ({
    page,
  }) => {
    await open(page, 1440, "/pro/vote")
    const footer = page.locator("footer").last()
    await expect(footer.getByRole("link", { name: "Open Pro" })).toBeVisible()
    await expect(
      footer.getByRole("link", { name: "Open Matchscan" }),
    ).toBeVisible()
    await expect(
      page.locator(sectionNav).first().getByRole("link", { name: "Open Pro" }),
    ).toBeVisible()
    await open(page, 1440, "/")
    await expect(
      page.getByRole("link", { name: "Open Matchscan" }),
    ).toHaveCount(2)
  })

  test("keyboard order: skip link, header, section navigation, article", async ({
    page,
  }) => {
    await open(page, 1440, epochs)
    const regions: string[] = []
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press("Tab")
      const region = await page.evaluate(() => {
        const active = document.activeElement
        if (active === null) return "none"
        if (active.textContent === "Skip to content") return "skip"
        if (active.closest("header")) return "header"
        if (active.closest('nav[aria-label="Pages in this section"]'))
          return "section"
        if (active.closest("main")) return "article"
        return "other"
      })
      if (regions.at(-1) !== region) regions.push(region)
      if (region === "article") break
    }
    expect(regions).toEqual(["skip", "header", "section", "article"])
  })

  test("every width passes axe and loads without shifting", async ({
    page,
  }) => {
    test.setTimeout(150_000)
    for (const width of [1440, 1280, 1024, 834]) {
      await page.addInitScript(() => {
        const shifts: number[] = []
        ;(window as unknown as { shifts: number[] }).shifts = shifts
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            shifts.push((entry as unknown as { value: number }).value)
        }).observe({ type: "layout-shift", buffered: true })
      })
      for (const path of ["/", epochs, operation]) {
        const seen = watch(page)
        await open(page, width, path)
        await page.waitForTimeout(300)
        const shifts = await page.evaluate(
          () => (window as unknown as { shifts: number[] }).shifts,
        )
        expect(shifts, `${path} at ${width}`).toEqual([])
        expect(await axe(page), `${path} at ${width}`).toEqual([])
        expect(seen.errors, `${path} at ${width}`).toEqual([])
      }
    }
  })
})

test.describe("phone", () => {
  test.skip(({ isMobile }) => !isMobile, "phone project")

  test("keeps its own top bar, with no header and no overflow", async ({
    page,
  }) => {
    for (const path of ["/", epochs, operation]) {
      await page.goto(path)
      await page.waitForLoadState("networkidle")
      await expect(
        page.getByRole("navigation", { name: "Products" }),
      ).toBeHidden()
      await expect(page.getByRole("button", { name: "Menu" })).toBeVisible()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
      expect(overflow, path).toBe(0)
    }
  })
})
