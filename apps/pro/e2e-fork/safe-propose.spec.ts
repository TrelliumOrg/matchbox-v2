import {
  ERC20_ABI,
  MULTI_SEND_CALL_ONLY_ABI,
  SAFE_CONTRACTS,
  VOTER_WRITE_ABI,
  VOTING_ESCROW_WRITE_ABI,
  VOTING_REWARD_WRITE_ABI,
} from "@matchbox/chain"
import { expect, type Page, test } from "@playwright/test"
import {
  type Address,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  type Hex,
  parseEventLogs,
} from "viem"
import {
  client,
  mainnet,
  moveToOpenWindow,
  nextEpochAt,
  send,
  setTokenBalance,
  testWallet,
  tokens,
  warpTo,
} from "./chain"
import { pickGauges } from "./mock-api"
import {
  deploySafe,
  devAccounts,
  execute,
  fund,
  installSafeOwner,
  MockSafeService,
  safeNonce,
  saveMultisig,
  sendFrom,
  signSafeTx,
} from "./safe"

/**
 * Path 2, Pro's primary Safe flow, against the fork: a Safe owner proposes
 * "Claim and relock" from Pro. The whole plan (claim, exact approve, add
 * to the lock) must reach the Transaction Service as ONE SafeTx: a
 * DELEGATECALL to MultiSendCallOnly, simulated as the Safe first, signed
 * by the owner with EIP-712. The spec then executes it on the fork with
 * the owners' signatures (1 of 1, then 2 of 2) and checks the lock.
 *
 * Needs TxHost to open a sheet for the Safe being viewed while an owner's
 * wallet is connected in Multisig mode (see the Tx agent's handoff).
 */

test.describe.configure({ mode: "serial" })

type SafeLock = { safe: Address; tokenId: bigint; bribe: Address }

let owner: Address
let cosigner: Address

async function mintedLock(hash: Hex): Promise<bigint> {
  const receipt = await client.getTransactionReceipt({ hash })
  const [minted] = parseEventLogs({
    abi: VOTING_ESCROW_WRITE_ABI,
    eventName: "Transfer",
    logs: receipt.logs,
  }).filter((log) => log.args.to.toLowerCase() === testWallet.toLowerCase())
  if (minted === undefined) throw new Error("No lock minted")
  return minted.args.tokenId
}

/**
 * A veMEZO lock that voted on a veBTC gauge last epoch, with MEZO
 * incentives earned, then moved to the Safe: exactly what "Claim and
 * relock" claims and relocks.
 */
async function lockWithRewards(safe: Address): Promise<SafeLock> {
  const [gauge] = (await pickGauges()).filter((each) => each.voter === "boost")
  if (gauge === undefined) throw new Error("No veBTC gauge on the fork")
  const amount = 1_000n * 10n ** 18n
  const incentive = 500n * 10n ** 18n
  await moveToOpenWindow()
  await send(
    testWallet,
    tokens.mezo,
    encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [mainnet.veMEZO, amount],
    }),
  )
  const tokenId = await mintedLock(
    await sendFrom(
      testWallet,
      mainnet.veMEZO,
      encodeFunctionData({
        abi: VOTING_ESCROW_WRITE_ABI,
        functionName: "createLock",
        args: [amount, 52n * 7n * 86_400n],
      }),
    ),
  )
  await send(
    testWallet,
    mainnet.boostVoter,
    encodeFunctionData({
      abi: VOTER_WRITE_ABI,
      functionName: "vote",
      args: [tokenId, [gauge.address], [10_000n]],
    }),
  )
  await send(
    testWallet,
    tokens.mezo,
    encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [mainnet.boostVoter, incentive],
    }),
  )
  await send(
    testWallet,
    mainnet.boostVoter,
    encodeFunctionData({
      abi: VOTER_WRITE_ABI,
      functionName: "addBribes",
      args: [gauge.address, [tokens.mezo], [incentive]],
    }),
  )
  const bribe = await client.readContract({
    address: mainnet.boostVoter,
    abi: VOTER_WRITE_ABI,
    functionName: "gaugeToBribe",
    args: [gauge.address],
  })
  await send(
    testWallet,
    mainnet.veMEZO,
    encodeFunctionData({
      abi: VOTING_ESCROW_WRITE_ABI,
      functionName: "safeTransferFrom",
      args: [testWallet, safe, tokenId],
    }),
  )
  // The epoch closes: its incentives become claimable by the lock's owner.
  await warpTo(await nextEpochAt(2 * 3_600))
  return { safe, tokenId, bribe: getAddress(bribe) }
}

