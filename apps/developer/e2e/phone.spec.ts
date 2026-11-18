import { expect, type Page, test } from "@playwright/test"

/**
 * Phones and wallet browsers: the console at 360 wide, and the sign-in
 * page inside OKX Wallet's browser, where Google refuses to sign in.
 */

const origin = "http://localhost:5175"

const okxIos =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 OKApp/(OKEx/6.95.0) brokerDomain/www.okx.com locale=en-US statusBarHeight=59 OKWallet/6.95.0"

async function signIn(page: Page): Promise<void> {
  const response = await page.request.post("/api/auth/dev-sign-in", {
    headers: { Origin: origin },
  })
  expect(response.status()).toBe(200)
}

test.describe("at 360 wide", () => {
  test.skip(({ isMobile }) => !isMobile, "phone layout")
  test.use({ viewport: { width: 360, height: 780 } })

  test("no console page scrolls sideways, and no field makes iOS zoom", async ({
    page,
  }) => {
    await signIn(page)
    await page.goto("/apps", { waitUntil: "networkidle" })
    const app = await page
      .locator("main a[href^='/apps/']")
      .first()
      .getAttribute("href")
    const paths = [
      "/",
      "/apps",
      "/usage",
      "/organization",
      "/account",
      "/admin",
      "/admin/apps",
      "/admin/audit",
      "/admin/quotas",
      ...(app === null ? [] : [app]),
    ]
    for (const path of paths) {
      await page.goto(path, { waitUntil: "networkidle" })
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        tables: [...document.querySelectorAll("table")].filter(
          (table) =>
            table.getBoundingClientRect().width >
            (table.parentElement?.clientWidth ?? 0) + 1,
        ).length,
        smallFields: [
          ...document.querySelectorAll(
            "input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea",
          ),
        ]
          .map((field) => Number.parseFloat(getComputedStyle(field).fontSize))
          .filter((size) => size < 16),
      }))
      expect(layout.overflow, path).toBeLessThanOrEqual(0)
      expect(layout.tables, `${path}: tables wider than their column`).toBe(0)
      expect(layout.smallFields, path).toEqual([])
    }
  })
})

test.describe("inside OKX Wallet's browser", () => {
  test.use({ userAgent: okxIos, viewport: { width: 390, height: 664 } })

  test("sign-in says to use the phone's browser and copies the link", async ({
    page,
    context,
    isMobile,
  }) => {
    test.skip(!isMobile, "a wallet's browser is a phone")
    const google: string[] = []
    page.on("request", (request) => {
      if (/accounts\.google\.com|\/auth\/google\/nonce/.test(request.url())) {
        google.push(request.url())
      }
    })
    await context.grantPermissions(["clipboard-read", "clipboard-write"])
    await page.goto("/sign-in", { waitUntil: "networkidle" })
    await expect(
      page.getByText("Google sign-in does not work in this app's browser."),
    ).toBeVisible()
    await page.getByRole("button", { name: "Copy link" }).tap()
    await expect(
      page.getByRole("button", { name: "Link copied" }),
    ).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `${origin}/sign-in`,
    )
    // No Google script and no nonce: the button would only fail here.
    expect(google).toEqual([])
    const scroll = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(scroll).toBeLessThanOrEqual(0)
  })
})

test("theme-color follows the painted theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" })
  await page.addInitScript(() => {
    localStorage.setItem("mbx-mode", "dark")
    localStorage.setItem("mbx-dark", "slate")
  })
  await page.goto("/sign-in", { waitUntil: "networkidle" })
  await expect(page.locator("html")).toHaveAttribute("data-theme", "slate")
  // The first theme-color meta wins: the page's own, after hydration too.
  // React's two stay as rendered (one pair, not a second added).
  await expect
    .poll(() =>
      page
        .locator('meta[name="theme-color"]')
        .evaluateAll((metas) =>
          metas.map((meta) => meta.getAttribute("content")),
        ),
    )
    .toEqual(["#0F1216", "#ffffff", "#121212"])
})
