import { expect, type Page, test } from "@playwright/test"

/** The rows' shared width and the screens inside the cards, wider than the phone. */

/** Left and right edges of each row, by name. */
function rowEdges(page: Page): Promise<Record<string, [number, number]>> {
  return page.evaluate(() => {
    const edges = (
      first: Element | null,
      last: Element | null,
    ): [number, number] => {
      if (first === null || last === null) return [Number.NaN, Number.NaN]
      return [
        Math.round(first.getBoundingClientRect().left),
        Math.round(last.getBoundingClientRect().right),
      ]
    }
    const one = (selector: string): [number, number] =>
      edges(document.querySelector(selector), document.querySelector(selector))
    return {
      "Pro and Matchscan": edges(
        document.querySelector(".b1 > :first-child"),
        document.querySelector(".b1 > :last-child"),
      ),
      "ID and Developer": edges(
        document.querySelector(".b2 > :first-child"),
        document.querySelector(".b2 > :last-child"),
      ),
      "Docs and Stuart": one(".b3"),
      Classic: one(".cl"),
      Footer: one(".ft"),
    }
  })
}

for (const width of [1440, 1250, 1024]) {
  test(`every row has the same width at ${width}`, async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "wider than the phone")
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/", { waitUntil: "networkidle" })
    const rows = await rowEdges(page)
    const [left, right] = rows["Pro and Matchscan"] ?? [0, 0]
    expect(right - left).toBeLessThanOrEqual(1200)
    for (const [name, edges] of Object.entries(rows)) {
      expect(edges, name).toEqual([left, right])
    }
  })
}

test("the screens in the cards end inside them, with room under each panel", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "wider than the phone")
  await page.goto("/", { waitUntil: "networkidle" })
  const gaps = await page.evaluate(() =>
    [".ep", ".blk", ".b2 .mini"].flatMap((selector) =>
      [...document.querySelectorAll(selector)].map((panel) => {
        const card = panel.closest(".hc, .pc")
        const screen = panel.closest(".scr") ?? card
        const bottom = panel.getBoundingClientRect().bottom
        return {
          selector,
          toCard: (card?.getBoundingClientRect().bottom ?? 0) - bottom,
          toScreen: (screen?.getBoundingClientRect().bottom ?? 0) - bottom,
        }
      }),
    ),
  )
  expect(gaps).toHaveLength(4)
  for (const gap of gaps) {
    expect(gap.toCard, `${gap.selector} to its card`).toBeGreaterThanOrEqual(12)
    if (gap.selector !== ".b2 .mini") {
      expect(
        gap.toScreen,
        `${gap.selector} to its screen`,
      ).toBeGreaterThanOrEqual(12)
    }
  }
})

test("footer and card links are at least 40 by 40 with a mouse", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "wider than the phone")
  await page.goto("/", { waitUntil: "networkidle" })
  const small = await page
    .locator("footer a, footer button, a.lnk")
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const box = element.getBoundingClientRect()
        return box.width >= 40 && box.height >= 40
          ? []
          : [
              `${element.textContent?.trim()} ${Math.round(box.width)}x${Math.round(box.height)}`,
            ]
      }),
    )
  expect(small).toEqual([])
})
