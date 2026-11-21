import { expect, test } from "@playwright/test"

/**
 * The page a visitor lands on from the homepage's "Open Matchbox ID":
 * signed out, the root sends them to sign in. It says what Matchbox ID
 * is, names itself in the title, links its canonical address, and ends
 * with the Matchbox footer links, each at least 40 by 40.
 */

test("a signed-out visitor lands on a sign-in page that says what Matchbox ID is", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))

  await page.goto("/", { waitUntil: "networkidle" })
  await expect(page).toHaveURL(/\/sign-in\?return=%2F$/)
  await expect(page).toHaveTitle("Sign in | Matchbox ID")
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://id.matchbox.markets/sign-in",
  )
  await expect(
    page.getByText(
      "One sign-in for Matchbox and the apps built on it, with your wallet.",
    ),
  ).toBeVisible()

  const footer = page
    .getByRole("contentinfo")
    .getByRole("navigation", { name: "Matchbox" })
  await expect(footer.getByRole("link")).toHaveText([
    "Pro",
    "Matchscan",
    "ID",
    "Developer",
    "Docs",
    "Classic",
    "Privacy",
  ])
  const small = await footer.getByRole("link").evaluateAll((links) =>
    links.flatMap((link) => {
      const box = link.getBoundingClientRect()
      return box.width >= 40 && box.height >= 40
        ? []
        : [
            `${link.textContent} ${Math.round(box.width)}x${Math.round(box.height)}`,
          ]
    }),
  )
  expect(small).toEqual([])
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0)
  expect(errors).toEqual([])
})
