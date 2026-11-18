import {
  type Address,
  type Hex,
  hashTypedData,
  hexToNumber,
  sliceHex,
  zeroAddress,
} from "viem"
import type { SafeCall } from "./batch"
import { safeChainId } from "./urls"

/**
 * The SafeTx the owners sign (EIP-712, Safe 1.3.0 and later: the domain is
 * the chain id and the Safe). No refund: gas fields are zero, so whoever
 * executes pays their own gas and nothing is reimbursed.
 */

export type SafeTx = SafeCall & {
  safeTxGas: bigint
  baseGas: bigint
  gasPrice: bigint
  gasToken: Address
  refundReceiver: Address
  nonce: bigint
}

export const safeTxTypes = {
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
} as const

export function safeTx(call: SafeCall, nonce: bigint): SafeTx {
  return {
    ...call,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce,
  }
}

/** What the owner's wallet signs with eth_signTypedData_v4. */
export function safeTxTypedData(safe: Address, tx: SafeTx) {
  return {
    domain: { chainId: safeChainId, verifyingContract: safe },
    types: safeTxTypes,
    primaryType: "SafeTx",
    message: tx,
  } as const
}

/** The SafeTx hash, equal to the Safe's own getTransactionHash. */
export function hashSafeTx(safe: Address, tx: SafeTx): Hex {
  return hashTypedData(safeTxTypedData(safe, tx))
}

/**
 * Some wallets (hardware, over WalletConnect) return v as 0 or 1; the Safe
 * and its Transaction Service expect 27 or 28 for an EIP-712 signature.
 */
export function normalizeSignature(signature: Hex): Hex {
  const v = hexToNumber(sliceHex(signature, 64, 65))
  if (v >= 27) return signature
  const fixed = (v + 27).toString(16).padStart(2, "0")
  return `${sliceHex(signature, 0, 64)}${fixed}`
}
