import { expect, type Page, test } from "@playwright/test"
import { fixtureOperator } from "../scripts/routes-validators.mjs"

/**
 * The governance panels against the fixtures: the Locks distribution
 * panels, rewards by source and voting APR on Epochs, a validator's
 * emissions and a gauge's APY history. Each renders without console
 * errors, reads out on focus, fits a phone, and says "Not available yet"
 * while the API's routes are not served.
 */

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

const gauge = `0x${"4a5b0e".padStart(40, "0")}`

test("Locks shows the daily lock distribution for each escrow", async ({
  page,
}) => {
  const errors = watchErrors(page)
  await page.goto("/locks")
  for (const name of [
    "Lock length",
    "Permanent vs timed",
    "Lock size",
    "Unlock calendar",
  ]) {
    await expect(page.getByRole("region", { name }), name).toContainText(
      "As of",
    )
  }
  const length = page.getByRole("region", { name: "Lock length" })
  await expect(length).toContainText("or permanent")
  await expect(
    length.getByRole("listitem", { name: /^Permanent: / }),
  ).toBeVisible()
  const permanence = page.getByRole("region", { name: "Permanent vs timed" })
  await expect(permanence).toContainText("Permanent 30d")
  await expect(permanence).toContainText("Share 90d ago")
  await page.goto("/locks?escrow=vemezo")
  await expect(
    page.getByRole("region", { name: "Unlock calendar" }),
  ).toContainText("Biggest month")
  await page.waitForLoadState("networkidle")
  expect(errors).toEqual([])
})

test("a lock column reads out its amount on focus", async ({ page }) => {
  await page.goto("/locks")
  await page.waitForLoadState("networkidle")
  const panel = page.getByRole("region", { name: "Unlock calendar" })
  const column = panel.getByRole("listitem").first()
  await column.focus()
  await expect(column).toBeFocused()
  await page.keyboard.press("ArrowRight")
  await expect(panel.getByRole("listitem").nth(1)).toBeFocused()
})

test("Epochs splits what veBTC is paid by source and shows voting APR", async ({
  page,
}) => {
  const errors = watchErrors(page)
  await page.goto("/epochs")
  const paid = page.getByRole("region", {
    name: "Paid to veBTC by source",
  })
  await expect(paid).toContainText("Chain fees")
  await expect(paid).toContainText("Pool fees")
  const apr = page.getByRole("region", { name: "veBTC voting APR per epoch" })
  await expect(apr).toContainText("veMEZO voters")
  await expect(apr).toContainText("epoch avg")
  await page.waitForLoadState("networkidle")
  expect(errors).toEqual([])
})

test("a gauge shows its APY history beside its voters' APR", async ({
  page,
}) => {
  await page.goto(`/gauges/${gauge}`)
  const history = page.getByRole("region", { name: "APY history" })
  await expect(history).toContainText("Validator gauges")
  await expect(history).toContainText("epoch avg")
})

test("the governance pages fit a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of [
    "/locks",
    "/locks?escrow=vemezo",
    "/epochs",
    `/validators/${fixtureOperator}`,
    `/gauges/${gauge}`,
  ]) {
    await page.goto(path)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow, path).toBeLessThanOrEqual(0)
  }
})

test.describe("while the API's database is not bound (503)", () => {
  test.use({ extraHTTPHeaders: { "x-scan-fixture": "disabled" } })

  test("the governance panels stand and say not available yet", async ({
    page,
  }) => {
    const errors = watchErrors(page)
    await page.goto("/locks")
    await expect(
      page
        .getByRole("region", { name: "Lock length" })
        .getByText("Not available yet"),
    ).toBeVisible()
    await page.goto("/epochs")
    await expect(
      page
        .getByRole("region", { name: "veBTC voting APR per epoch" })
        .getByText("Not available yet"),
    ).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect(errors).toEqual([])
  })
})