async function earned(lock: SafeLock): Promise<bigint> {
  return client.readContract({
    address: lock.bribe,
    abi: VOTING_REWARD_WRITE_ABI,
    functionName: "earned",
    args: [tokens.mezo, lock.tokenId],
  })
}

async function lockedAmount(tokenId: bigint): Promise<bigint> {
  const locked = await client.readContract({
    address: mainnet.veMEZO,
    abi: VOTING_ESCROW_WRITE_ABI,
    functionName: "locked",
    args: [tokenId],
  })
  return locked.amount
}

async function connectOwner(page: Page, safe: Address): Promise<void> {
  await saveMultisig(page, safe)
  await installSafeOwner(page, owner)
  await page.goto("/")
  const drawer = page.getByRole("dialog", { name: "Connect wallet" })
  await expect(async () => {
    await page.getByRole("button", { name: "Connect wallet" }).first().click()
    await expect(drawer).toBeVisible({ timeout: 2_000 })
  }).toPass()
  await drawer.getByRole("button", { name: /Safe Owner Wallet/ }).click()
  await expect(drawer).toBeHidden()
}

/** Proposes "Claim and relock" for the Safe and returns what was posted. */
async function proposeClaimAndRelock(
  page: Page,
  service: MockSafeService,
  lock: SafeLock,
  threshold: { signed: number; of: number },
) {
  await page.goto(`/rewards?address=${lock.safe}`)
  await page.getByRole("button", { name: "Claim and relock" }).click()
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByText("Simulation passed")).toBeVisible({
    timeout: 60_000,
  })
  await expect(sheet.getByText(`Claim veMEZO #${lock.tokenId}`)).toBeVisible()
  await expect(
    sheet.getByText("Exactly this amount, nothing more"),
  ).toBeVisible()
  await expect(sheet.getByText(`Add to #${lock.tokenId}`)).toBeVisible()
  await sheet.getByRole("button", { name: "Propose to Safe" }).click()
  await expect(
    sheet.getByRole("heading", { name: "Proposed to Safe" }),
  ).toBeVisible({ timeout: 60_000 })
  await expect(
    sheet.getByText(`${threshold.signed} of ${threshold.of} signed`).first(),
  ).toBeVisible()
  const posted = service.posted
  if (posted === null) throw new Error("Nothing proposed")
  const continueLink = sheet.getByRole("link", { name: "Continue to Safe" })
  await expect(continueLink).toHaveAttribute(
    "href",
    `https://safe.mezo.org/transactions/tx?safe=mezo:${lock.safe}&id=multisig_${lock.safe}_${posted.contractTransactionHash}`,
  )
  return posted
}

/** One SafeTx: DELEGATECALL to MultiSendCallOnly with claim, approve, add. */
function expectOneBatch(
  posted: NonNullable<MockSafeService["posted"]>,
  lock: SafeLock,
): void {
  expect(getAddress(posted.to)).toBe(SAFE_CONTRACTS.mainnet.multiSendCallOnly)
  expect(posted.operation).toBe(1)
  expect(posted.value).toBe("0")
  const { functionName } = decodeFunctionData({
    abi: MULTI_SEND_CALL_ONLY_ABI,
    data: posted.data ?? "0x",
  })
  expect(functionName).toBe("multiSend")
  const packed: string = posted.data ?? ""
  // claimBribes, approve(veMEZO), increaseAmount(tokenId): three inner calls.
  expect(packed).toContain(mainnet.boostVoter.slice(2).toLowerCase())
  expect(packed).toContain(tokens.mezo.slice(2).toLowerCase())
  expect(packed).toContain(mainnet.veMEZO.slice(2).toLowerCase())
  expect(packed).toContain(lock.tokenId.toString(16))
}

