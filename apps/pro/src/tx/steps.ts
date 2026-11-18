import type { Hex } from "viem"

/**
 * Signing progress, one row per signature (ported from feat/pro-rebuild
 * features/locks/signing.ts and gauges/signing.ts). Pure, so the sheets'
 * states are tested without a wallet.
 */

export type StepStatus = "pending" | "active" | "done" | "failed"

/**
 * Why a step failed: the wallet declined, the check before the wallet
 * (simulation, chain switch) stopped it, or it was mined and reverted.
 */
export type StepFailure = "rejected" | "check" | "chain"

export const scanTxUrl = (hash: string): string =>
  `https://scan.matchbox.markets/tx/${hash}`

export type SigningStep = {
  id: string
  label: string
  status: StepStatus
  /** While active: simulating, waiting on the wallet, or on a block. */
  phase: "simulating" | "wallet" | "confirming"
  hash: Hex | null
  /** The decoded reason ("Lock expired"); null when none was found. */
  error: string | null
  failure: StepFailure | null
}

export type StepEvent =
  | { type: "simulating"; id: string }
  | { type: "wallet"; id: string }
  | { type: "submitted"; id: string; hash: Hex }
  | { type: "done"; id: string }
  | { type: "failed"; id: string; error: string | null; failure: StepFailure }

export function startSigning(
  steps: readonly { id: string; label: string }[],
): SigningStep[] {
  return steps.map((step, index) => ({
    id: step.id,
    label: step.label,
    status: index === 0 ? "active" : "pending",
    phase: "simulating",
    hash: null,
    error: null,
    failure: null,
  }))
}

export function applyStepEvent(
  steps: readonly SigningStep[],
  event: StepEvent,
): SigningStep[] {
  return steps.map((step) => {
    if (step.id !== event.id) return step
    switch (event.type) {
      case "simulating":
      case "wallet":
        return {
          ...step,
          status: "active",
          phase: event.type,
          hash: null,
          error: null,
          failure: null,
        }
      case "submitted":
        return {
          ...step,
          status: "active",
          phase: "confirming",
          hash: event.hash,
        }
      case "done":
        return { ...step, status: "done", error: null, failure: null }
      case "failed":
        return {
          ...step,
          status: "failed",
          error: event.error,
          failure: event.failure,
          // Only a mined transaction has a hash worth linking.
          hash: event.failure === "chain" ? step.hash : null,
        }
      default:
        return step
    }
  })
}

/** Retrying resumes at the failed step; done steps stay done. */
export function retryFrom(steps: readonly SigningStep[]): SigningStep[] {
  const index = steps.findIndex((step) => step.status === "failed")
  if (index < 0) return [...steps]
  return steps.map((step, i) => {
    if (i < index || step.status === "done") return step
    return {
      ...step,
      status: i === index ? "active" : "pending",
      phase: "simulating",
      error: null,
      failure: null,
      hash: null,
    }
  })
}

export type SigningPhase = "signing" | "failed" | "done"

export function signingPhase(steps: readonly SigningStep[]): SigningPhase {
  if (steps.length > 0 && steps.every((step) => step.status === "done"))
    return "done"
  if (steps.some((step) => step.status === "failed")) return "failed"
  return "signing"
}

/** The first step still to sign, where a retry resumes. */
export function nextStepIndex(steps: readonly SigningStep[]): number {
  return steps.findIndex((step) => step.status !== "done")
}

function lowerFirst(text: string): string {
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`
}

/** "Failed on chain, lock expired", or bare when the reason is unknown. */
export function failedOnChainCopy(reason: string | null): string {
  return reason === null
    ? "Failed on chain"
    : `Failed on chain, ${lowerFirst(reason)}`
}

/** The status word under a step's label. */
export function stepDetail(step: SigningStep): string | undefined {
  if (step.status === "done") return "Signed"
  if (step.status === "failed") {
    if (step.failure === "chain") return failedOnChainCopy(step.error)
    return step.error ?? "Transaction failed"
  }
  if (step.status === "pending") return undefined
  if (step.phase === "simulating") return "Checking"
  if (step.phase === "wallet") return "Confirm in your wallet"
  return "Confirming"
}

/** The pinned button's label while signing. */
export function buttonLabel(steps: readonly SigningStep[]): string {
  const active = steps.find((step) => step.status === "active")
  if (active?.phase === "confirming") return "Waiting for block"
  if (active?.phase === "simulating") return "Checking"
  return "Waiting for wallet"
}

/**
 * The Matchscan link under a step: a signed step's transaction, inline
 * ("Signed, view on Matchscan"), or the reverted one under a failure.
 */
export function stepLink(
  step: SigningStep,
): { href: string; label: string } | null {
  if (step.hash === null) return null
  if (step.status === "done") {
    return { href: scanTxUrl(step.hash), label: "view on Matchscan" }
  }
  if (step.status === "failed" && step.failure === "chain") {
    return { href: scanTxUrl(step.hash), label: "View on Matchscan" }
  }
  return null
}

/** The failed step and its place, or null. */
export function failedStep(
  steps: readonly SigningStep[],
): { step: SigningStep; index: number } | null {
  const index = steps.findIndex((step) => step.status === "failed")
  const step = steps[index]
  return step === undefined ? null : { step, index }
}

/**
 * The pinned button after a failure: "Try again" after a rejection or for
 * a one-step plan, else "Try step 3 again" (finished steps stay done).
 */
export function retryLabel(steps: readonly SigningStep[]): string {
  const failed = failedStep(steps)
  if (failed === null) return "Try again"
  if (failed.step.failure === "rejected" || steps.length === 1) {
    return "Try again"
  }
  return `Try step ${failed.index + 1} again`
}
