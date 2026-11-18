import {
  type Config,
  call,
  getAccount,
  sendTransaction,
  waitForTransactionReceipt,
} from "@wagmi/core"
import type { Address, Hex, TransactionReceipt } from "viem"
import { mezoChainId, switchToMezo } from "../wallet/wallet-runtime"
import {
  failureCopy,
  RevertedError,
  rejectedCopy,
  revertReason,
} from "./errors"
import type { PlanStep, PreparedCall } from "./plans"
import type { StepEvent, StepFailure } from "./steps"

/**
 * Runs a plan from `startAt`, one wallet prompt per step. Each step is
 * simulated with eth_call from the connected account right before the
 * wallet opens, so a revert (the voting window, a lock that is not yours)
 * shows in the sheet instead of the wallet. A step mined but reverted is
 * replayed at its block to name the reason. Resolves with the receipts by
 * step id, or stops at the first failure.
 */

export type RunFailure = {
  id: string
  failure: StepFailure
  /** The decoded reason, null when there is none. */
  error: string | null
  /** The reverted transaction, for "View on Matchscan". */
  hash: Hex | null
  block: bigint | null
}

export type RunResult =
  | { ok: true; receipts: Map<string, TransactionReceipt> }
  | {
      ok: false
      receipts: Map<string, TransactionReceipt>
      failure: RunFailure
    }

export async function simulate(
  config: Config,
  account: Address,
  prepared: PreparedCall,
  blockNumber?: bigint,
): Promise<void> {
  await call(config, {
    account,
    to: prepared.to,
    data: prepared.data,
    ...(prepared.value === undefined ? {} : { value: prepared.value }),
    ...(blockNumber === undefined ? {} : { blockNumber }),
    chainId: mezoChainId,
  })
}

/** Why a mined call reverted, replayed with eth_call at its block. */
async function minedReason(
  config: Config,
  account: Address,
  prepared: PreparedCall,
  block: bigint,
): Promise<string | null> {
  try {
    await simulate(config, account, prepared, block)
    return null
  } catch (error) {
    return revertReason(error, prepared.abi)
  }
}

export async function runPlan(input: {
  config: Config
  account: Address
  steps: readonly PlanStep[]
  startAt: number
  receipts: Map<string, TransactionReceipt>
  onEvent: (event: StepEvent) => void
}): Promise<RunResult> {
  const { config, account, steps, onEvent } = input
  const receipts = new Map(input.receipts)
  for (const step of steps.slice(input.startAt)) {
    let prepared: PreparedCall | null = null
    try {
      onEvent({ type: "simulating", id: step.id })
      if (getAccount(config).chainId !== mezoChainId) await switchToMezo(config)
      prepared = step.prepare(receipts)
      await simulate(config, account, prepared)
      onEvent({ type: "wallet", id: step.id })
      const hash = await sendTransaction(config, {
        account,
        to: prepared.to,
        data: prepared.data,
        ...(prepared.value === undefined ? {} : { value: prepared.value }),
        chainId: mezoChainId,
      })
      onEvent({ type: "submitted", id: step.id, hash })
      const receipt = await waitForTransactionReceipt(config, {
        hash,
        chainId: mezoChainId,
      })
      if (receipt.status !== "success") {
        throw new RevertedError(hash, receipt.blockNumber)
      }
      receipts.set(step.id, receipt)
      onEvent({ type: "done", id: step.id })
    } catch (error) {
      const failure = await describeFailure(config, account, prepared, error)
      onEvent({
        type: "failed",
        id: step.id,
        error: failure.error,
        failure: failure.failure,
      })
      return { ok: false, receipts, failure: { id: step.id, ...failure } }
    }
  }
  return { ok: true, receipts }
}

async function describeFailure(
  config: Config,
  account: Address,
  prepared: PreparedCall | null,
  error: unknown,
): Promise<Omit<RunFailure, "id">> {
  if (error instanceof RevertedError) {
    return {
      failure: "chain",
      error:
        prepared === null
          ? null
          : await minedReason(config, account, prepared, error.blockNumber),
      hash: error.hash,
      block: error.blockNumber,
    }
  }
  const copy = failureCopy(error, prepared?.abi ?? [])
  return {
    failure: copy === rejectedCopy ? "rejected" : "check",
    error: copy,
    hash: null,
    block: null,
  }
}
