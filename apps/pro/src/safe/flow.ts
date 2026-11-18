import {
  type Config,
  getTransactionReceipt,
  sendCalls,
  sendTransaction,
} from "@wagmi/core"
import type { Address, Hex, TransactionReceipt } from "viem"
import type { PlanStep } from "../tx/plans"
import { mezoChainId } from "../wallet/wallet-runtime"
import {
  proposalSplitCopy,
  type SafeBatches,
  safeCallFor,
  splitForSafe,
} from "./batch"
import { isOwner, proposeToSafe, readSafe, type SafeInfo } from "./propose"
import type { SafeRoute } from "./route"
import { sendFromSafeApp } from "./safe-app"
import { type ProposalStatus, readProposal } from "./service"
import { type SafeSimulation, simulateSafeBatch } from "./simulate"
import { safeQueueUrl, safeTxUrl } from "./urls"

/**
 * What TxSheet loads (dynamically) for a Safe route: the review (one batch,
 * simulated as the Safe), the proposal, and the status poll. One module so
 * a wallet review never fetches any of it.
 */

export type SafeReview = {
  safe: Address
  batches: SafeBatches
  simulation: SafeSimulation
  info: SafeInfo
  /** Why the proposal cannot go now, or null. */
  blocked: string | null
  /** "2 Safe transactions, step 3 needs the new lock id" */
  split: string | null
}

function lowerFirst(text: string): string {
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`
}

export function simulationCopy(simulation: SafeSimulation): string | null {
  if (simulation.ok) return null
  if (simulation.index === null) return "Simulation failed"
  const step = `Step ${simulation.index + 1} fails`
  return simulation.reason === null
    ? step
    : `${step}, ${lowerFirst(simulation.reason)}`
}

export async function reviewForSafe(input: {
  config: Config
  route: SafeRoute
  /** The owner's wallet, for "propose". */
  signer: Address
  steps: readonly PlanStep[]
  receipts?: ReadonlyMap<string, TransactionReceipt>
  startAt?: number
}): Promise<SafeReview> {
  const { config, route } = input
  const safe = route.safe
  const batches = splitForSafe(input.steps, input.receipts, input.startAt)
  const [info, simulation] = await Promise.all([
    readSafe(config, safe),
    simulateSafeBatch(config, safe, batches.now),
  ])
  const notOwner =
    route.kind === "propose" && !isOwner(info, input.signer)
      ? "Connected wallet is not an owner"
      : null
  return {
    safe,
    batches,
    simulation,
    info,
    blocked:
      notOwner ??
      (batches.now.length === 0
        ? "Nothing to propose yet"
        : simulationCopy(simulation)),
    split: proposalSplitCopy(batches),
  }
}

export type SafeSubmitted = {
  safe: Address
  /** The SafeTx hash, when the route returns one. */
  safeTxHash: Hex | null
  /** Where co-signers confirm: the transaction, else the queue. */
  url: string
  threshold: number
  /** Owners who signed when proposed (the proposer, for "propose"). */
  signed: number
}

export async function submitToSafe(input: {
  config: Config
  route: SafeRoute
  signer: Address
  review: SafeReview
}): Promise<SafeSubmitted> {
  const { config, route, review } = input
  const calls = review.batches.now.map((each) => each.call)
  const threshold = review.info.threshold
  switch (route.kind) {
    case "propose": {
      const proposal = await proposeToSafe({
        config,
        safe: route.safe,
        owner: input.signer,
        call: safeCallFor(calls),
        info: review.info,
      })
      return {
        safe: proposal.safe,
        safeTxHash: proposal.safeTxHash,
        url: proposal.url,
        threshold,
        signed: 1,
      }
    }
    case "safe-app": {
      const safeTxHash = await sendFromSafeApp(calls)
      return {
        safe: route.safe,
        safeTxHash,
        url: safeTxUrl(route.safe, safeTxHash),
        threshold,
        signed: 0,
      }
    }
    case "safe-walletconnect": {
      if (route.batch) {
        await sendCalls(config, {
          account: route.safe,
          chainId: mezoChainId,
          calls: calls.map((call) => ({
            to: call.to,
            data: call.data,
            ...(call.value === undefined ? {} : { value: call.value }),
          })),
        })
      } else {
        // No EIP-5792: Safe{Wallet} queues one proposal per call.
        for (const call of calls) {
          await sendTransaction(config, {
            account: route.safe,
            to: call.to,
            data: call.data,
            ...(call.value === undefined ? {} : { value: call.value }),
            chainId: mezoChainId,
          })
        }
      }
      return {
        safe: route.safe,
        safeTxHash: null,
        url: safeQueueUrl(route.safe),
        threshold,
        signed: 0,
      }
    }
  }
}

export const pollMs = 10_000

/**
 * Polls the Transaction Service every 10s while the sheet is open; stops
 * when executed or when the returned function runs (sheet closed).
 */
export function watchProposal(
  safeTxHash: Hex,
  onStatus: (status: ProposalStatus) => void,
  interval = pollMs,
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  async function tick(): Promise<void> {
    try {
      const status = await readProposal(safeTxHash)
      if (stopped) return
      onStatus(status)
      if (status.executed) return
    } catch {
      // The service can lag the proposal by a moment: try again next tick.
    }
    if (!stopped) timer = setTimeout(() => void tick(), interval)
  }
  void tick()
  return () => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
  }
}

/**
 * Receipts for the steps an executed proposal carried, so the second
 * proposal can read what it needed (the minted lock id).
 */
export async function executedReceipts(input: {
  config: Config
  hash: Hex
  review: SafeReview
  receipts: ReadonlyMap<string, TransactionReceipt>
}): Promise<Map<string, TransactionReceipt>> {
  const receipt = await getTransactionReceipt(input.config, {
    hash: input.hash,
    chainId: mezoChainId,
  })
  const next = new Map(input.receipts)
  for (const { step } of input.review.batches.now) next.set(step.id, receipt)
  return next
}

export type { ProposalStatus, SafeRoute }
