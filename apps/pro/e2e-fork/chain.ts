import { CONTRACTS, ERC20_ABI, VOTER_WRITE_ABI } from "@matchbox/chain"
import {
  type Address,
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  type Hex,
  http,
  keccak256,
  numberToHex,
  pad,
} from "viem"
import { forkTokenRuntime } from "./fork-token"

/**
 * The Anvil fork of Mezo mainnet the transaction tests sign against. Every
 * write here goes to the local fork through impersonated accounts: no
 * private key exists anywhere and nothing is ever broadcast to mainnet.
 */

export const anvilUrl = "http://127.0.0.1:8545"
export const mezoRpc = "https://mainnet.mezo.public.validationcloud.io"

export const tokens = {
  btc: getAddress("0x7b7c000000000000000000000000000000000000"),
  mezo: getAddress("0x7b7c000000000000000000000000000000000001"),
  musd: getAddress("0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"),
} as const

/** The test wallet: a fresh address with no history on mainnet. */
export const testWallet = getAddress(
  "0x000000000000000000000000000000000000f0a1",
)

/** A wallet the mock API has no read model for (Pro must not 500). */
export const unindexedWallet = getAddress(
  "0x000000000000000000000000000000000000dead",
)

export const mainnet = CONTRACTS.mainnet

export const client = createPublicClient({
  transport: http(anvilUrl),
  chain: {
    id: 31612,
    name: "Mezo fork",
    nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
    rpcUrls: { default: { http: [anvilUrl] } },
    contracts: {
      multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
    },
  },
})

let rpcId = 0

/** A raw JSON-RPC call to the fork (anvil_* and evm_* included). */
export async function rpc<T = unknown>(
  method: string,
  params: unknown[] = [],
): Promise<T> {
  rpcId += 1
  const response = await fetch(anvilUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }),
  })
  const body: { result?: T; error?: { message: string } } =
    await response.json()
  if (body.error !== undefined)
    throw new Error(`${method}: ${body.error.message}`)
  return body.result as T
}

/** Sends a transaction from an impersonated account and waits for it. */
export async function send(
  from: Address,
  to: Address,
  data: Hex,
): Promise<void> {
  await rpc("anvil_impersonateAccount", [from])
  const hash = await rpc<Hex>("eth_sendTransaction", [{ from, to, data }])
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status !== "success") throw new Error(`Fork tx reverted: ${hash}`)
}

function balanceSlot(holder: Address): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [holder, 0n],
    ),
  )
}

/**
 * Sets a balance directly in storage (slot 0 mapping): ForkToken, and MUSD,
 * whose OpenZeppelin ERC20 keeps balances in slot 0 too. MUSD used to come
 * from an impersonated mainnet holder, which broke once it moved its funds.
 */
export async function setTokenBalance(
  token: Address,
  holder: Address,
  amount: bigint,
): Promise<void> {
  await rpc("anvil_setStorageAt", [
    token,
    balanceSlot(holder),
    pad(numberToHex(amount), { size: 32 }),
  ])
}

/**
 * Prepares the fork: ForkToken in place of the MEZO and BTC precompiles,
 * gas and tokens for the test wallet, and the clock moved into an open
 * voting window.
 */
export async function seedFork(): Promise<void> {
  for (const token of [tokens.btc, tokens.mezo]) {
    await rpc("anvil_setCode", [token, forkTokenRuntime])
  }
  await rpc("anvil_setBalance", [testWallet, numberToHex(10n ** 20n)])
  await setTokenBalance(tokens.mezo, testWallet, 100_000n * 10n ** 18n)
  await setTokenBalance(tokens.btc, testWallet, 2n * 10n ** 18n)
  await setTokenBalance(tokens.musd, testWallet, 1_000n * 10n ** 18n)
  await moveToOpenWindow()
}

export async function chainNow(): Promise<number> {
  const block = await client.getBlock()
  return Number(block.timestamp)
}

const week = 7 * 86_400

/** Moves the fork clock forward so votes are allowed (not the first or last hour). */
export async function moveToOpenWindow(): Promise<void> {
  const now = await chainNow()
  const start = now - (now % week)
  const intoEpoch = now - start
  if (intoEpoch > 2 * 3_600 && intoEpoch < week - 2 * 3_600) return
  const target =
    intoEpoch <= 2 * 3_600
      ? start + 2 * 3_600 + 60
      : start + week + 2 * 3_600 + 60
  await warpTo(target)
}

export async function warpTo(timestamp: number): Promise<void> {
  await rpc("evm_setNextBlockTimestamp", [numberToHex(timestamp)])
  await rpc("evm_mine")
}

/** The start of the next epoch plus `offset` seconds. */
export async function nextEpochAt(offset: number): Promise<number> {
  const now = await chainNow()
  return now - (now % week) + week + offset
}

export async function lastVoted(
  voter: Address,
  tokenId: bigint,
): Promise<bigint> {
  return client.readContract({
    address: voter,
    abi: VOTER_WRITE_ABI,
    functionName: "lastVoted",
    args: [tokenId],
  })
}

export async function tokenBalance(
  token: Address,
  holder: Address,
): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [holder],
  })
}
