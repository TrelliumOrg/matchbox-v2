import { expect, test } from "@playwright/test"

/** The signed-out footer under the sign-in page. */

test("the sign-in footer's links are at least 40 by 40", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto("/sign-in", { waitUntil: "networkidle" })
  const links = page
    .getByRole("contentinfo")
    .getByRole("navigation", { name: "Matchbox" })
    .getByRole("link")
  await expect(links.first()).toBeVisible()
  const small = await links.evaluateAll((anchors) =>
    anchors.flatMap((anchor) => {
      const box = anchor.getBoundingClientRect()
      return box.width >= 40 && box.height >= 40
        ? []
        : [
            `${anchor.textContent} ${Math.round(box.width)}x${Math.round(box.height)}`,
          ]
    }),
  )
  expect(small).toEqual([])
})

test("the sign-in footer lists the homepage's footer links in its order", async ({
  page,
}) => {
  await page.goto("/sign-in", { waitUntil: "networkidle" })
  await expect(
    page
      .getByRole("contentinfo")
      .getByRole("navigation", { name: "Matchbox" })
      .getByRole("link"),
  ).toHaveText([
    "Pro",
    "Matchscan",
    "ID",
    "Developer",
    "Docs",
    "Classic",
    "Privacy",
  ])
})
