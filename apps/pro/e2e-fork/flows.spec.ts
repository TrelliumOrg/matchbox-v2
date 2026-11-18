import { VOTING_ESCROW_WRITE_ABI } from "@matchbox/chain"
import { expect, type Page, test } from "@playwright/test"
import { encodeFunctionData, parseAbi } from "viem"
import {
  anvilUrl,
  chainNow,
  client,
  lastVoted,
  mainnet,
  moveToOpenWindow,
  nextEpochAt,
  send,
  testWallet,
  tokenBalance,
  tokens,
  unindexedWallet,
  warpTo,
} from "./chain"
import { installForkWallet } from "./wallet"

/**
 * Pro's write paths end to end against the fork: connect through the
 * drawer, then every flow through its review, the wallet prompt and the
 * confirmed transaction, checked on chain. Serial: each flow builds on the
 * fork state the previous one left.
 */

test.describe.configure({ mode: "serial" })

const listAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerToNFTokenIdList(address owner, uint256 index) view returns (uint256)",
])

async function locks(escrow: `0x${string}`): Promise<bigint[]> {
  const count = await client.readContract({
    address: escrow,
    abi: listAbi,
    functionName: "balanceOf",
    args: [testWallet],
  })
  const ids: bigint[] = []
  for (let index = 0n; index < count; index++) {
    ids.push(
      await client.readContract({
        address: escrow,
        abi: listAbi,
        functionName: "ownerToNFTokenIdList",
        args: [testWallet, index],
      }),
    )
  }
  return ids
}

async function locked(escrow: `0x${string}`, tokenId: bigint) {
  return client.readContract({
    address: escrow,
    abi: VOTING_ESCROW_WRITE_ABI,
    functionName: "locked",
    args: [tokenId],
  })
}

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

async function connect(page: Page): Promise<void> {
  await installForkWallet(page, { address: testWallet, rpcUrl: anvilUrl })
  await page.goto("/")
  const drawer = page.getByRole("dialog", { name: "Connect wallet" })
  // A click before hydration does nothing, so retry until the drawer opens.
  await expect(async () => {
    await page.getByRole("button", { name: "Connect wallet" }).first().click()
    await expect(drawer).toBeVisible({ timeout: 2_000 })
  }).toPass()
  await expect(drawer.getByRole("region", { name: "Detected" })).toBeVisible()
  await drawer.getByRole("button", { name: /Fork Wallet/ }).click()
  // Your own wallet uses plain paths, remembered in a first-party cookie.
  await expect(page).not.toHaveURL(/address=/)
  expect(await page.evaluate(() => document.cookie)).toContain(
    `mbx-wallet=${testWallet.toLowerCase()}`,
  )
  await expect(drawer).toBeHidden()
}

async function signed(page: Page, done: string): Promise<void> {
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByRole("heading", { name: done }).last()).toBeVisible({
    timeout: 60_000,
  })
  await expect(
    page.getByRole("status").filter({ hasText: "View on Matchscan" }),
  ).toBeVisible()
  await sheet.getByRole("button", { name: "Done" }).click()
  await expect(sheet).toBeHidden()
}

function lockCard(page: Page, label: string) {
  return page
    .getByRole("region", { name: "Locks" })
    .locator("article, div")
    .filter({
      has: page.getByText(label, { exact: true }),
    })
    .first()
}

let veMezo = 0n

test("a wallet the API has no read model for shows empty states", async ({
  page,
}) => {
  const errors = watchErrors(page)
  for (const path of ["/", "/vote", "/rewards", "/activity"]) {
    const response = await page.goto(`${path}?address=${unindexedWallet}`)
    expect(response?.status(), path).toBe(200)
    await expect(
      page.getByRole("heading", { name: "Data unavailable" }),
    ).toHaveCount(0)
  }
  await expect(page.getByText("No activity")).toBeVisible()
  expect(errors).toEqual([])
})

test("connects through the wallet drawer", async ({ page }) => {
  const errors = watchErrors(page)
  await connect(page)
  await expect(
    page.getByRole("button", { name: /^Account 0x0000/ }),
  ).toBeVisible()
  expect(errors).toEqual([])
})

test("creates a veMEZO lock: approve, then lock", async ({ page }) => {
  await connect(page)
  await page.getByRole("button", { name: "New lock" }).first().click()
  const sheet = page.getByRole("dialog", { name: "New lock" })
  await sheet.getByLabel("You lock").fill("1000")
  await sheet.getByRole("radio", { name: "1 year" }).click()
  await sheet.getByRole("button", { name: "Review" }).click()
  const review = page.getByRole("dialog", { name: "Review" })
  await expect(review.getByText("Approve 1,000.00 MEZO")).toBeVisible()
  await expect(review.getByText("Lock 1,000.00 MEZO")).toBeVisible()
  await page.getByRole("button", { name: "Create lock" }).click()
  await signed(page, "Lock created")
  const ids = await locks(mainnet.veMEZO)
  expect(ids).toHaveLength(1)
  veMezo = ids[0] ?? 0n
  expect((await locked(mainnet.veMEZO, veMezo)).amount).toBe(1000n * 10n ** 18n)
  await expect(page.getByText(`veMEZO #${veMezo}`).first()).toBeVisible({
    timeout: 30_000,
  })
})

