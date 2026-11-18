import {
  SAFE_ABI,
  SAFE_CONTRACTS,
  SAFE_PROXY_FACTORY_ABI,
} from "@matchbox/chain"
import type { Page, Route } from "@playwright/test"
import {
  type Address,
  concatHex,
  encodeFunctionData,
  getAddress,
  type Hex,
  parseEventLogs,
  zeroAddress,
} from "viem"
import { z } from "zod"
import { anvilUrl, client, rpc } from "./chain"

/**
 * Safes on the Anvil fork, deployed through Mezo's own Safe 1.4.1 proxy
 * factory and L2 singleton, owned by Anvil's unlocked dev accounts so the
 * owners can sign EIP-712 for real (Anvil signs eth_signTypedData_v4 for
 * them). The Transaction Service is mocked in the page: the spec captures
 * the proposal Pro posts and executes it on the fork with the owners'
 * signatures. Nothing reaches mainnet or the real service.
 */

const safeL2 = SAFE_CONTRACTS.mainnet

export const hexSchema = z.custom<Hex>(
  (value) => typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value),
)

/** Anvil's dev accounts: unlocked, so Anvil signs for them. */
export async function devAccounts(): Promise<Address[]> {
  const accounts = z.array(z.string()).parse(await rpc("eth_accounts"))
  return accounts.map((account) => getAddress(account))
}

export async function fund(address: Address): Promise<void> {
  await rpc("anvil_setBalance", [address, "0x56bc75e2d63100000"])
}

/** Sends from an unlocked account and waits; throws on revert. */
export async function sendFrom(
  from: Address,
  to: Address,
  data: Hex,
): Promise<Hex> {
  const hash = hexSchema.parse(
    await rpc("eth_sendTransaction", [{ from, to, data }]),
  )
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status !== "success") throw new Error(`Fork tx reverted: ${hash}`)
  return receipt.transactionHash
}

export async function deploySafe(input: {
  deployer: Address
  owners: Address[]
  threshold: number
  salt: bigint
}): Promise<Address> {
  const initializer = encodeFunctionData({
    abi: SAFE_ABI,
    functionName: "setup",
    args: [
      input.owners,
      BigInt(input.threshold),
      zeroAddress,
      "0x",
      safeL2.fallbackHandler,
      zeroAddress,
      0n,
      zeroAddress,
    ],
  })
  const hash = await sendFrom(
    input.deployer,
    safeL2.proxyFactory,
    encodeFunctionData({
      abi: SAFE_PROXY_FACTORY_ABI,
      functionName: "createProxyWithNonce",
      args: [safeL2.safeL2Singleton, initializer, input.salt],
    }),
  )
  const receipt = await client.getTransactionReceipt({ hash })
  const [created] = parseEventLogs({
    abi: SAFE_PROXY_FACTORY_ABI,
    eventName: "ProxyCreation",
    logs: receipt.logs,
  })
  if (created === undefined) throw new Error("No Safe created")
  return getAddress(created.args.proxy)
}

/** What Pro posted to the (mocked) Transaction Service. */
export const proposalSchema = z.object({
  to: z.string(),
  value: z.string(),
  data: hexSchema.nullable(),
  operation: z.number(),
  safeTxGas: z.string(),
  baseGas: z.string(),
  gasPrice: z.string(),
  gasToken: z.string(),
  refundReceiver: z.string(),
  nonce: z.string(),
  contractTransactionHash: hexSchema,
  sender: z.string(),
  signature: hexSchema,
})

export type PostedProposal = z.infer<typeof proposalSchema>

/** The same SafeTx, signed by another owner through Anvil. */
export async function signSafeTx(
  owner: Address,
  safe: Address,
  posted: PostedProposal,
): Promise<Hex> {
  const typed = {
    domain: { chainId: 31612, verifyingContract: safe },
    primaryType: "SafeTx",
    types: {
      EIP712Domain: [
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      SafeTx: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "operation", type: "uint8" },
        { name: "safeTxGas", type: "uint256" },
        { name: "baseGas", type: "uint256" },
        { name: "gasPrice", type: "uint256" },
        { name: "gasToken", type: "address" },
        { name: "refundReceiver", type: "address" },
        { name: "nonce", type: "uint256" },
      ],
    },
    message: { ...posted, data: posted.data ?? "0x" },
  }
  return hexSchema.parse(
    await rpc("eth_signTypedData_v4", [owner, JSON.stringify(typed)]),
  )
}

