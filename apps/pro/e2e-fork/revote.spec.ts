import { VOTING_ESCROW_WRITE_ABI } from "@matchbox/chain"
import { expect, type Page, test } from "@playwright/test"
import { encodeFunctionData, parseAbi } from "viem"
import {
  anvilUrl,
  client,
  mainnet,
  moveToOpenWindow,
  nextEpochAt,
  send,
  testWallet,
  tokens,
  warpTo,
} from "./chain"
import { pickGauges } from "./mock-api"
import { installForkWallet } from "./wallet"

/**
 * Voting again with a lock that voted this epoch. Every voter reverts
 * vote() and reset() with AlreadyVotedOrDeposited() until the next epoch,
 * so Pro saves the new split in the browser, signs nothing, and offers it
 * again once the next epoch opens. Serial: the last step moves the clock.
 */

test.describe.configure({ mode: "serial" })

const listAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerToNFTokenIdList(address owner, uint256 index) view returns (uint256)",
  "function votes(uint256 tokenId, address gauge) view returns (uint256)",
])

async function veMezoLocks(): Promise<bigint[]> {
  const count = await client.readContract({
    address: mainnet.veMEZO,
    abi: listAbi,
    functionName: "balanceOf",
    args: [testWallet],
  })
  const ids: bigint[] = []
  for (let index = 0n; index < count; index++) {
    ids.push(
      await client.readContract({
        address: mainnet.veMEZO,
        abi: listAbi,
        functionName: "ownerToNFTokenIdList",
        args: [testWallet, index],
      }),
    )
  }
  return ids
}

async function connect(page: Page): Promise<void> {
  await installForkWallet(page, { address: testWallet, rpcUrl: anvilUrl })
  await page.goto("/vote")
  const drawer = page.getByRole("dialog", { name: "Connect wallet" })
  // A click before hydration does nothing, so retry until the drawer opens.
  await expect(async () => {
    await page.getByRole("button", { name: "Connect wallet" }).first().click()
    await expect(drawer).toBeVisible({ timeout: 2_000 })
  }).toPass()
  await drawer.getByRole("button", { name: /Fork Wallet/ }).click()
  await expect(drawer).toBeHidden()
}

/** Picks only this lock on Vote (the selection is per wallet and type). */
async function voteWithOnly(page: Page, tokenId: bigint): Promise<void> {
  const picker = page.getByRole("region", { name: "Vote with" })
  const boxes = picker.getByRole("checkbox")
  await expect(boxes.first()).toBeVisible()
  for (const box of await boxes.all()) {
    const name = (await box.getAttribute("aria-describedby")) ?? ""
    const mine = name.endsWith(`-${tokenId}-meta`)
    if ((await box.isChecked()) !== mine && (await box.isEnabled())) {
      await box.click()
    }
  }
  await expect(
    picker.getByRole("checkbox", { name: new RegExp(`#${tokenId}`) }),
  ).toBeChecked()
}

/** The ballot's primary (the bottom bar below 1600px). */
function primary(page: Page, name: RegExp | string) {
  return page.getByRole("button", { name }).filter({ visible: true }).first()
}

async function votesOn(tokenId: bigint, gauge: `0x${string}`) {
  return client.readContract({
    address: mainnet.boostVoter,
    abi: listAbi,
    functionName: "votes",
    args: [tokenId, gauge],
  })
}

let tokenId = 0n
let nextEpoch = 0
/** The saved splits (this browser's storage), carried to the next test. */
let savedStorage: Record<string, string> = {}

test("votes with a new lock from the ballot", async ({ page }) => {
  await moveToOpenWindow()
  const amount = 400n * 10n ** 18n
  const before = await veMezoLocks()
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
  tokenId = (await veMezoLocks()).find((id) => !before.includes(id)) ?? 0n
  expect(tokenId).toBeGreaterThan(0n)

  await connect(page)
  await voteWithOnly(page, tokenId)
  await page.getByRole("button", { name: "Add Kiln Labs to ballot" }).click()
  await primary(page, "Review and sign").click()
  await page.getByRole("button", { name: "Sign and vote" }).click()
  const sheet = page.getByRole("dialog")
  await expect(
    sheet.getByRole("heading", { name: "Vote submitted" }).last(),
  ).toBeVisible({ timeout: 60_000 })
  await sheet.getByRole("button", { name: "Done" }).click()
  const [kiln] = await pickGauges()
  expect(await votesOn(tokenId, kiln?.address ?? "0x")).toBeGreaterThan(0n)
})

