import { inspectable } from "@matchbox/ui/inspect-e2e"
import { expect, type Locator, test } from "@playwright/test"
import { fixtureGauge } from "../scripts/routes-voting.mjs"

/**
 * Dollar values on the voting pages, against the fixtures: what voters
 * were paid per epoch (incentives and fees at each epoch's closing daily
 * price), emissions and deposits in USD, and the gauge's incentive
 * figures. The stacked bars read into their panel's figure.
 */

function panel(page: import("@playwright/test").Page, name: string): Locator {
  return page.getByRole("region", { name })
}

test("Gauges shows what voters were paid per epoch, in USD", async ({
  page,
}) => {
  await page.goto("/gauges")
  const paid = panel(page, "Paid to voters by epoch")
  await expect(paid.getByText("$7,332").first()).toBeVisible()
  await expect(paid.getByText("All epochs")).toBeVisible()
  await expect(paid.getByText("$58,788")).toBeVisible()
  await expect(
    panel(page, "MEZO emissions by epoch").getByText("Epoch 47, $352.5k"),
  ).toBeVisible()
})

test("Epochs shows rewards to voters and the current epoch in USD", async ({
  page,
  isMobile,
}) => {
  await page.goto("/epochs")
  const rewards = panel(page, "Rewards to voters per epoch")
  await expect(rewards.getByText("$58,788").first()).toBeVisible()
  await expect(rewards.getByText("From incentives")).toBeVisible()
  await expect(page.getByText("Fees to voters so far")).toBeVisible()
  await expect(page.getByText("$352.5k").first()).toBeVisible()
  // Phones fold the table's money columns away (the epoch page has them).
  if (isMobile) return
  const table = page.getByRole("table", { name: "Epochs" })
  await expect(table.getByText("$7,220")).toBeVisible()
})

test("an epoch prices its emissions, incentives and deposits", async ({
  page,
}) => {
  await page.goto("/epochs/47")
  await expect(panel(page, "Emissions").getByText("$352.5k")).toBeVisible()
  const incentives = panel(page, "Incentives posted")
  await expect(incentives.getByText("$7,220")).toBeVisible()
  await expect(incentives.getByText("$1,128.70")).toBeVisible()
})

test("a gauge shows its incentive figures in USD", async ({ page }) => {
  await page.goto(`/gauges/${fixtureGauge}`)
  const incentives = panel(page, "Incentives per epoch")
  await expect(incentives.getByText("Per 1k veMEZO")).toBeVisible()
  await expect(incentives.getByText("$0.20")).toBeVisible()
  await expect(incentives.getByText("Depositors")).toBeVisible()
  await expect(page.getByText("+0.31 pts vs Epoch 46")).toBeVisible()
  await expect(page.getByText("$1,128.70").first()).toBeVisible()
})

test("Validators and Locks show USD", async ({ page }) => {
  await page.goto("/validators")
  await expect(page.getByText("$760").first()).toBeVisible()
  await page.goto("/locks")
  await expect(panel(page, "BTC locked").getByText("In USD")).toBeVisible()
})

test.describe("stacked epoch bars", () => {
  test.skip(({ isMobile }) => isMobile, "hover is a pointer's")

  test("read an epoch's total into the panel's figure", async ({ page }) => {
    await page.goto("/gauges")
    const paid = panel(page, "Paid to voters by epoch")
    const bars = paid.locator("[data-inspect-point]")
    const first = bars.first()
    const value = await first.getAttribute("data-inspect-value")
    expect(value).toMatch(/^\$/)
    await inspectable(page)
    await first.hover()
    await expect(
      paid.locator('[data-inspect-slot="value"] > [data-inspect-live]'),
    ).toHaveText(value ?? "")
  })
})

test("Network shows value locked and DEX volume in USD", async ({ page }) => {
  await page.goto("/network")
  const tvl = panel(page, "Total value locked")
  await expect(tvl.getByText(/^\$[\d.]+[kMB]?$/).first()).toBeVisible()
  await expect(tvl.getByText("veBTC").first()).toBeVisible()
  const dex = panel(page, "DEX volume")
  await expect(dex.getByText("Liquidity")).toBeVisible()
  await expect(dex.getByRole("list", { name: "Volume by pool" })).toBeVisible()
  // The total is the chart's: the vault stands beside it.
  await expect(
    tvl.getByText(/^Savings vault \$[\d.]+[kMB]?, not in the total$/),
  ).toBeVisible()
  await expect(panel(page, "Addresses").getByText("Added 7d")).toBeVisible()
})

test("Tokens values the tokens on Mezo and the stablecoins", async ({
  page,
}) => {
  await page.goto("/tokens")
  const value = panel(page, "Value on Mezo")
  await expect(
    value.getByRole("list", { name: "Value by token" }),
  ).toBeVisible()
  await expect(value.getByText("Not counted, no price: MUSD")).toBeVisible()
  await expect(
    panel(page, "Stablecoins on Mezo").getByText("mUSDC"),
  ).toBeVisible()
})

test("MEZO splits its supply and where emissions go", async ({ page }) => {
  await page.goto("/tokens/mezo")
  await expect(
    panel(page, "Where MEZO's supply sits").getByText("Emitted all time", {
      exact: true,
    }),
  ).toBeVisible()
  const emissions = panel(page, "Where emissions go")
  await expect(emissions.getByText("To gauges")).toBeVisible()
  await expect(emissions.getByText("Rebase to veMEZO")).toBeVisible()
})

test("MUSD's savings vault and where it sits load after first paint", async ({
  page,
}) => {
  await page.goto("/tokens/musd")
  await expect(panel(page, "Where MUSD sits")).toBeVisible()
  await expect(
    panel(page, "Net into the savings vault per day").getByText(
      "Deposited 30d",
    ),
  ).toBeVisible()
})

test("a Mezo pool shows its volume, votes and reserves", async ({ page }) => {
  await page.goto("/pools/0x9cbc1537d255768b431488305b1c7efc2ac95022")
  await expect(
    panel(page, "Volume and fees").getByText("Volume to reserves"),
  ).toBeVisible()
  await expect(
    panel(page, "veBTC votes per epoch").getByText("Voter APY"),
  ).toBeVisible()
  await expect(
    panel(page, "Reserves").getByText("at the latest closes"),
  ).toBeVisible()
  await expect(page.getByText("Fees 24h")).toBeVisible()
  await expect(page.getByText("88.10 veBTC").first()).toBeVisible()
})