/** Executes a proposal with owner signatures, sorted by owner as Safe requires. */
export async function execute(input: {
  safe: Address
  executor: Address
  posted: PostedProposal
  signatures: { owner: Address; signature: Hex }[]
}): Promise<Hex> {
  const sorted = [...input.signatures].sort((a, b) =>
    a.owner.toLowerCase() < b.owner.toLowerCase() ? -1 : 1,
  )
  const { posted } = input
  return sendFrom(
    input.executor,
    input.safe,
    encodeFunctionData({
      abi: SAFE_ABI,
      functionName: "execTransaction",
      args: [
        getAddress(posted.to),
        BigInt(posted.value),
        posted.data ?? "0x",
        posted.operation,
        BigInt(posted.safeTxGas),
        BigInt(posted.baseGas),
        BigInt(posted.gasPrice),
        getAddress(posted.gasToken),
        getAddress(posted.refundReceiver),
        concatHex(sorted.map((entry) => entry.signature)),
      ],
    }),
  )
}

export async function safeNonce(safe: Address): Promise<bigint> {
  return client.readContract({
    address: safe,
    abi: SAFE_ABI,
    functionName: "nonce",
  })
}

/**
 * The Transaction Service, mocked in the page: an empty queue, the posted
 * proposal captured, and its status (confirmations, then execution once
 * the spec executes it on the fork).
 */
export class MockSafeService {
  posted: PostedProposal | null = null
  confirmations: string[] = []
  required = 1
  executedHash: Hex | null = null

  async install(page: Page): Promise<void> {
    await page.route(
      "https://safe-transaction-mezo.safe.onchainden.com/**",
      (route) => this.handle(route),
    )
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request()
    const url = new URL(request.url())
    const json = (status: number, body: unknown) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(body),
      })
    if (request.method() === "OPTIONS") {
      return route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      })
    }
    if (request.method() === "POST") {
      this.posted = proposalSchema.parse(request.postDataJSON())
      this.confirmations = [this.posted.sender]
      return json(201, {})
    }
    if (url.pathname.endsWith("/multisig-transactions/") && url.search !== "") {
      return json(200, { count: 0, results: [] })
    }
    if (
      this.posted !== null &&
      url.pathname.includes(this.posted.contractTransactionHash)
    ) {
      return json(200, {
        safeTxHash: this.posted.contractTransactionHash,
        nonce: Number(this.posted.nonce),
        confirmationsRequired: this.required,
        confirmations: this.confirmations.map((owner) => ({ owner })),
        isExecuted: this.executedHash !== null,
        isSuccessful: this.executedHash === null ? null : true,
        transactionHash: this.executedHash,
      })
    }
    return json(404, {})
  }
}

/**
 * An EIP-6963 wallet for a Safe owner: Anvil's unlocked dev account, so
 * eth_signTypedData_v4 is a real signature (Anvil signs it). Everything
 * else forwards to the fork.
 */
function installOwner({
  address,
  rpcUrl,
}: {
  address: string
  rpcUrl: string
}): void {
  let id = 0
  async function forward(method: string, params: unknown): Promise<unknown> {
    id += 1
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    })
    const body: {
      result?: unknown
      error?: { code: number; message: string }
    } = await response.json()
    if (body.error !== undefined) {
      throw Object.assign(new Error(body.error.message), {
        code: body.error.code,
      })
    }
    return body.result
  }
  const provider = {
    async request({ method, params }: { method: string; params?: unknown[] }) {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [address]
        case "eth_chainId":
          return "0x7b7c"
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          return null
        case "wallet_requestPermissions":
        case "wallet_getPermissions":
          return [{ parentCapability: "eth_accounts" }]
        default:
          return forward(method, params ?? [])
      }
    },
    on() {},
    removeListener() {},
  }
  const info = {
    uuid: "0f0e9a3e-7c1b-4f0e-9d7a-5afe5afe5afe",
    name: "Safe Owner Wallet",
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='16' fill='%2312FF80'/%3E%3C/svg%3E",
    rdns: "markets.matchbox.fork-safe-owner",
  }
  function announce(): void {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info, provider }),
      }),
    )
  }
  window.addEventListener("eip6963:requestProvider", announce)
  announce()
}

export async function installSafeOwner(
  page: Page,
  address: Address,
): Promise<void> {
  await page.addInitScript(installOwner, { address, rpcUrl: anvilUrl })
}

/** Pro's Multisig setting with this Safe saved, before the page loads. */
export async function saveMultisig(page: Page, safe: Address): Promise<void> {
  await page.addInitScript((saved: string) => {
    window.localStorage.setItem(
      "mbx-settings",
      JSON.stringify({
        network: { mode: "matchbox" },
        signing: { mode: "multisig", safe: saved },
      }),
    )
  }, safe)
}
