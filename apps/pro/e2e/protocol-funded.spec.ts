import { expect, test } from "@playwright/test"

/**
 * Protocol's "Funded this epoch" (P7, 19 Nov 2026): pools that share a
 * pair read the same ("BTC/MUSD" twice), and a pool row's line under its
 * name was an icon over nothing.
 */
test("a funded pool row names its type and has a line under it", async ({
  page,
}) => {
  await page.goto("/protocol")
  const funded = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Funded this epoch" }) })
  const row = funded
    .getByRole("listitem")
    .filter({ hasText: "BTC/MUSD Volatile" })
  await expect(row).toBeVisible()
  await expect(row.getByText("0xb7c0…d00d")).toBeVisible()
  await expect(funded.getByText("mUSDC/MUSD Stable")).toBeVisible()
  // Every row's line has text, never an icon alone.
  const lines = await funded.getByRole("listitem").evaluateAll((items) =>
    items.map(
      // The title's paragraph, then the line under it.
      (item) => item.querySelector("p + p")?.textContent?.trim() ?? "",
    ),
  )
  expect(lines.length).toBeGreaterThan(0)
  for (const line of lines) expect(line).not.toBe("")
})