test("adds to a lock, recovering from a rejected signature", async ({
  page,
}) => {
  await connect(page)
  const card = lockCard(page, `veMEZO #${veMezo}`)
  await card.getByRole("button", { name: "Manage" }).click()
  await card.getByRole("button", { name: "Add MEZO" }).click()
  const sheet = page.getByRole("dialog", { name: "Add MEZO" })
  await sheet.getByLabel("Add").fill("500")
  await sheet.getByRole("button", { name: "Review" }).click()
  await expect(
    page
      .getByRole("dialog", { name: "Review" })
      .getByText("Approve 500.00 MEZO"),
  ).toBeVisible()
  await page.evaluate(() => {
    window.__forkWallet.rejectNext = true
  })
  await page.getByRole("button", { name: "Sign" }).click()
  await expect(page.getByText("Signature rejected")).toBeVisible()
  await page.getByRole("button", { name: "Try again" }).click()
  await signed(page, "Lock updated")
  expect((await locked(mainnet.veMEZO, veMezo)).amount).toBe(1500n * 10n ** 18n)
})

test("extends a lock to four years", async ({ page }) => {
  await connect(page)
  const before = (await locked(mainnet.veMEZO, veMezo)).end
  const card = lockCard(page, `veMEZO #${veMezo}`)
  await card.getByRole("button", { name: "Manage" }).click()
  await card.getByRole("button", { name: "Extend" }).click()
  const sheet = page.getByRole("dialog", { name: "Extend unlock" })
  await sheet.getByRole("radio", { name: "4 years" }).click()
  await sheet.getByRole("button", { name: "Review" }).click()
  await page.getByRole("button", { name: "Sign" }).click()
  await signed(page, "Lock extended")
  expect((await locked(mainnet.veMEZO, veMezo)).end).toBeGreaterThan(before)
})

test("votes from the ballot", async ({ page }) => {
  await moveToOpenWindow()
  await connect(page)
  await page
    .getByRole("navigation", { name: "Pro" })
    .filter({ visible: true })
    .getByRole("link", { name: "Vote" })
    .click()
  await page.getByRole("button", { name: "Add Kiln Labs to ballot" }).click()
  await page
    .getByRole("button", { name: "Review and sign" })
    .filter({ visible: true })
    .first()
    .click()
  const sheet = page.getByRole("dialog", { name: "Review vote" })
  await expect(sheet.getByText(`Vote with #${veMezo}`)).toBeVisible()
  await page.getByRole("button", { name: "Sign and vote" }).click()
  await signed(page, "Vote submitted")
  expect(await lastVoted(mainnet.boostVoter, veMezo)).toBeGreaterThan(0n)
})

test("adds MUSD incentives to a gauge", async ({ page }) => {
  await connect(page)
  await page
    .getByRole("navigation", { name: "Pro" })
    .filter({ visible: true })
    .getByRole("link", { name: "Vote" })
    .click()
  await page.getByRole("link", { name: "Kiln Labs" }).first().click()
  await page.getByRole("button", { name: "Add incentives" }).click()
  const sheet = page.getByRole("dialog", { name: "Add incentives" })
  await sheet.getByLabel("You add").fill("100")
  await sheet.getByRole("button", { name: "Review" }).click()
  await expect(
    page
      .getByRole("dialog", { name: "Review" })
      .getByText("Approve 100.00 MUSD"),
  ).toBeVisible()
  const before = await tokenBalance(tokens.musd, testWallet)
  await page.getByRole("button", { name: "Add incentives" }).click()
  await signed(page, "Incentives added")
  expect(before - (await tokenBalance(tokens.musd, testWallet))).toBe(
    100n * 10n ** 18n,
  )
})

test("claims the epoch's incentives once it closes", async ({ page }) => {
  await warpTo(await nextEpochAt(2 * 3_600))
  await connect(page)
  await page
    .getByRole("navigation", { name: "Pro" })
    .filter({ visible: true })
    .getByRole("link", { name: "Rewards" })
    .click()
  const claim = page.getByRole("button", { name: "Claim all" })
  await expect(claim).toBeEnabled()
  const before = await tokenBalance(tokens.musd, testWallet)
  await claim.click()
  const sheet = page.getByRole("dialog", { name: "Review claim" })
  await expect(sheet.getByText(`Claim veMEZO #${veMezo}`)).toBeVisible()
  await page.getByRole("button", { name: "Claim", exact: true }).click()
  await signed(page, "Rewards claimed")
  expect(await tokenBalance(tokens.musd, testWallet)).toBeGreaterThan(before)
})

