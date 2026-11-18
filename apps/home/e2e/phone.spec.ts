import { expect, test } from "@playwright/test"

/** The homepage on the narrowest common phone, 360 wide. */

test.describe("at 360 wide", () => {
  test.skip(({ isMobile }) => !isMobile, "phone layout")
  test.use({ viewport: { width: 360, height: 780 } })

  test("Most incentives rows keep the votes clear of the token icons", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0)
    const rows = await page.locator(".gr").evaluateAll((elements) =>
      elements.map((row) => {
        const votes = row.querySelector(".ss > :last-child")
        const icons = row.querySelector(".iv")
        if (votes === null || icons === null) return 0
        return (
          votes.getBoundingClientRect().right -
          icons.getBoundingClientRect().left
        )
      }),
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const overlap of rows) expect(overlap).toBeLessThanOrEqual(0)
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
