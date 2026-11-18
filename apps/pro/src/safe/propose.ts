import { SAFE_ABI } from "@matchbox/chain"
import { type Config, readContracts, signTypedData } from "@wagmi/core"
import { type Address, getAddress, type Hex } from "viem"
import { mezoChainId } from "../wallet/wallet-runtime"
import type { SafeCall } from "./batch"
import {
  hashSafeTx,
  normalizeSignature,
  type SafeTx,
  safeTx,
  safeTxTypedData,
} from "./safe-tx"
import { nextNonce, postProposal, proposalBody } from "./service"
import { safeTxUrl } from "./urls"

/**
 * Path 2, Pro's primary Safe flow: an owner's wallet proposes the batch to
 * Mezo's Transaction Service. Pro reads the Safe on chain (owners,
 * threshold, nonce), checks the connected account is an owner, has it sign
 * the SafeTx hash with EIP-712 (off chain, no gas), and posts it. Co-signers
 * then confirm and execute in Safe{Wallet} ("Continue to Safe").
 */

export type SafeInfo = {
  owners: Address[]
  threshold: number
  nonce: bigint
}

export async function readSafe(
  config: Config,
  safe: Address,
): Promise<SafeInfo> {
  const [owners, threshold, nonce] = await readContracts(config, {
    allowFailure: false,
    contracts: [
      {
        address: safe,
        abi: SAFE_ABI,
        functionName: "getOwners",
        chainId: mezoChainId,
      },
      {
        address: safe,
        abi: SAFE_ABI,
        functionName: "getThreshold",
        chainId: mezoChainId,
      },
      {
        address: safe,
        abi: SAFE_ABI,
        functionName: "nonce",
        chainId: mezoChainId,
      },
    ],
  })
  return {
    owners: owners.map((owner) => getAddress(owner)),
    threshold: Number(threshold),
    nonce,
  }
}

export function isOwner(info: SafeInfo, account: Address): boolean {
  return info.owners.some(
    (owner) => owner.toLowerCase() === account.toLowerCase(),
  )
}

export type Proposal = {
  safe: Address
  safeTxHash: Hex
  tx: SafeTx
  threshold: number
  url: string
}

export async function proposeToSafe(input: {
  config: Config
  safe: Address
  owner: Address
  call: SafeCall
  info: SafeInfo
  fetcher?: typeof fetch
}): Promise<Proposal> {
  const { config, owner, call, info } = input
  const safe = getAddress(input.safe)
  const nonce = await nextNonce(safe, info.nonce, input.fetcher)
  const tx = safeTx(call, nonce)
  const safeTxHash = hashSafeTx(safe, tx)
  const signature = normalizeSignature(
    await signTypedData(config, {
      account: owner,
      ...safeTxTypedData(safe, tx),
    }),
  )
  await postProposal(
    safe,
    proposalBody({ tx, safeTxHash, sender: owner, signature }),
    input.fetcher,
  )
  return {
    safe,
    safeTxHash,
    tx,
    threshold: info.threshold,
    url: safeTxUrl(safe, safeTxHash),
  }
}
