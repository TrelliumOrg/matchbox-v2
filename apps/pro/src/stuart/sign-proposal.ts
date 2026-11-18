import type { CallStatus, Proposal } from "@matchbox/stuart-ui/contract"
import type {
  StuartSignOutcome,
  StuartSignRequest,
  StuartSignResult,
} from "@matchbox/stuart-ui/store"

/**
 * Stuart's proposals signed with Pro's own steps: review (the proposal is
 * for this wallet and this chain, and passes Pro's approval rules), then per
 * call simulate, wallet, confirm, and a toast once every call is mined. The
 * same order as the transaction sheets (`../tx/runner`). Pure: the wallet,
 * the RPC and the toast come in as `SignerDeps`, so every path is tested
 * without wagmi.
 *
 * Calls run one at a time in index order, each simulated right before its
 * prompt, so a call that depends on an earlier one is checked against the
 * state that call left. Stuart never submits; this reports what the wallet
 * reports.
 */

export type SignerCall = Proposal["calls"][number]

export type SignerReceipt = {
  hash: `0x${string}`
  status: "success" | "reverted"
  blockNumber: bigint
}

export type SignerDeps = {
  /** The connected account, or null when no wallet is connected. */
  account: () => string | null
  chainId: number
  /** Asks the wallet for the chain when it is elsewhere. */
  ensureChain: () => Promise<void>
  /** eth_call from the account; throws on a revert. */
  simulate: (call: SignerCall) => Promise<void>
  /** Opens the wallet; resolves with the hash once signed. */
  send: (call: SignerCall) => Promise<`0x${string}`>
  wait: (hash: `0x${string}`) => Promise<SignerReceipt>
  /** The status word for a failed simulation or send. */
  failure: (error: unknown) => string
  isRejection: (error: unknown) => boolean
  /** Toast and refresh, once every call is mined. */
  done: (proposal: Proposal, last: SignerReceipt) => void
}

export const signerCopy = {
  rejected: "Signature rejected",
  reverted: "Reverted on chain",
  unconfirmed: "Not confirmed yet",
  wrongWallet: "Connect this wallet",
  wrongChain: "Wrong network",
  cannotSign: "Not ready to sign",
  unlimitedApproval: "Unlimited approval blocked",
  lockApproval: "Lock approval blocked",
} as const

const approveSelector = "0x095ea7b3"
const setApprovalForAllSelector = "0xa22cb465"
const maxUint256 = (1n << 256n) - 1n

/** veMEZO and veBTC on mainnet: an approval there hands over the lock. */
const escrows = new Set([
  "0xb90fdad3dfd180458d62cc6acedc983d78e20122",
  "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279",
])

/**
 * Pro's approval rules, applied to every call before anything is signed:
 * ERC-20 approvals are exact (never unlimited) and nothing is ever approved
 * on a lock escrow, where an approval is custody.
 */
export function policyBlock(call: SignerCall): string | null {
  const data = call.data.toLowerCase()
  const selector = data.slice(0, 10)
  if (selector === setApprovalForAllSelector) return signerCopy.lockApproval
  if (selector !== approveSelector) return null
  if (escrows.has(call.to.toLowerCase())) return signerCopy.lockApproval
  const amount = data.slice(74, 138)
  if (amount.length === 64 && BigInt(`0x${amount}`) === maxUint256) {
    return signerCopy.unlimitedApproval
  }
  return null
}

type CallState = CallStatus["calls"][number]

function initialCalls(calls: readonly SignerCall[]): CallState[] {
  return calls.map((call) => ({
    index: call.index,
    label: call.label,
    status: "not_sent",
    hash: null,
    error: null,
    doNotRepeat: false,
    retryable: true,
  }))
}

/** Checks the proposal as a whole; returns the reason it cannot be signed. */
function review(proposal: Proposal, deps: SignerDeps): string | null {
  const account = deps.account()?.toLowerCase() ?? null
  const from = proposal.from.toLowerCase()
  if (account === null || account !== from) return signerCopy.wrongWallet
  if (proposal.chainId !== deps.chainId) return signerCopy.wrongChain
  if (!proposal.canSign) return signerCopy.cannotSign
  for (const call of proposal.calls) {
    if (call.from.toLowerCase() !== from) return signerCopy.wrongWallet
    if (call.chainId !== deps.chainId) return signerCopy.wrongChain
  }
  return null
}

export async function signProposal(
  { proposal, onStatus, signal }: StuartSignRequest,
  deps: SignerDeps,
): Promise<StuartSignResult> {
  const calls = [...proposal.calls].sort((a, b) => a.index - b.index)
  let states = initialCalls(calls)
  const hashes: string[] = []

  function emit(outcome: CallStatus["outcome"]): void {
    onStatus({
      type: "call_status",
      version: 1,
      proposalId: proposal.proposalId,
      outcome,
      calls: states,
      remaining: null,
    })
  }

  function update(index: number, patch: Partial<CallState>): void {
    states = states.map((state) =>
      state.index === index ? { ...state, ...patch } : state,
    )
    emit("in_progress")
  }

  /** Some calls mined and a later one did not: partial, whatever stopped it. */
  function finish(outcome: StuartSignOutcome): StuartSignResult {
    const mined = states.some((state) => state.status === "mined")
    const result: StuartSignOutcome =
      outcome === "success" ? "success" : mined ? "partial" : outcome
    emit(result === "rejected" ? "failed" : result)
    return { outcome: result, hashes }
  }

  const blocked =
    review(proposal, deps) ??
    calls.map(policyBlock).find((reason) => reason !== null) ??
    null
  if (blocked !== null) {
    states = states.map((state) => ({
      ...state,
      error: blocked,
      retryable: false,
    }))
    return finish("failed")
  }

  let last: SignerReceipt | null = null
  for (const call of calls) {
    if (signal.aborted) return finish("rejected")
    try {
      await deps.ensureChain()
      await deps.simulate(call)
    } catch (error) {
      if (deps.isRejection(error)) {
        update(call.index, { status: "rejected", error: signerCopy.rejected })
        return finish("rejected")
      }
      update(call.index, { status: "reverted", error: deps.failure(error) })
      return finish("failed")
    }
    if (signal.aborted) return finish("rejected")

    update(call.index, { status: "awaiting_wallet", error: null })
    let hash: `0x${string}`
    try {
      hash = await deps.send(call)
    } catch (error) {
      if (deps.isRejection(error)) {
        update(call.index, { status: "rejected", error: signerCopy.rejected })
        return finish("rejected")
      }
      update(call.index, { status: "not_sent", error: deps.failure(error) })
      return finish("failed")
    }
    hashes.push(hash)
    update(call.index, { status: "submitted", hash })

    try {
      last = await deps.wait(hash)
    } catch {
      // It may still land: never offer to send it again.
      update(call.index, {
        error: signerCopy.unconfirmed,
        doNotRepeat: true,
        retryable: false,
      })
      return finish("failed")
    }
    if (last.status !== "success") {
      update(call.index, { status: "reverted", error: signerCopy.reverted })
      return finish("failed")
    }
    update(call.index, { status: "mined" })
  }

  if (last !== null) deps.done(proposal, last)
  return finish("success")
}
