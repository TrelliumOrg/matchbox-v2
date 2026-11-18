import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type {
  Proposal,
  ProposalRefreshResponse,
  StuartRequest,
} from "./contract"
import { fixtureTurn } from "./fixtures"
import { ProposalCard } from "./proposal-card"
import { refreshProposal } from "./signing"
import type { StuartSigner } from "./store"
import { withHost } from "./test-host"

const wallet = {
  address: "0x7c21095156ab25e989c3c084bcb06037c6539e0b",
  mode: "connected" as const,
}

const request: StuartRequest = {
  version: 1,
  query: "Move the Kiln Labs 70% to Sats Collective",
  sessionId: "6f1c1b8e-3c55-4a3f-9b8a-1d2e3f4a5b6c",
  turn: 0,
  surface: "composer",
  chainId: 31_612,
  wallet,
}

function prepared(): Proposal {
  const proposal = fixtureTurn(request).response.proposedActions[0]
  if (proposal === undefined) throw new Error("fixture has a proposal")
  return proposal
}

function refreshed(
  proposal: Proposal,
  material: boolean,
): ProposalRefreshResponse {
  return {
    version: 1,
    proposal: {
      ...proposal,
      proposalId: "vote_6b2d1f58",
      snapshotBlock: "13078812",
    },
    recommended: null,
    preservedManualEdits: false,
    material,
    reasons: material ? ["projected_pct"] : [],
    diff: null,
    changes: material
      ? [
          {
            key: "projected",
            label: "Projected",
            before: "$11.58",
            after: "$10.90",
            material: true,
          },
        ]
      : [],
    evidence: [],
    activityTrace: [],
  }
}

function stubRefresh(body: ProposalRefreshResponse): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      }),
  )
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("refreshProposal", () => {
  it("returns the proposal as is in fixture mode", async () => {
    const proposal = prepared()
    const result = await refreshProposal({
      endpoint: null,
      proposal,
      wallet,
      signal: new AbortController().signal,
    })
    expect(result).toEqual({ kind: "ready", proposal, refresh: null })
  })

  it("posts to /proposal/refresh and flags material changes", async () => {
    const proposal = prepared()
    const calls: string[] = []
    const result = await refreshProposal({
      endpoint: "https://stuart.example",
      proposal,
      wallet,
      signal: new AbortController().signal,
      fetchImpl: async (url) => {
        calls.push(url)
        return new Response(JSON.stringify(refreshed(proposal, true)))
      },
    })
    expect(calls).toEqual(["https://stuart.example/proposal/refresh"])
    expect(result.kind).toBe("material")
  })

  it("reports an expired proposal", async () => {
    const result = await refreshProposal({
      endpoint: "https://stuart.example",
      proposal: prepared(),
      wallet,
      signal: new AbortController().signal,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "proposal_expired",
              message: "expired",
              retryAfterSeconds: null,
            },
          }),
          { status: 410 },
        ),
    })
    expect(result).toEqual({ kind: "failed", message: "Request expired" })
  })
})

describe("ProposalCard", () => {
  it("matches the prepared vote frame", () => {
    const turn = fixtureTurn(request).response
    const diff = turn.uiBlocks[0]
    render(
      withHost(
        <ProposalCard
          proposal={prepared()}
          diff={diff?.type === "allocation_diff" ? diff : null}
        />,
        { signer: vi.fn() },
      ),
    )
    expect(screen.getByRole("region", { name: "Vote, #2207" })).toBeTruthy()
    expect(screen.getByText("$11.58")).toBeTruthy()
    expect(screen.getByText("was $8.75")).toBeTruthy()
    expect(screen.getByText("+$2.83")).toBeTruthy()
    expect(screen.getByText("Simulation passed")).toBeTruthy()
    expect(screen.getByText("Block 13,078,801")).toBeTruthy()
    expect(screen.getByText("Network fee, 1 signature")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Review and sign" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Edit in Vote" })).toBeTruthy()
  })

  it("refreshes, then hands the fresh proposal to the signer and shows wallet status", async () => {
    const proposal = prepared()
    const fresh = refreshed(proposal, false)
    const fetchMock = stubRefresh(fresh)
    let finish: (value: { outcome: "success"; hashes: string[] }) => void =
      () => {}
    const signer = vi.fn<StuartSigner>(
      ({ proposal: signed, onStatus }) =>
        new Promise((resolve) => {
          onStatus({
            type: "call_status",
            version: 1,
            proposalId: signed.proposalId,
            outcome: "in_progress",
            calls: [
              {
                index: 0,
                label: "Vote with #2207",
                status: "awaiting_wallet",
                hash: null,
                error: null,
                doNotRepeat: false,
                retryable: true,
              },
            ],
            remaining: null,
          })
          finish = resolve
        }),
    )
    render(
      withHost(<ProposalCard proposal={proposal} diff={null} />, {
        signer,
        endpoint: "https://stuart.example",
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Review and sign" }))
    await waitFor(() => expect(signer).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(signer.mock.calls[0]?.[0].proposal.proposalId).toBe("vote_6b2d1f58")
    await screen.findByText("Confirm in your wallet")
    expect(
      screen.getByRole("button", { name: "Waiting for wallet" }),
    ).toBeTruthy()
    await act(async () => finish({ outcome: "success", hashes: [] }))
    expect(screen.getByText("Confirmed")).toBeTruthy()
    expect(document.body.textContent ?? "").not.toMatch(
      /submitted|sent by Stuart/i,
    )
  })

  it("blocks on a material change until it is acknowledged", async () => {
    const proposal = prepared()
    const fresh = refreshed(proposal, true)
    stubRefresh(fresh)
    const signer = vi.fn<StuartSigner>(async () => ({
      outcome: "rejected",
      hashes: [],
    }))
    render(
      withHost(<ProposalCard proposal={proposal} diff={null} />, {
        signer,
        endpoint: "https://stuart.example",
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Review and sign" }))
    await screen.findByText("Changed at block 13,078,812")
    expect(screen.getByText("$10.90")).toBeTruthy()
    expect(signer).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole("button", { name: "Acknowledge new optimum" }),
    )
    await waitFor(() => expect(signer).toHaveBeenCalledTimes(1))
    expect(signer.mock.calls[0]?.[0].proposal.proposalId).toBe("vote_6b2d1f58")
    await screen.findByText("Signature rejected")
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
  })

  it("links to Vote instead of signing when no signer is registered", () => {
    render(withHost(<ProposalCard proposal={prepared()} diff={null} />))
    expect(screen.queryByRole("button", { name: "Review and sign" })).toBeNull()
    expect(
      screen.getByRole("link", { name: "Edit in Vote" }).getAttribute("href"),
    ).toBe("/vote")
  })

  it("explains why a read-only proposal cannot be signed", () => {
    const proposal = fixtureTurn({ ...request, wallet: undefined }).response
      .proposedActions[0]
    if (proposal === undefined) throw new Error("proposal")
    render(
      withHost(<ProposalCard proposal={proposal} diff={null} />, {
        signer: vi.fn(),
      }),
    )
    expect(screen.getByText("Connect this wallet to sign")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Review and sign" })).toBeNull()
  })
})
