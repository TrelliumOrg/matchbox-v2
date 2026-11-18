import { type Address, getAddress, type Hex } from "viem"
import { z } from "zod"
import type { SafeTx } from "./safe-tx"
import { safeTxServiceOrigin } from "./urls"

/**
 * Mezo's Safe Transaction Service (CORS open). Pro proposes an owner-signed
 * SafeTx there, the same off-chain proposal Safe{Wallet} makes, and reads
 * it back for confirmations and execution. Nothing here relays or pays for
 * a transaction: co-signers confirm and execute in Safe{Wallet}.
 */

const integer = z.union([z.number().int(), z.string().regex(/^\d+$/)])

const pendingSchema = z.object({
  results: z.array(z.object({ nonce: integer })),
})

const proposalSchema = z.object({
  safeTxHash: z.string(),
  nonce: integer,
  confirmationsRequired: integer.nullable(),
  confirmations: z.array(z.object({ owner: z.string() })).nullable(),
  isExecuted: z.boolean(),
  isSuccessful: z.boolean().nullable(),
  transactionHash: z.string().nullable(),
})

export type ProposalStatus = {
  confirmations: number
  required: number | null
  executed: boolean
  /** null while pending; false when executed but reverted. */
  successful: boolean | null
  transactionHash: Hex | null
}

function api(path: string): string {
  return `${safeTxServiceOrigin}/api/v1${path}`
}

async function getJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { accept: "application/json" },
  })
  if (!response.ok) throw new Error(`Safe service ${response.status}`)
  return response.json()
}

/**
 * The next nonce: past every proposal still queued, so a new proposal never
 * replaces one the co-signers have not executed yet.
 */
export async function nextNonce(
  safe: Address,
  onChain: bigint,
  fetcher: typeof fetch = fetch,
): Promise<bigint> {
  try {
    const page = pendingSchema.parse(
      await getJson(
        api(
          `/safes/${safe}/multisig-transactions/?executed=false&nonce__gte=${onChain}&ordering=-nonce&limit=1`,
        ),
        fetcher,
      ),
    )
    const top = page.results[0]
    return top === undefined ? onChain : BigInt(top.nonce) + 1n
  } catch {
    return onChain
  }
}

export type ProposalBody = {
  to: Address
  value: string
  data: Hex | null
  operation: number
  safeTxGas: string
  baseGas: string
  gasPrice: string
  gasToken: Address
  refundReceiver: Address
  nonce: string
  contractTransactionHash: Hex
  sender: Address
  signature: Hex
  origin: string
}

export function proposalBody(input: {
  tx: SafeTx
  safeTxHash: Hex
  sender: Address
  signature: Hex
}): ProposalBody {
  const { tx } = input
  return {
    to: getAddress(tx.to),
    value: tx.value.toString(),
    data: tx.data === "0x" ? null : tx.data,
    operation: tx.operation,
    safeTxGas: tx.safeTxGas.toString(),
    baseGas: tx.baseGas.toString(),
    gasPrice: tx.gasPrice.toString(),
    gasToken: getAddress(tx.gasToken),
    refundReceiver: getAddress(tx.refundReceiver),
    nonce: tx.nonce.toString(),
    contractTransactionHash: input.safeTxHash,
    sender: getAddress(input.sender),
    signature: input.signature,
    origin: JSON.stringify({
      url: "https://pro.matchbox.markets",
      name: "Matchbox Pro",
    }),
  }
}

export async function postProposal(
  safe: Address,
  body: ProposalBody,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(
    api(`/safes/${getAddress(safe)}/multisig-transactions/`),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
  if (!response.ok) throw new Error(`Safe service ${response.status}`)
}

export async function readProposal(
  safeTxHash: Hex,
  fetcher: typeof fetch = fetch,
): Promise<ProposalStatus> {
  const proposal = proposalSchema.parse(
    await getJson(api(`/multisig-transactions/${safeTxHash}/`), fetcher),
  )
  const hash = proposal.transactionHash
  return {
    confirmations: proposal.confirmations?.length ?? 0,
    required:
      proposal.confirmationsRequired === null
        ? null
        : Number(proposal.confirmationsRequired),
    executed: proposal.isExecuted,
    successful: proposal.isSuccessful,
    transactionHash:
      hash !== null && /^0x[0-9a-fA-F]{64}$/.test(hash)
        ? `0x${hash.slice(2)}`
        : null,
  }
}
