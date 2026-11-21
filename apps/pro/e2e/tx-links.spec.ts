import { expect, test } from "@playwright/test"
import openDialog from "./dialog"

// A transaction's links on the Activity sheet: "View on Matchscan" as the
// button, the smaller "Mezo Explorer" beside it, both in a new tab, both
// whole on a 360px phone. The tx sheet's success and pending states use
// the same component (tx-links.test.tsx, steps.test.ts).

const user = "/0x7c21095156ab25e989c3c084bcb06037c6539e0b"

/**
 * Every link on the page that leaves Pro opens in a new tab, as the
 * transaction links do. Matchbox Classic is the one exception: it is the
 * switch to the other app, not a page to look at beside Pro.
 */
async function expectLinksOutInNewTabs(
  page: import("@playwright/test").Page,
  scope = page.locator("body"),
): Promise<number> {
  const links = await scope.locator("a[href^='http']").evaluateAll((anchors) =>
    anchors.map((anchor) => ({
      href: anchor.getAttribute("href") ?? "",
      target: anchor.getAttribute("target"),
      rel: anchor.getAttribute("rel"),
    })),
  )
  const origin = new URL(page.url()).origin
  const out = links.filter(
    (link) =>
      new URL(link.href).origin !== origin &&
      new URL(link.href).host !== "app.matchbox.markets",
  )
  for (const link of out) {
    expect(link, link.href).toMatchObject({
      target: "_blank",
      rel: "noreferrer noopener",
    })
  }
  return out.length
}

test("links out of Pro open in a new tab: ticker, docs, socials, blocks", async ({
  page,
}, testInfo) => {
  await page.goto("/")
  // The block ticker sits in the corner on a desktop.
  if (testInfo.project.name === "desktop") {
    await expect(
      page.getByRole("link", { name: /view on Matchscan$/ }).first(),
    ).toBeAttached()
  }
  await expect(page.locator("main")).toBeVisible()
  await expectLinksOutInNewTabs(page)
  await page.goto("/gauges/0x4da4c05483324ea9cfc951510a5e77cc79541159")
  await expect(page.getByRole("link", { name: "Website" })).toBeVisible()
  expect(await expectLinksOutInNewTabs(page)).toBeGreaterThanOrEqual(3)
  await page.goto(`${user}/activity`)
  // A confirmed row: its sheet names the block.
  const rows = page.locator("main li button")
  await expect(rows.first()).toBeVisible()
  const sheet = page.getByRole("dialog")
  const block = sheet.getByRole("link", { name: /^Block / })
  for (let index = 0; index < (await rows.count()); index += 1) {
    await openDialog(page, () => rows.nth(index).click())
    if ((await block.count()) > 0) break
    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()
  }
  await expect(block).toBeVisible()
  expect(await expectLinksOutInNewTabs(page, sheet)).toBeGreaterThanOrEqual(3)
})

for (const viewport of [
  { width: 360, height: 740 },
  { width: 1440, height: 900 },
]) {
  test(`an Activity row links Matchscan first and Mezo Explorer at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.goto(`${user}/activity`)
    const row = page.locator("main li button").first()
    await expect(row).toBeVisible()
    await openDialog(page, () => row.click())
    const sheet = page.getByRole("dialog")
    const scan = sheet.getByRole("link", { name: "View on Matchscan" })
    const explorer = sheet.getByRole("link", { name: "Mezo Explorer" })
    await expect(scan).toBeVisible()
    await expect(explorer).toBeVisible()
    const hash = (await scan.getAttribute("href"))?.split("/tx/")[1] ?? ""
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
    await expect(scan).toHaveAttribute(
      "href",
      `https://scan.matchbox.markets/tx/${hash}`,
    )
    await expect(explorer).toHaveAttribute(
      "href",
      `https://explorer.mezo.org/tx/${hash}`,
    )
    for (const link of [scan, explorer]) {
      await expect(link).toHaveAttribute("target", "_blank")
      await expect(link).toHaveAttribute("rel", "noreferrer noopener")
      // Whole: nothing cut off or clipped by the sheet.
      const fits = await link.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const dialog = element.closest("[role=dialog]")?.getBoundingClientRect()
        return (
          element.scrollWidth <= element.clientWidth + 1 &&
          dialog !== undefined &&
          rect.left >= dialog.left &&
          rect.right <= dialog.right
        )
      })
      expect(fits).toBe(true)
    }
    // The primary reads as primary: the button is the taller, larger one.
    const [scanBox, explorerBox] = await Promise.all([
      scan.boundingBox(),
      explorer.boundingBox(),
    ])
    expect(scanBox?.height ?? 0).toBeGreaterThan(explorerBox?.height ?? 0)
  })
}
