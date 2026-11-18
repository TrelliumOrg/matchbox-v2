import { expect, type Page, test } from "@playwright/test"

import {
  fixtureOperator,
  fixtureOutsideProposer,
} from "../scripts/routes-validators.mjs"

/**
 * The Validators pages against the fixtures: each renders without console
 * errors and shows the fixtures' figures, proposers are matched to the set
 * by operator (the one outside it is listed, not guessed), what has no
 * source says "Not available yet", the pages degrade while the API's
 * database is not bound, and each keeps one canonical URL.
 */

/** Fails the test on any console error or uncaught exception. */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

const pages = [
  { path: "/validators", heading: "Validators", figure: "124.0000 veBTC" },
  {
    path: "/validators?epoch=46&sort=proposed",
    heading: "Validators",
    figure: "Epoch 46",
  },
  {
    path: `/validators/${fixtureOperator}`,
    heading: /Harbor Stake/,
    figure: "22.3%",
  },
]

for (const each of pages) {
  test(`${each.path} renders its figures without console errors`, async ({
    page,
  }) => {
    const errors = watchErrors(page)
    const response = await page.goto(each.path)
    expect(response?.status()).toBe(200)
    await expect(
      page.getByRole("heading", { level: 1, name: each.heading }),
    ).toBeVisible()
    await expect(
      page.getByText(each.figure).filter({ visible: true }).first(),
    ).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect(errors).toEqual([])
  })
}

test("the list shows blocks per day with shares, and names the day", async ({
  page,
  isMobile,
}) => {
  await page.goto("/validators")
  const table = page.getByRole("table", { name: "All validators" })
  await expect(table.getByText("Harbor Stake")).toBeVisible()
  await expect(table.getByText("Left the set")).toBeVisible()
  await expect(
    table.getByRole("columnheader", { name: "Blocks, about Sun 8 Nov" }),
  ).toBeVisible()
  // Phones reflow the table to its title, share, status and incentives.
  if (!isMobile) await expect(table.getByText("10,944")).toBeVisible()
  // Shares of every block on the day, the rest unattributed.
  await expect(page.getByText("24,965 blocks on about Sun 8 Nov")).toBeVisible()
  await expect(table.getByText("Unattributed", { exact: true })).toBeVisible()
  await expect(page.getByText(/^Validators Matchscan has seen/)).toContainText(
    "Shares are of every block on the day",
  )
  const outside = page.getByRole("region", {
    name: "Proposers without a validator gauge",
  })
  await expect(outside.getByRole("link", { name: /0xd056/ })).toHaveAttribute(
    "href",
    `/validators/${fixtureOutsideProposer}`,
  )
})

test("a proposer without a gauge has a page with its blocks", async ({
  page,
}) => {
  const response = await page.goto(`/validators/${fixtureOutsideProposer}`)
  expect(response?.status()).toBe(200)
  await expect(page.getByText("No validator gauge")).toBeVisible()
  await expect(page.getByText("240", { exact: true })).toBeVisible()
})

test("what has no source says so", async ({ page }) => {
  await page.goto("/validators")
  for (const label of ["Unclaimed by validators", "Voter concentration"]) {
    await expect(
      page.getByRole("region", { name: label }).getByText("Not available yet"),
      label,
    ).toBeVisible()
  }
  // Emissions are served; what validators claimed is not indexed.
  await expect(
    page.getByRole("region", { name: "Emissions to validators" }),
  ).toContainText("MEZO")
  await page.goto(`/validators/${fixtureOperator}`)
  const emissions = page.getByRole("region", {
    name: "Emissions earned per epoch",
  })
  await expect(emissions).toContainText("MEZO")
  await expect(emissions).toContainText("Not indexed")
})

test("uptime shows its figures, its node and its freshness", async ({
  page,
  isMobile,
}) => {
  await page.goto(`/validators/${fixtureOperator}`)
  const uptime = page.getByRole("region", { name: "Uptime" })
  await expect(uptime.getByText("99.94%", { exact: true })).toBeVisible()
  await expect(uptime.getByText("12 blocks missed in 24 hours")).toBeVisible()
  await expect(
    uptime.getByText("From a community node (Pathrock), 2 minutes ago"),
  ).toBeVisible()
  await expect(
    uptime.getByRole("list", { name: "Newest blocks, oldest first" }),
  ).toBeVisible()
  // A phone row's four places are taken, so the list has no uptime
  // column there: the figure is on the validator's own page (above).
  if (isMobile) return
  await page.goto("/validators?sort=uptime")
  await expect(
    page.getByRole("columnheader", { name: "Uptime, 24h" }),
  ).toBeVisible()
  await expect(page.getByText("99.94%", { exact: true })).toBeVisible()
})

