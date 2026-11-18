import { type FetchLike, readJson, trimEndpoint } from "./client"
import {
  type CallStatus,
  type Proposal,
  type ProposalRefreshResponse,
  proposalRefreshRequestSchema,
  proposalRefreshResponseSchema,
  STUART_PATHS,
  stuartErrorSchema,
  type WalletMode,
} from "./contract"
import type { StuartSigner, StuartSignResult } from "./store"

/**
 * Before a wallet prompt, a proposal is refreshed against the latest block.
 * A material change must be acknowledged first; only then does the host's
 * signer see the fresh proposal. Stuart never submits: it reports what the
 * wallet reports.
 */

export type RefreshResult =
  | {
      kind: "ready"
      proposal: Proposal
      refresh: ProposalRefreshResponse | null
    }
  | { kind: "material"; refresh: ProposalRefreshResponse }
  | { kind: "failed"; message: string }

export type RefreshInput = {
  endpoint: string | null
  proposal: Proposal
  wallet: { address: string; mode: WalletMode }
  signal: AbortSignal
  fetchImpl?: FetchLike
}

export async function refreshProposal({
  endpoint,
  proposal,
  wallet,
  signal,
  fetchImpl = (input, init) => fetch(input, init),
}: RefreshInput): Promise<RefreshResult> {
  if (endpoint === null || endpoint === "") {
    return { kind: "ready", proposal, refresh: null }
  }
  const body = proposalRefreshRequestSchema.parse({
    version: 1,
    proposal,
    wallet,
  })
  let response: Response
  try {
    response = await fetchImpl(
      `${trimEndpoint(endpoint)}${STUART_PATHS.refresh}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
        signal,
      },
    )
  } catch {
    return { kind: "failed", message: "Refresh failed" }
  }
  const json = readJson(await response.text().catch(() => ""))
  if (!response.ok) {
    const error = stuartErrorSchema.safeParse(json)
    if (error.success && error.data.error.code === "proposal_expired") {
      return { kind: "failed", message: "Request expired" }
    }
    return { kind: "failed", message: "Refresh failed" }
  }
  const parsed = proposalRefreshResponseSchema.safeParse(json)
  if (!parsed.success) return { kind: "failed", message: "Refresh failed" }
  if (parsed.data.material) return { kind: "material", refresh: parsed.data }
  return { kind: "ready", proposal: parsed.data.proposal, refresh: parsed.data }
}

/** Hands the proposal to the host's signer and normalises what comes back. */
export async function signWith(
  signer: StuartSigner,
  proposal: Proposal,
  onStatus: (status: CallStatus) => void,
  signal: AbortSignal,
): Promise<StuartSignResult> {
  try {
    return await signer({ proposal, onStatus, signal })
  } catch {
    return { outcome: signal.aborted ? "rejected" : "failed", hashes: [] }
  }
}

/** The first CallStatus, before the wallet says anything. */
export function initialCallStatus(proposal: Proposal): CallStatus {
  return {
    type: "call_status",
    version: 1,
    proposalId: proposal.proposalId,
    outcome: "in_progress",
    calls: proposal.calls.map((call) => ({
      index: call.index,
      label: call.label,
      status: "not_sent",
      hash: null,
      error: null,
      doNotRepeat: false,
      retryable: true,
    })),
    remaining: null,
  }
}
