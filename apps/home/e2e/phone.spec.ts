import { expect, test } from "@playwright/test"

/** The homepage on the narrowest common phone, 360 wide. */

test.describe("at 360 wide", () => {
  test.skip(({ isMobile }) => !isMobile, "phone layout")
  test.use({ viewport: { width: 360, height: 780 } })

  test("Most incentives rows show every figure whole, clear of the token icons", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0)
    const rows = await page.locator(".gr").evaluateAll((elements) =>
      elements.flatMap((row) => {
        const votes = row.querySelector<HTMLElement>(".ss > :last-child")
        const icons = row.querySelector(".iv")
        if (votes === null || icons === null) return []
        const a = votes.getBoundingClientRect()
        const b = icons.getBoundingClientRect()
        const apart =
          a.right <= b.left ||
          b.right <= a.left ||
          a.bottom <= b.top ||
          b.bottom <= a.top
        return [
          {
            text: votes.textContent ?? "",
            cut: votes.scrollWidth - votes.clientWidth,
            past: a.right - row.getBoundingClientRect().right,
            apart,
          },
        ]
      }),
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.cut, `"${row.text}" is cut`).toBeLessThanOrEqual(0)
      expect(row.past, `"${row.text}" leaves its row`).toBeLessThanOrEqual(0)
      expect(row.apart, `"${row.text}" meets the token icons`).toBe(true)
    }
  })

  test("the search shows a placeholder that fits, gone once typing starts", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" })
    const input = page.getByRole("searchbox", { name: "Search Matchscan" })
    const shown = page.locator(".sfp")
    await expect(shown).toBeVisible()
    await expect(shown).toHaveText("Address or tx")
    const fit = await page.evaluate(() => {
      const field = document.querySelector<HTMLInputElement>(".sf input")
      const text = document.querySelector(".sfp")?.firstChild
      if (field === null || text === null || text === undefined) return null
      const range = document.createRange()
      range.selectNodeContents(text)
      const native = getComputedStyle(field, "::placeholder").color
      return {
        room: field.clientWidth - range.getBoundingClientRect().width,
        native,
      }
    })
    expect(fit?.room ?? -1).toBeGreaterThan(0)
    // The input's own placeholder would be cut ("Address or transacti").
    expect(fit?.native).toBe("rgba(0, 0, 0, 0)")
    await input.fill("0x12")
    await expect(shown).toBeHidden()
  })

  test("footer and card links are at least 40 by 40", async ({ page }) => {
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

  test("footer links are marked for 44px touch targets", async ({ page }) => {
    await page.goto("/")
    const links = page.locator("footer a")
    await expect(links.first()).toBeVisible()
    const unmarked = await links.evaluateAll(
      (anchors) => anchors.filter((a) => !a.hasAttribute("data-tap")).length,
    )
    expect(unmarked).toBe(0)
  })
})
