import { expect, test } from "@playwright/test"

import {
  fixtureAddress as address,
  fixtureTx as hash,
} from "../scripts/routes.mjs"

/**
 * How Matchscan presents what it reads: names, headings and figures as
 * people read them, each page loaded whole (`page.goto`), as a pasted link
 * or a reload would.
 */

test("a swap names its pool by pair and pool type", async ({ page }) => {
  await page.goto(`/tx/${hash}`)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Swapped 5.00 mUSDC in mUSDC/MUSD Stable",
  )
  await expect(page).toHaveTitle(
    /^Swapped 5\.00 mUSDC in mUSDC\/MUSD Stable 0x45e0962d…/,
  )
})

test("Home and Borrow name the positions each counts", async ({ page }) => {
  await page.goto("/")
  const tiles = page.getByRole("region", { name: "Mezo at a glance" })
  const loans = tiles
    .getByRole("listitem")
    .filter({ hasText: "Open MUSD loans" })
  await expect(loans).toContainText("6")
  await expect(tiles.getByText("Open positions")).toHaveCount(0)
  await page.goto("/borrow")
  const borrow = page.getByRole("definition").filter({ hasText: "Morpho (" })
  await expect(borrow).toHaveText("1 Enclave, 4 Morpho (2 MUSD), 3 troves")
  await expect(
    page.getByRole("term").filter({ hasText: "Open positions" }),
  ).toHaveCount(1)
})

test.describe("at 360 wide", () => {
  test.skip(({ isMobile }) => !isMobile, "phone layout")
  test.use({ viewport: { width: 360, height: 740 } })

  /** Text an ellipsis cuts on the page: elements whose text overflows. */
  async function cutTexts(page: import("@playwright/test").Page) {
    return page.evaluate(() =>
      [...document.querySelectorAll("main *")]
        .filter(
          (element) =>
            getComputedStyle(element).textOverflow === "ellipsis" &&
            element.scrollWidth > element.clientWidth + 1,
        )
        .map((element) => element.textContent?.trim() ?? ""),
    )
  }

  for (const path of ["/borrow/liquidations", "/borrow/troves", "/borrow"]) {
    test(`${path} never cuts an amount`, async ({ page }) => {
      await page.goto(path)
      const amounts = (await cutTexts(page)).filter((text) => /\d/.test(text))
      expect(amounts).toEqual([])
    })
  }

  test("/gauges never cuts a gauge's name", async ({ page }) => {
    await page.goto("/gauges")
    const table = page.getByRole("table", { name: "All gauges" })
    await expect(table).toBeVisible()
    const cut = await table.evaluate((root) =>
      [...root.querySelectorAll("a[href^='/gauges/'], a[href^='/gauges/'] *")]
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map((element) => element.textContent?.trim() ?? ""),
    )
    expect(cut).toEqual([])
    const figures = (await cutTexts(page)).filter((text) => /\d/.test(text))
    expect(figures).toEqual([])
  })
})

test.describe("under a finger at 360 wide", () => {
  test.skip(({ isMobile }) => !isMobile, "touch layout")
  test.use({ viewport: { width: 360, height: 740 } })

  /**
   * The control a tap lands on 18px left, right, above and below a
   * control's centre: each must be the control, so its hit area is at
   * least 36 by 36 wherever it sits (44 by 44 with `data-tap`).
   */
  async function reaches(
    locator: import("@playwright/test").Locator,
  ): Promise<boolean> {
    return locator.evaluate((element) => {
      // Clear of the sticky top bar and the tab bar.
      element.scrollIntoView({ block: "center" })
      const box = element.getBoundingClientRect()
      const x = box.left + box.width / 2
      const y = box.top + box.height / 2
      return [
        [x - 18, y],
        [x + 18, y],
        [x, y - 18],
        [x, y + 18],
      ].every(([px = 0, py = 0]) => {
        const hit = document.elementFromPoint(px, py)
        return hit !== null && (hit === element || element.contains(hit))
      })
    })
  }

  for (const path of ["/network", "/locks", "/tokens/musd"]) {
    test(`${path} range chips and custom period take a fingertip`, async ({
      page,
    }) => {
      await page.goto(path)
      const nav = page.getByRole("navigation", { name: /period/i }).first()
      await nav.scrollIntoViewIfNeeded()
      for (const name of ["30d", "90d", "All"]) {
        expect(await reaches(nav.getByRole("link", { name }))).toBe(true)
      }
      const custom = nav.getByRole("button", { name: /Custom period/ })
      await expect(custom).toBeVisible()
      expect(await reaches(custom)).toBe(true)
    })
  }

  test("a copy button takes a fingertip", async ({ page }) => {
    await page.goto(`/tx/${hash}`)
    const copy = page.getByRole("button", { name: "Copy hash" }).first()
    expect(await reaches(copy)).toBe(true)
  })

  test("a transaction row is one target", async ({ page }) => {
    await page.goto("/network/transactions")
    const table = page.getByRole("table", { name: "Latest transactions" })
    const rows = table.locator("tbody tr")
    expect(await rows.count()).toBeGreaterThan(0)
    const misses = await rows.evaluateAll((all) =>
      all.flatMap((row, index) => {
        row.scrollIntoView({ block: "center" })
        const box = row.getBoundingClientRect()
        // A blank spot: the row's right edge, half way down.
        const hit = document.elementFromPoint(
          box.right - 6,
          box.top + box.height / 2,
        )
        const link = hit?.closest("a")
        return link?.getAttribute("href")?.startsWith("/tx/") === true &&
          row.contains(link)
          ? []
          : [index]
      }),
    )
    expect(misses).toEqual([])
  })
})

test("Gauges says which open-epoch figure has the fees", async ({ page }) => {
  await page.goto("/gauges")
  await expect(page.getByText("Epoch 47 incentives so far")).toBeVisible()
  await expect(page.getByText("Epoch 47 with fees so far")).toBeVisible()
  await expect(page.getByText("Epoch 47 posted")).toHaveCount(0)
})

test("a token's log reads its amount in the token", async ({ page }) => {
  await page.goto(`/tx/${hash}`)
  await expect(
    page.getByText("5.04 MUSD (5042176961077758777)", { exact: true }),
  ).toBeVisible()
})

test("the footer links the privacy policy", async ({ page, isMobile }) => {
  await page.goto("/")
  if (isMobile) {
    await page.getByRole("button", { name: "More" }).click()
  }
  const privacy = page
    .getByRole("link", { name: "Privacy", exact: true })
    .filter({ visible: true })
  await expect(privacy).toHaveAttribute(
    "href",
    "https://matchbox.markets/privacy",
  )
})

test("an address heading says the address once, and only it", async ({
  page,
}) => {
  await page.goto(`/address/${address}`)
  const heading = page.getByRole("heading", { level: 1 })
  await expect(heading).toHaveAccessibleName(address)
  await expect(heading.getByRole("button")).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Copy address" }).first(),
  ).toBeVisible()
})

test("a gauge's heading and title name it with its lock, spaced", async ({
  page,
}) => {
  await page.goto("/gauges/0x4da4c05483324ea9cfc951510a5e77cc79541159")
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
    "Kiln Labs #7",
  )
  await expect(page).toHaveTitle("Kiln Labs #7, Matchscan")
})
