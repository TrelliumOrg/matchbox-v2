import { expect, type Page, test } from "@playwright/test"
import { getAddress } from "viem"
import { anvilUrl, client, testWallet, tokenBalance, tokens } from "./chain"
import { movedWallet, sendRecipient } from "./mock-api"
import { installForkWallet } from "./wallet"

/**
 * The Account panel's Send against the fork: MUSD (an ERC-20 transfer) and
 * native BTC (a value transfer), each through the review, the wallet prompt
 * and the confirmed transaction, checked on chain. Then the Network setting
 * pointed at the fork's RPC, which Test must accept as Mezo mainnet.
 */

test.describe.configure({ mode: "serial" })

const recipient = getAddress("0x000000000000000000000000000000000000bEEF")

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

async function connect(page: Page): Promise<void> {
  await installForkWallet(page, { address: testWallet, rpcUrl: anvilUrl })
  await page.goto("/")
  const drawer = page.getByRole("dialog", { name: "Connect wallet" })
  await expect(async () => {
    await page.getByRole("button", { name: "Connect wallet" }).first().click()
    await expect(drawer).toBeVisible({ timeout: 2_000 })
  }).toPass()
  await drawer.getByRole("button", { name: /Fork Wallet/ }).click()
  // Your own wallet uses plain paths, remembered in a first-party cookie.
  await expect(page).not.toHaveURL(/address=/)
  expect(await page.evaluate(() => document.cookie)).toContain(
    `mbx-wallet=${testWallet.toLowerCase()}`,
  )
  await expect(drawer).toBeHidden()
}

async function openPanel(page: Page) {
  await page.getByRole("button", { name: /^Account / }).click()
  const panel = page
    .getByRole("dialog")
    .filter({ has: page.getByText("Net worth", { exact: true }) })
  await expect(panel).toBeVisible()
  return panel
}

async function send(
  page: Page,
  input: { symbol: "MUSD" | "BTC"; amount: string; label: string },
): Promise<void> {
  const panel = await openPanel(page)
  await panel.getByRole("button", { name: "Send", exact: true }).click()
  const sheet = page.getByRole("dialog", { name: "Send" })
  await expect(sheet).toBeVisible()
  await sheet.getByRole("radio", { name: input.symbol }).click()
  await expect(sheet.getByText(/^Balance \d/)).toBeVisible()
  await sheet.getByLabel("You send").fill(input.amount)
  await sheet.getByRole("textbox", { name: "To" }).fill(recipient)
  await expect(sheet.getByText("0x0000…beef", { exact: false })).toBeVisible()
  await sheet.getByRole("button", { name: "Review" }).click()
  const review = page.getByRole("dialog", { name: "Review" })
  await expect(review.getByText(`Send ${input.label}`)).toBeVisible()
  await review.getByRole("button", { name: "Send", exact: true }).click()
  const done = page.getByRole("dialog")
  await expect(done.getByRole("heading", { name: "Sent" }).last()).toBeVisible({
    timeout: 60_000,
  })
  await expect(
    page.getByRole("status").filter({ hasText: "View on Matchscan" }),
  ).toBeVisible()
  await done.getByRole("button", { name: "Done" }).click()
  await expect(done).toBeHidden()
}

test("sends MUSD to an address", async ({ page }) => {
  const errors = watchErrors(page)
  await connect(page)
  const before = await tokenBalance(tokens.musd, recipient)
  await send(page, { symbol: "MUSD", amount: "25", label: "25.00 MUSD" })
  expect(await tokenBalance(tokens.musd, recipient)).toBe(
    before + 25n * 10n ** 18n,
  )
  expect(errors).toEqual([])
})

test("sends native BTC to an address", async ({ page }) => {
  await connect(page)
  const before = await client.getBalance({ address: recipient })
  await send(page, { symbol: "BTC", amount: "0.01", label: "0.0100 BTC" })
  expect(await client.getBalance({ address: recipient })).toBe(
    before + 10n ** 16n,
  )
})

test("tests and saves the fork as a custom RPC", async ({ page }) => {
  await connect(page)
  const panel = await openPanel(page)
  await panel.getByRole("button", { name: /^Network/ }).click()
  // The Network view replaces the panel's main view (no "Net worth" there).
  const network = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("radio", { name: /Custom RPC/ }) })
  await network.getByRole("radio", { name: /Custom RPC/ }).click()
  await network.getByRole("textbox", { name: "RPC URL" }).fill(anvilUrl)
  await network.getByRole("button", { name: "Test" }).click()
  await expect(
    network.getByText(/^Mezo mainnet, block [\d,]+, \d+ ms$/),
  ).toBeVisible()
  await network.getByRole("button", { name: "Save" }).click()
  await expect(
    page.getByRole("dialog").getByRole("button", { name: /^Network/ }),
  ).toContainText("Custom RPC")
  const stored = await page.evaluate(() =>
    window.localStorage.getItem("mbx-settings"),
  )
  expect(stored).toContain(anvilUrl)
})

test("sends to a Mezo ID, and confirms again when its wallet moved", async ({
  page,
}) => {
  const errors = watchErrors(page)
  await connect(page)
  const before = await tokenBalance(tokens.musd, movedWallet)
  const shownBefore = await tokenBalance(tokens.musd, sendRecipient)
  const panel = await openPanel(page)
  await panel.getByRole("button", { name: "Send", exact: true }).click()
  const sheet = page.getByRole("dialog", { name: "Send" })
  await sheet.getByRole("radio", { name: "MUSD" }).click()
  await expect(sheet.getByText(/^Balance \d/)).toBeVisible()
  await sheet.getByLabel("You send").fill("5")
  // Bare text is never an ID.
  await sheet.getByRole("textbox", { name: "To" }).fill("moved")
  await expect(
    sheet.getByText("Add .mezo for a Mezo ID, or use a 0x address"),
  ).toBeVisible()
  // While typing, the display lookup shows the wallet it knew.
  await sheet.getByRole("textbox", { name: "To" }).fill("moved.mezo")
  await expect(sheet.getByText("0x0000…beef")).toBeVisible()
  await sheet.getByRole("button", { name: "Review" }).click()
  // At review the ID is read again: it now points elsewhere, so the review
  // stops with the new address and nothing to sign.
  const dialog = page.getByRole("dialog")
  await expect(
    dialog.getByText(
      "moved.mezo now points to a different address. Check it before you send.",
    ),
  ).toBeVisible()
  await expect(dialog.getByText(movedWallet)).toBeVisible()
  await expect(
    dialog.getByRole("button", { name: "Send", exact: true }),
  ).toHaveCount(0)
  await dialog.getByRole("button", { name: "Review again" }).click()
  const review = page.getByRole("dialog", { name: "Review" })
  await expect(review.getByText("moved.mezo")).toBeVisible()
  await expect(review.getByText(movedWallet)).toBeVisible()
  await review.getByRole("button", { name: "Send", exact: true }).click()
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Sent" }).last(),
  ).toBeVisible({ timeout: 60_000 })
  expect(await tokenBalance(tokens.musd, movedWallet)).toBe(
    before + 5n * 10n ** 18n,
  )
  expect(await tokenBalance(tokens.musd, sendRecipient)).toBe(shownBefore)
  expect(errors).toEqual([])
})