test("merges a second lock into the first", async ({ page }) => {
  const amount = 200n * 10n ** 18n
  await send(
    testWallet,
    tokens.mezo,
    encodeFunctionData({
      abi: parseAbi(["function approve(address,uint256) returns (bool)"]),
      functionName: "approve",
      args: [mainnet.veMEZO, amount],
    }),
  )
  await send(
    testWallet,
    mainnet.veMEZO,
    encodeFunctionData({
      abi: VOTING_ESCROW_WRITE_ABI,
      functionName: "createLock",
      args: [amount, 365n * 86_400n],
    }),
  )
  const second = (await locks(mainnet.veMEZO)).find((id) => id !== veMezo) ?? 0n
  await connect(page)
  // Merge burns the card's lock into the one picked (yMC5qM2D0S).
  const card = lockCard(page, `veMEZO #${second}`)
  await card.getByRole("button", { name: "Manage" }).click()
  await card.getByRole("button", { name: "Merge" }).click()
  const sheet = page.getByRole("dialog", { name: "Merge locks" })
  await expect(sheet.getByText(`#${second} is burned`)).toBeVisible()
  await sheet.getByRole("button", { name: "Merge" }).click()
  await expect(
    page
      .getByRole("dialog", { name: "Review" })
      .getByText(`Merge #${second} into #${veMezo}`),
  ).toBeVisible()
  await page.getByRole("button", { name: "Sign" }).click()
  await signed(page, "Locks merged")
  expect(await locks(mainnet.veMEZO)).toEqual([veMezo])
  expect((await locked(mainnet.veMEZO, veMezo)).amount).toBe(1700n * 10n ** 18n)
})

test("creates a veBTC lock for two weeks, after a reload reconnects", async ({
  page,
}) => {
  await connect(page)
  await page.reload()
  await page.getByRole("button", { name: "New lock" }).first().click()
  const sheet = page.getByRole("dialog", { name: "New lock" })
  await sheet.getByRole("radio", { name: "BTC" }).click()
  await sheet.getByLabel("You lock").fill("0.1")
  await sheet.getByRole("radio", { name: "2 weeks" }).click()
  await sheet.getByRole("button", { name: "Review" }).click()
  await page.getByRole("button", { name: "Create lock" }).click()
  await signed(page, "Lock created")
  expect(await locks(mainnet.veBTC)).toHaveLength(1)
})

test("withdraws an expired lock", async ({ page }) => {
  const [vebtc] = await locks(mainnet.veBTC)
  const end = (await locked(mainnet.veBTC, vebtc ?? 0n)).end
  await warpTo(Number(end) + 3_600)
  await connect(page)
  const card = lockCard(page, `veBTC #${vebtc}`)
  await card.getByRole("button", { name: "Manage" }).click()
  // The front pill reads "Withdraw 0.1000 BTC"; this is the back's action.
  await card.getByRole("button", { name: "Withdraw", exact: true }).click()
  const sheet = page.getByRole("dialog", { name: "Withdraw" })
  await sheet.getByRole("button", { name: "Review" }).click()
  await expect(
    page
      .getByRole("dialog", { name: "Review" })
      .getByText(`Withdraw from #${vebtc}`),
  ).toBeVisible()
  await page.getByRole("button", { name: "Sign" }).click()
  await signed(page, "Withdrawn")
  expect(await locks(mainnet.veBTC)).toHaveLength(0)
})

test("holds a vote in the distribution hour before the wallet opens", async ({
  page,
}) => {
  await warpTo(await nextEpochAt(20 * 60))
  expect((await chainNow()) % (7 * 86_400)).toBeLessThan(3_600)
  await connect(page)
  await page
    .getByRole("navigation", { name: "Pro" })
    .filter({ visible: true })
    .getByRole("link", { name: "Vote" })
    .click()
  await page
    .getByRole("button", { name: "Add Northgate Capital to ballot" })
    .click()
  await page
    .getByRole("button", { name: "Review and sign" })
    .filter({ visible: true })
    .first()
    .click()
  const sheet = page.getByRole("dialog", { name: "Review vote" })
  await expect(sheet.getByRole("alert")).toHaveText("Voting opens at 01:00 UTC")
  await expect(
    page.getByRole("button", { name: "Sign and vote" }),
  ).toBeDisabled()
  const sent = await page.evaluate(() => window.__forkWallet.sent.length)
  expect(sent).toBe(0)
})
