import { MULTI_SEND_CALL_ONLY_ABI, SAFE_CONTRACTS } from "@matchbox/chain"
import {
  type Address,
  concatHex,
  encodeFunctionData,
  encodePacked,
  type Hex,
  size,
  type TransactionReceipt,
} from "viem"
import type { PlanStep, PreparedCall } from "../tx/plans"

/**
 * A plan as Safe transactions. Every step's call comes from the same
 * `PlanStep.prepare` the wallet path signs, and the calls go to the Safe as
 * ONE transaction: a DELEGATECALL to Mezo's canonical MultiSendCallOnly, so
 * the Safe is msg.sender of every inner call and an approve followed by
 * the call that spends it works in one execution. The only split is a step
 * that needs a value known after execution (the minted lock id): it and
 * everything after it wait for a second proposal. Pure.
 */

export type SafeOperation = 0 | 1

/** What the Safe executes: a CALL, or a DELEGATECALL to MultiSendCallOnly. */
export type SafeCall = {
  to: Address
  value: bigint
  data: Hex
  operation: SafeOperation
}

export type BatchedStep = { step: PlanStep; index: number; call: PreparedCall }

export type SafeBatches = {
  /** Steps whose calls are known now, in plan order. */
  now: BatchedStep[]
  /** Steps that wait for `now` to execute. */
  later: { step: PlanStep; index: number }[]
  /** The first waiting step and what it needs, or null when nothing waits. */
  gap: { index: number; needs: string } | null
}

const earlierReceipt = "an earlier step"

/**
 * Splits a plan where a step needs a receipt. `receipts` carries what
 * earlier proposals produced, so the second proposal computes the rest.
 */
export function splitForSafe(
  steps: readonly PlanStep[],
  receipts: ReadonlyMap<string, TransactionReceipt> = new Map(),
  startAt = 0,
): SafeBatches {
  const now: BatchedStep[] = []
  for (let index = startAt; index < steps.length; index++) {
    const step = steps[index]
    if (step === undefined) break
    const waiting = (needs: string): SafeBatches => ({
      now,
      later: steps
        .slice(index)
        .map((each, offset) => ({ step: each, index: index + offset })),
      gap: { index, needs },
    })
    if (step.awaits !== undefined && !hasReceiptsFor(steps, index, receipts)) {
      return waiting(step.awaits)
    }
    try {
      now.push({ step, index, call: step.prepare(receipts) })
    } catch {
      return waiting(step.awaits ?? earlierReceipt)
    }
  }
  return { now, later: [], gap: null }
}

/** Every step before `index` has a receipt (it executed). */
function hasReceiptsFor(
  steps: readonly PlanStep[],
  index: number,
  receipts: ReadonlyMap<string, TransactionReceipt>,
): boolean {
  return steps.slice(0, index).every((step) => receipts.has(step.id))
}

/**
 * MultiSend's packed encoding: per call, operation (uint8), to (address),
 * value (uint256), data length (uint256), data. MultiSendCallOnly only
 * accepts operation 0.
 */
export function encodeMultiSend(calls: readonly PreparedCall[]): Hex {
  const packed = calls.map((call) =>
    encodePacked(
      ["uint8", "address", "uint256", "uint256", "bytes"],
      [0, call.to, call.value ?? 0n, BigInt(size(call.data)), call.data],
    ),
  )
  return encodeFunctionData({
    abi: MULTI_SEND_CALL_ONLY_ABI,
    functionName: "multiSend",
    args: [packed.length === 0 ? "0x" : concatHex(packed)],
  })
}

/**
 * The one call the Safe executes: the call itself when there is one, else
 * the batch through MultiSendCallOnly (DELEGATECALL, value 0: inner values
 * come from the Safe's balance).
 */
export function safeCallFor(calls: readonly PreparedCall[]): SafeCall {
  const only = calls.length === 1 ? calls[0] : undefined
  if (only !== undefined) {
    return {
      to: only.to,
      value: only.value ?? 0n,
      data: only.data,
      operation: 0,
    }
  }
  return {
    to: SAFE_CONTRACTS.mainnet.multiSendCallOnly,
    value: 0n,
    data: encodeMultiSend(calls),
    operation: 1,
  }
}

/** "2 Safe transactions, step 3 needs the new lock id" */
export function proposalSplitCopy(batches: SafeBatches): string | null {
  if (batches.gap === null) return null
  return `2 Safe transactions, step ${batches.gap.index + 1} needs ${batches.gap.needs}`
}

/** "Step 3 needs the new lock id: export it after step 2 lands" */
export function exportSplitCopy(batches: SafeBatches): string | null {
  if (batches.gap === null) return null
  const step = batches.gap.index + 1
  if (step === 1) return `Step 1 needs ${batches.gap.needs}`
  return `Step ${step} needs ${batches.gap.needs}: export it after step ${step - 1} lands`
}