test.describe("while the uptime node is behind", () => {
  test.use({ extraHTTPHeaders: { "x-scan-fixture": "delayed" } })

  test("says uptime is paused and shows no figure as current", async ({
    page,
  }) => {
    await page.goto(`/validators/${fixtureOperator}`)
    const uptime = page.getByRole("region", { name: "Uptime" })
    await expect(
      uptime.getByText("Uptime paused: the node we read is behind"),
    ).toBeVisible()
    await expect(uptime.getByText(/Figures run to/)).toBeVisible()
    await page.goto("/validators")
    await expect(page.getByText("Paused").first()).toBeVisible()
  })
})

test("a validator links to its gauge and votes on Matchbox Pro", async ({
  page,
}) => {
  await page.goto(`/validators/${fixtureOperator}`)
  const vote = page.getByRole("link", { name: "Vote on Matchbox" }).first()
  await expect(vote).toHaveAttribute(
    "href",
    /^https:\/\/pro\.matchbox\.markets\/vote\/validators\?pick=0x[0-9a-f]{40}$/,
  )
  await page
    .getByRole("region", { name: "Validator" })
    .getByRole("link", { name: /^0x0000/ })
    .last()
    .click()
  await expect(page).toHaveURL(/\/gauges\/0x[0-9a-f]{40}$/)
})

test("addresses that propose nothing and bad ids are not found", async ({
  page,
}) => {
  for (const path of [
    `/validators/0x${"12".repeat(20)}`,
    "/validators/not-an-address",
  ]) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(404)
  }
})

test("an operator redirects to its lower-case form", async ({ page }) => {
  const from = `/validators/${fixtureOperator.toUpperCase().replace("0X", "0x")}`
  const response = await page.request.get(from, { maxRedirects: 0 })
  expect(response.status()).toBe(301)
  expect(new URL(response.headers().location ?? "", "http://x").pathname).toBe(
    `/validators/${fixtureOperator}`,
  )
})

test("both pages move with the chain", async ({ baseURL }) => {
  for (const path of ["/validators", `/validators/${fixtureOperator}`]) {
    const response = await fetch(`${baseURL}${path}`)
    expect(response.headers.get("cache-control"), path).toContain("s-maxage=4,")
  }
})

test("no validators page scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const each of pages) {
    await page.goto(each.path)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow, each.path).toBeLessThanOrEqual(0)
  }
})

test.describe("while the API's database is not bound (503)", () => {
  test.use({ extraHTTPHeaders: { "x-scan-fixture": "disabled" } })

  test("the pages stand, their sections say not available yet", async ({
    page,
  }) => {
    for (const each of [
      { path: "/validators", heading: "Validators" },
      { path: `/validators/${fixtureOperator}`, heading: /Validator/ },
    ]) {
      const errors = watchErrors(page)
      const response = await page.goto(each.path)
      expect(response?.status(), each.path).toBe(200)
      expect(response?.headers()["cache-control"], each.path).toBe("no-store")
      await expect(
        page.getByRole("heading", { level: 1, name: each.heading }),
      ).toBeVisible()
      await expect(page.getByText("Not available yet").first()).toBeVisible()
      await page.waitForLoadState("networkidle")
      expect(errors, each.path).toEqual([])
    }
  })
})

test.describe("before the second daily read of the counters", () => {
  test.use({ extraHTTPHeaders: { "x-scan-fixture": "filling" } })

  test("blocks per day say not available yet, with the reason", async ({
    page,
  }) => {
    for (const path of ["/validators", `/validators/${fixtureOperator}`]) {
      const response = await page.goto(path)
      expect(response?.status(), path).toBe(200)
      await expect(
        page.getByText(/two daily reads/).first(),
        path,
      ).toBeVisible()
    }
    await page.goto("/validators")
    await expect(
      page.getByText("Blocks per day: not available yet", { exact: true }),
    ).toBeVisible()
  })
})

test.describe("a new epoch before its votes are counted", () => {
  test.use({ extraHTTPHeaders: { "x-scan-fixture": "filling" } })

  test("its vote figures say not available yet, never none", async ({
    page,
  }) => {
    await page.goto("/validators")
    const share = page.getByRole("region", { name: "Vote share by validator" })
    await expect(share.getByText("Not available yet")).toBeVisible()
    await expect(page.getByText("No validator votes this epoch")).toHaveCount(0)
    await expect(page.getByText("No votes", { exact: true })).toHaveCount(0)
    await page.goto(`/validators/${fixtureOperator}`)
    await expect(
      page.getByText("This epoch's votes are still being counted"),
    ).toBeVisible()
  })
})
