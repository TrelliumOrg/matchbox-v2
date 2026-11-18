import { expect, type Page, test } from "@playwright/test"

/**
 * Wallet links by Mezo ID (`/pyke.mezo/vote`), each hard-loaded: the Worker
 * resolves the ID through the API's resolver (fixtures: pyke.mezo is the
 * demo wallet, down.mezo plays Mezo's API down) before the router runs.
 * An unknown ID is the not found page; a lookup that failed is a 503 to
 * try again.
 */

const demo = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"

/** Uncaught exceptions only: a 404 document may log its own status. */
function watchCrashes(page: Page): string[] {
  const crashes: string[] = []
  page.on("pageerror", (error) => crashes.push(error.message))
  return crashes
}

test("a Mezo ID link opens that wallet and keeps its clean URL", async ({
  page,
  isMobile,
}) => {
  const crashes = watchCrashes(page)
  const response = await page.goto("/pyke.mezo/vote")
  expect(response?.status()).toBe(200)
  // The demo wallet's veMEZO lock, voted this epoch.
  await expect(page.getByRole("checkbox", { name: /#2207/ })).toBeVisible()
  await expect(page).toHaveURL(/\/pyke\.mezo\/vote$/)
  await expect(page.locator('meta[name="mbx-wallet-names"]')).toHaveAttribute(
    "content",
    `pyke.mezo=${demo}`,
  )
  await page.waitForLoadState("networkidle")
  if (!isMobile) {
    const nav = page
      .getByRole("navigation", { name: "Pro" })
      .filter({ visible: true })
    await nav.getByRole("link", { name: "Rewards" }).click()
    await expect(page).toHaveURL(/\/pyke\.mezo\/rewards$/)
    await expect(page.getByText("Ready to claim, Epoch 46")).toBeVisible()
  }
  expect(crashes).toEqual([])
})

test("a Mezo ID link reads the same in any case", async ({ page }) => {
  const response = await page.goto("/Pyke.Mezo/rewards")
  expect(response?.status()).toBe(200)
  await expect(page.getByText("Ready to claim, Epoch 46")).toBeVisible()
})

test("a Mezo ID link while the lookup is down says to try again", async ({
  page,
}) => {
  const crashes = watchCrashes(page)
  const response = await page.goto("/down.mezo/vote")
  expect(response?.status()).toBe(503)
  expect(response?.headers()["cache-control"]).toBe("no-store")
  await expect(
    page.getByRole("heading", { name: "Wallet lookup unavailable" }),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible()
  await page.waitForLoadState("networkidle")
  expect(crashes).toEqual([])
})

test("the lookup's failure stays on its page, not the tab", async ({
  page,
}) => {
  const crashes = watchCrashes(page)
  await page.goto("/down.mezo/vote")
  await expect(
    page.getByRole("heading", { name: "Wallet lookup unavailable" }),
  ).toBeVisible()
  await page.waitForLoadState("networkidle")
  // In the same tab, without a page load, to a genuinely unknown ID: the
  // router follows a history entry as it would Back or Forward.
  await page.evaluate(() => {
    window.history.pushState(window.history.state, "", "/nobody.mezo/vote")
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: window.history.state }),
    )
  })
  await expect(page).toHaveURL(/\/nobody\.mezo\/vote$/)
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Wallet lookup unavailable" }),
  ).toHaveCount(0)
  expect(crashes).toEqual([])
})

test("headers only the Worker sets are ignored from a browser", async ({
  page,
  request,
}) => {
  // A forged name for the demo wallet would turn its links into that name.
  const forged = await request.get(`/${demo}/vote`, {
    headers: { "x-mbx-wallet-names": `evil.mezo=${demo}` },
  })
  expect(forged.status()).toBe(200)
  const html = await forged.text()
  expect(html).not.toContain("evil.mezo")
  expect(html).not.toContain('name="mbx-wallet-names"')
  // A forged "lookup failed" does not turn a missing ID into a 503.
  await page.setExtraHTTPHeaders({ "x-mbx-wallet-lookup": "unavailable" })
  const missing = await page.goto("/nobody.mezo/vote")
  expect(missing?.status()).toBe(404)
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible()
})

for (const { name, path } of [
  { name: "an unknown Mezo ID", path: "/nobody.mezo/vote" },
  { name: "an ID Mezo refuses", path: "/pyke_1.mezo/vote" },
]) {
  test(`${name} shows the not found page`, async ({ page }) => {
    const crashes = watchCrashes(page)
    const response = await page.goto(path)
    expect(response?.status()).toBe(404)
    await expect(
      page.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect(crashes).toEqual([])
  })
}