test.beforeAll(async () => {
  const accounts = await devAccounts()
  const [first, second] = accounts
  if (first === undefined || second === undefined) {
    throw new Error("Anvil has no dev accounts")
  }
  owner = first
  cosigner = second
  await fund(owner)
  await fund(cosigner)
  await setTokenBalance(tokens.mezo, testWallet, 100_000n * 10n ** 18n)
})

test("a 1-of-1 Safe proposes claim and relock as one batch", async ({
  page,
}) => {
  const safe = await deploySafe({
    deployer: owner,
    owners: [owner],
    threshold: 1,
    salt: 31_612_001n,
  })
  const lock = await lockWithRewards(safe)
  const reward = await earned(lock)
  expect(reward).toBeGreaterThan(0n)
  const lockedBefore = await lockedAmount(lock.tokenId)
  const nonce = await safeNonce(safe)

  const service = new MockSafeService()
  await service.install(page)
  await connectOwner(page, safe)
  const posted = await proposeClaimAndRelock(page, service, lock, {
    signed: 1,
    of: 1,
  })
  expectOneBatch(posted, lock)
  expect(BigInt(posted.nonce)).toBe(nonce)
  expect(getAddress(posted.sender)).toBe(owner)

  // A co-signer would now execute in Safe{Wallet}; the fork does it here
  // with the signature Pro collected.
  const hash = await execute({
    safe,
    executor: owner,
    posted,
    signatures: [{ owner, signature: posted.signature }],
  })
  service.executedHash = hash
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Executed" }),
  ).toBeVisible({ timeout: 25_000 })

  expect(await earned(lock)).toBe(0n)
  expect(await lockedAmount(lock.tokenId)).toBe(lockedBefore + reward)
  expect(await safeNonce(safe)).toBe(nonce + 1n)
  expect(
    await client.readContract({
      address: tokens.mezo,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [safe, mainnet.veMEZO],
    }),
  ).toBe(0n)
})

test("a 2-of-2 Safe needs the co-signer before the batch executes", async ({
  page,
}) => {
  const safe = await deploySafe({
    deployer: owner,
    owners: [owner, cosigner],
    threshold: 2,
    salt: 31_612_002n,
  })
  const lock = await lockWithRewards(safe)
  const reward = await earned(lock)
  expect(reward).toBeGreaterThan(0n)
  const lockedBefore = await lockedAmount(lock.tokenId)

  const service = new MockSafeService()
  service.required = 2
  await service.install(page)
  await connectOwner(page, safe)
  const posted = await proposeClaimAndRelock(page, service, lock, {
    signed: 1,
    of: 2,
  })
  expectOneBatch(posted, lock)

  // One signature is not enough.
  await expect(
    execute({
      safe,
      executor: owner,
      posted,
      signatures: [{ owner, signature: posted.signature }],
    }),
  ).rejects.toThrow()
  expect(await lockedAmount(lock.tokenId)).toBe(lockedBefore)

  const second = await signSafeTx(cosigner, safe, posted)
  service.confirmations = [owner, cosigner]
  await expect(
    page.getByRole("dialog").getByText("2 of 2 signed").first(),
  ).toBeVisible({ timeout: 25_000 })
  const hash = await execute({
    safe,
    executor: cosigner,
    posted,
    signatures: [
      { owner, signature: posted.signature },
      { owner: cosigner, signature: second },
    ],
  })
  service.executedHash = hash
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Executed" }),
  ).toBeVisible({ timeout: 25_000 })
  expect(await earned(lock)).toBe(0n)
  expect(await lockedAmount(lock.tokenId)).toBe(lockedBefore + reward)
})
