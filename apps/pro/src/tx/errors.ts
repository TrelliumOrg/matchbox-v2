import {
  type Abi,
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  type Hex,
  isHex,
} from "viem"
import { isUserRejection } from "../wallet/wallets"

/**
 * What a failed step says. Terse, per the guideline: what happened, never
 * "Oops". A revert from the simulation or the receipt is named from the
 * contract's custom errors; a wallet rejection is "Signature rejected".
 */

export const rejectedCopy = "Signature rejected"

/** What a failure says when nothing more specific is known. */
export const fallbackCopy = "Transaction failed"

const revertCopy: Record<string, string> = {
  DistributeWindow: "Voting opens at 01:00 UTC",
  AlreadyVotedOrDeposited: "Voted this epoch",
  NotWhitelistedNFT: "Last hour, whitelisted locks only",
  SpecialVotingWindow: "Last hour, whitelisted locks only",
  NotApprovedOrOwner: "Not your lock",
  NotOwner: "Not your lock",
  GaugeNotAlive: "Gauge is inactive",
  GaugeDoesNotExist: "Not a gauge",
  TooManyGauges: "Over 30 gauges",
  TooManyPools: "Over 30 pools",
  ZeroBalance: "No voting power",
  InactiveManagedNFT: "Managed lock inactive",
  AlreadyVoted: "Clear this lock's votes first",
  LockDurationNotInFuture: "Pick a later unlock",
  LockDurationTooLong: "Longer than the maximum",
  LockExpired: "Lock expired",
  LockNotExpired: "Lock not expired yet",
  PermanentLock: "Auto max is on",
  NotPermanentLock: "Auto max is off",
  SameNFT: "Pick another lock",
  NotNormalNFT: "Lock cannot change",
  NoLockFound: "Lock not found",
  NonExistentToken: "Lock not found",
  ZeroAmount: "Enter an amount",
  AmountTooBig: "Amount too large",
  NotWhitelistedToken: "Token not accepted",
  NotWhitelisted: "Token not accepted",
  InvalidReward: "Token not accepted",
  NotManagedOrNormalNFT: "Lock cannot move",
  OwnershipChange: "Lock changed owner this block",
  ERC721ReceiverRejectedTokens: "Recipient cannot hold locks",
  ERC721TransferToNonERC721ReceiverImplementer: "Recipient cannot hold locks",
  GS013: "Safe call failed",
}

function revertName(error: unknown, abi: Abi): string | null {
  if (!(error instanceof BaseError)) return null
  const reverted = error.walk(
    (inner) => inner instanceof ContractFunctionRevertedError,
  )
  if (reverted instanceof ContractFunctionRevertedError) {
    return reverted.data?.errorName ?? reverted.reason ?? null
  }
  // eth_call through `call` gives raw revert data, not a decoded error.
  const data = revertData(error)
  if (data === null || data.length < 10) return null
  try {
    return decodeErrorResult({ abi, data }).errorName
  } catch {
    return null
  }
}

/** The raw revert data an eth_call error carries, or null. */
export function revertData(error: unknown): Hex | null {
  if (!(error instanceof BaseError)) return null
  const raw = error.walk(
    (inner) =>
      typeof inner === "object" &&
      inner !== null &&
      typeof Reflect.get(inner, "data") === "string",
  )
  const data: unknown =
    raw !== null && typeof raw === "object" ? Reflect.get(raw, "data") : null
  return isHex(data) ? data : null
}

/** The copy for raw revert data, decoded with `abi`; null when unknown. */
export function revertDataCopy(data: Hex, abi: Abi): string | null {
  if (data.length < 10) return null
  try {
    const name = decodeErrorResult({ abi, data }).errorName
    return revertCopy[name] ?? null
  } catch {
    return null
  }
}

function plainReason(error: unknown): string {
  const text =
    error instanceof BaseError
      ? error.shortMessage
      : error instanceof Error
        ? error.message
        : String(error)
  if (/insufficient (funds|balance)|exceeds balance/i.test(text))
    return "Not enough balance"
  if (/allowance/i.test(text)) return "Approval too low"
  if (/user rejected|denied/i.test(text)) return rejectedCopy
  if (/chain|network/i.test(text) && /mismatch|switch/i.test(text))
    return "Switch to Mezo in your wallet"
  return fallbackCopy
}

/** The status word for a failed step. */
export function failureCopy(error: unknown, abi: Abi): string {
  if (isUserRejection(error)) return rejectedCopy
  const name = revertName(error, abi)
  if (name !== null) return revertCopy[name] ?? plainReason(error)
  return plainReason(error)
}

/**
 * The decoded reason for a revert, or null when it says nothing more than
 * "Transaction failed" (a mined revert replayed without data).
 */
export function revertReason(error: unknown, abi: Abi): string | null {
  const copy = failureCopy(error, abi)
  return copy === fallbackCopy ? null : copy
}

export class RevertedError extends Error {
  constructor(
    readonly hash: Hex,
    readonly blockNumber: bigint,
  ) {
    super("Transaction reverted")
    this.name = "RevertedError"
  }
}