test("voting again this epoch saves the split for the next one", async ({
  page,
}) => {
  await connect(page)
  await voteWithOnly(page, tokenId)
  const picker = page.getByRole("region", { name: "Vote with" })
  // The voted lock stays pickable and says so; its votes load.
  await expect(picker.getByText("Voted this epoch")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Remove Kiln Labs from ballot" }).first(),
  ).toBeVisible()
  const save = primary(page, /^Save for Epoch \d+$/)
  await expect(save).toBeVisible()
  // The pill repeats its label for the text animation: take the first.
  nextEpoch = Number(/Epoch (\d+)/.exec((await save.textContent()) ?? "")?.[1])
  expect(nextEpoch).toBeGreaterThan(0)

  await page
    .getByRole("button", { name: "Add Northgate Capital to ballot" })
    .click()
  const sent = await page.evaluate(() => window.__forkWallet.sent.length)
  await save.click()
  const sheet = page.getByRole("dialog", { name: "Review changes" })
  await expect(
    sheet.getByText(/^Votes can change from \w{3} \d+ \w{3} 01:00 UTC$/),
  ).toBeVisible()
  await sheet
    .getByRole("button", { name: `Save for Epoch ${nextEpoch}` })
    .click()
  const done = page.getByRole("dialog")
  await expect(
    done.getByRole("heading", { name: "Changes saved" }).last(),
  ).toBeVisible()
  await done.getByRole("button", { name: "Done" }).click()

  // Saved here, never signed: no transaction went to the wallet.
  expect(await page.evaluate(() => window.__forkWallet.sent.length)).toBe(sent)
  await expect(
    picker.getByText(`Changes saved for Epoch ${nextEpoch}`),
  ).toBeVisible()
  await page.reload()
  await expect(
    page
      .getByRole("region", { name: "Vote with" })
      .getByText(`Changes saved for Epoch ${nextEpoch}`),
  ).toBeVisible()
  savedStorage = await page.evaluate(() =>
    Object.fromEntries(
      Object.entries(window.localStorage).filter(([key]) =>
        key.startsWith("mbx-vote-saved:"),
      ),
    ),
  )
  expect(Object.keys(savedStorage)).toHaveLength(1)
})

test("the next epoch offers the saved split to sign", async ({ page }) => {
  await warpTo(await nextEpochAt(2 * 3_600))
  // Each test opens a fresh browser; this one is the same browser later on.
  await page.addInitScript((entries: Record<string, string>) => {
    for (const [key, value] of Object.entries(entries)) {
      window.localStorage.setItem(key, value)
    }
  }, savedStorage)
  await connect(page)
  await voteWithOnly(page, tokenId)
  // The saved split is preloaded (Kiln Labs and Northgate Capital), and
  // signed only when you sign it.
  await expect(
    page.getByRole("button", { name: "Remove Kiln Labs from ballot" }).first(),
  ).toBeVisible()
  await expect(
    page
      .getByRole("button", { name: "Remove Northgate Capital from ballot" })
      .first(),
  ).toBeVisible()
  await primary(page, "Review and sign").click()
  await page.getByRole("button", { name: "Sign and vote" }).click()
  const sheet = page.getByRole("dialog")
  await expect(
    sheet.getByRole("heading", { name: "Vote submitted" }).last(),
  ).toBeVisible({ timeout: 60_000 })
  await sheet.getByRole("button", { name: "Done" }).click()

  const [kiln, northgate] = await pickGauges()
  expect(await votesOn(tokenId, kiln?.address ?? "0x")).toBeGreaterThan(0n)
  expect(await votesOn(tokenId, northgate?.address ?? "0x")).toBeGreaterThan(0n)
  // Spent: the lock no longer carries a saved split.
  await page.reload()
  const picker = page.getByRole("region", { name: "Vote with" })
  await expect(picker.getByText("Voted this epoch")).toBeVisible()
  await expect(picker.getByText(/^Changes saved for Epoch/)).toHaveCount(0)
})
