import { describe, expect, it } from "vitest"
import {
  applyStepEvent,
  buttonLabel,
  failedOnChainCopy,
  nextStepIndex,
  retryFrom,
  retryLabel,
  signingPhase,
  startSigning,
  stepDetail,
  stepLink,
} from "./steps"

/** The item at `index`, failing the test when it is missing. */
function nth<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) throw new Error(`No item ${index}`)
  return item
}

const plan = [
  { id: "approve", label: "Approve 6,000.00 MEZO" },
  { id: "add", label: "Add to #2207" },
]
const hash = `0x${"ab".repeat(32)}` as const

describe("signing steps", () => {
  it("starts on the first step, simulating", () => {
    const steps = startSigning(plan)
    expect(steps.map((step) => step.status)).toEqual(["active", "pending"])
    expect(stepDetail(nth(steps, 0))).toBe("Checking")
    expect(stepDetail(nth(steps, 1))).toBeUndefined()
    expect(signingPhase(steps)).toBe("signing")
  })

  it("walks wallet, confirming and done, then the next step", () => {
    let steps = startSigning(plan)
    steps = applyStepEvent(steps, { type: "wallet", id: "approve" })
    expect(stepDetail(nth(steps, 0))).toBe("Confirm in your wallet")
    expect(buttonLabel(steps)).toBe("Waiting for wallet")
    steps = applyStepEvent(steps, { type: "submitted", id: "approve", hash })
    expect(steps[0]?.hash).toBe(hash)
    expect(buttonLabel(steps)).toBe("Waiting for block")
    steps = applyStepEvent(steps, { type: "done", id: "approve" })
    steps = applyStepEvent(steps, { type: "wallet", id: "add" })
    expect(stepDetail(nth(steps, 0))).toBe("Signed")
    expect(nextStepIndex(steps)).toBe(1)
    steps = applyStepEvent(steps, { type: "done", id: "add" })
    expect(signingPhase(steps)).toBe("done")
    expect(nextStepIndex(steps)).toBe(-1)
  })

  it("shows a rejection and resumes at the failed step", () => {
    let steps = startSigning(plan)
    steps = applyStepEvent(steps, { type: "done", id: "approve" })
    steps = applyStepEvent(steps, {
      type: "failed",
      id: "add",
      error: "Signature rejected",
      failure: "rejected",
    })
    expect(signingPhase(steps)).toBe("failed")
    expect(stepDetail(nth(steps, 1))).toBe("Signature rejected")
    expect(retryLabel(steps)).toBe("Try again")
    expect(stepLink(nth(steps, 1))).toBeNull()
    steps = retryFrom(steps)
    expect(steps.map((step) => step.status)).toEqual(["done", "active"])
    expect(steps[1]?.error).toBeNull()
  })

  it("shows a step that failed on chain with its reason, link and retry", () => {
    const three = [
      { id: "claim", label: "Claim 958.96 MEZO" },
      { id: "approve", label: "Allow 958.96 MEZO" },
      { id: "add", label: "Add to veMEZO #2930" },
    ]
    let steps = startSigning(three)
    steps = applyStepEvent(steps, { type: "submitted", id: "claim", hash })
    steps = applyStepEvent(steps, { type: "done", id: "claim" })
    steps = applyStepEvent(steps, { type: "done", id: "approve" })
    const reverted = `0x${"cd".repeat(32)}` as const
    steps = applyStepEvent(steps, {
      type: "submitted",
      id: "add",
      hash: reverted,
    })
    steps = applyStepEvent(steps, {
      type: "failed",
      id: "add",
      error: "Lock expired",
      failure: "chain",
    })
    expect(stepDetail(nth(steps, 2))).toBe("Failed on chain, lock expired")
    expect(stepLink(nth(steps, 2))).toEqual({
      href: `https://scan.matchbox.markets/tx/${reverted}`,
      label: "View on Matchscan",
    })
    expect(stepLink(nth(steps, 0))).toEqual({
      href: `https://scan.matchbox.markets/tx/${hash}`,
      label: "view on Matchscan",
    })
    expect(retryLabel(steps)).toBe("Try step 3 again")
    steps = retryFrom(steps)
    expect(steps.map((step) => step.status)).toEqual(["done", "done", "active"])
    expect(steps[0]?.hash).toBe(hash)
    expect(nextStepIndex(steps)).toBe(2)
  })

  it("says only what is known about a mined revert", () => {
    expect(failedOnChainCopy(null)).toBe("Failed on chain")
    let steps = startSigning([{ id: "vote", label: "Vote with #2207" }])
    steps = applyStepEvent(steps, {
      type: "failed",
      id: "vote",
      error: null,
      failure: "chain",
    })
    expect(stepDetail(nth(steps, 0))).toBe("Failed on chain")
    expect(retryLabel(steps)).toBe("Try again")
  })

  it("drops the hash of a step stopped before it was sent", () => {
    let steps = startSigning(plan)
    steps = applyStepEvent(steps, {
      type: "failed",
      id: "approve",
      error: "Voted this epoch",
      failure: "check",
    })
    expect(stepDetail(nth(steps, 0))).toBe("Voted this epoch")
    expect(stepLink(nth(steps, 0))).toBeNull()
  })
})
