import { VOTER_WRITE_ABI, VOTING_ESCROW_WRITE_ABI } from "@matchbox/chain"
import { expect, type Page, test } from "@playwright/test"
import { encodeFunctionData, getAddress, parseAbi } from "viem"
import {
  anvilUrl,
  client,
  mainnet,
  moveToOpenWindow,
  send,
  testWallet,
  tokens,
} from "./chain"
import { pickGauges } from "./mock-api"
import { installForkWallet } from "./wallet"

/**
 * Transfer end to end against the fork: a veMEZO lock that voted this epoch
 * still transfers. The escrow has no AlreadyVoted check on transfer, so the
 * lock moves with its votes in one step, by the owner's own
 * safeTransferFrom (never an approval, never a reset).
 */

test.describe.configure({ mode: "serial" })

const recipient = getAddress("0x000000000000000000000000000000000000beef")

const listAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerToNFTokenIdList(address owner, uint256 index) view returns (uint256)",
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
  await page.goto("/")
  const drawer = page.getByRole("dialog", { name: "Connect wallet" })
  // A click before hydration does nothing, so retry until the drawer opens.
  await expect(async () => {
    await page.getByRole("button", { name: "Connect wallet" }).first().click()
    await expect(drawer).toBeVisible({ timeout: 2_000 })
  }).toPass()
  await expect(drawer.getByRole("region", { name: "Detected" })).toBeVisible()
  await drawer.getByRole("button", { name: /Fork Wallet/ }).click()
  await expect(drawer).toBeHidden()
}

function lockCard(page: Page, label: string) {
  return page
    .getByRole("region", { name: "Locks" })
    .locator("article")
    .filter({ has: page.getByText(label, { exact: true }) })
    .first()
}

test("transfers a lock voted this epoch, with its votes", async ({ page }) => {
  await moveToOpenWindow()
  const amount = 300n * 10n ** 18n
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
  const tokenId = (await veMezoLocks()).find((id) => !before.includes(id)) ?? 0n
  expect(tokenId).toBeGreaterThan(0n)
  const gauge = (await pickGauges()).find((pick) => pick.voter === "boost")
  if (gauge === undefined) throw new Error("No boost gauge on the fork")
  await send(
    testWallet,
    mainnet.boostVoter,
    encodeFunctionData({
      abi: VOTER_WRITE_ABI,
      functionName: "vote",
      args: [tokenId, [gauge.address], [10_000n]],
    }),
  )

  await connect(page)
  const card = lockCard(page, `veMEZO #${tokenId}`)
  await expect(card).toBeVisible({ timeout: 30_000 })
  // A click on the card itself (here its voting power headline) flips it.
  await card.locator("p").first().click()
  await card.getByRole("button", { name: /Transfer/ }).click()
  const sheet = page.getByRole("dialog", { name: "Transfer" })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText(/^Voted/)).toHaveCount(0)

  const to = sheet.getByLabel("To")
  // The mock API knows no Mezo IDs, so the lookup comes back empty.
  await to.fill("nobody.mezo")
  await expect(sheet.getByText("Mezo ID not found")).toBeVisible()
  await to.fill(testWallet)
  await expect(sheet.getByText("Your own wallet")).toBeVisible()
  await to.fill(recipient.toLowerCase())
  await sheet.getByRole("button", { name: "Review" }).click()

  // The steps, not the sheet's subtitle (which names the lock too).
  const steps = page
    .getByRole("dialog", { name: "Review" })
    .getByRole("list", { name: "Signatures" })
  await expect(steps.getByText(`Transfer veMEZO #${tokenId}`)).toBeVisible()
  await expect(steps.getByText(`Clear #${tokenId} votes`)).toHaveCount(0)
  await page.getByRole("button", { name: "Sign" }).click()

  const done = page.getByRole("dialog")
  await expect(
    done.getByRole("heading", { name: "Lock transferred" }).last(),
  ).toBeVisible({ timeout: 60_000 })
  await done.getByRole("button", { name: "Done" }).click()

  const sentTo = await page.evaluate(() =>
    window.__forkWallet.sent.map((tx) => tx.to?.toLowerCase()),
  )
  expect(sentTo).toEqual([mainnet.veMEZO.toLowerCase()])
  expect(
    await client.readContract({
      address: mainnet.veMEZO,
      abi: VOTING_ESCROW_WRITE_ABI,
      functionName: "ownerOf",
      args: [tokenId],
    }),
  ).toBe(recipient)
  // The votes went with it.
  expect(
    await client.readContract({
      address: mainnet.veMEZO,
      abi: VOTING_ESCROW_WRITE_ABI,
      functionName: "votedVoters",
      args: [tokenId],
    }),
  ).not.toEqual([])
})
