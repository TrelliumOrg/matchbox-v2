import type { CallStatus, Proposal } from "@matchbox/stuart-ui/contract"
import { describe, expect, it, vi } from "vitest"
import {
  policyBlock,
  type SignerCall,
  type SignerDeps,
  type SignerReceipt,
  signerCopy,
  signProposal,
} from "./sign-proposal"

const wallet = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"
const boostVoter = "0x2Ba614a598Cffa5a19d683cDCA97bac3a49313d1"
const mezo = "0x7B7c000000000000000000000000000000000001"
const veMezo = "0xb90fdAd3DFD180458D62Cc6acedc983D78E20122"
const spender = "000000000000000000000000".concat(boostVoter.slice(2))

function approveData(amount: bigint): `0x${string}` {
  return `0x095ea7b3${spender.toLowerCase()}${amount.toString(16).padStart(64, "0")}`
}

function call(index: number, patch: Partial<SignerCall> = {}): SignerCall {
  return {
    index,
    chainId: 31_612,
    from: wallet,
    to: boostVoter,
    data: "0x7ac09bf7",
    value: "0x0",
    kind: "vote",
    label: `Call ${index + 1}`,
    dependsOn: index === 0 ? null : index - 1,
    refreshAfterDependency: false,
    ...patch,
  }
}

function proposal(calls: SignerCall[], patch: Partial<Proposal> = {}) {
  return {
    proposalId: "vote_5a1c0e47",
    proposalHash: `0x${"ab".repeat(32)}`,
    refreshToken: "cd".repeat(32),
    kind: "vote",
    chainId: 31_612,
    from: wallet,
    origin: "user_request",
    status: "unsigned",
    canSign: true,
    blockedReason: null,
    createdAt: "2026-11-08T12:00:00.000Z",
    expiresAt: "2026-11-08T12:08:00.000Z",
    snapshotBlock: "13078795",
    calculationVersion: "vote.v1",
    atomicity: "sequential_non_atomic",
    approvals: [],
    calls,
    simulation: { status: "passed", method: "eth_call", calls: [] },
    quote: null,
    content: {
      kind: "claim_surplus",
      amount: { token: mezo, raw: "1", decimals: 18, symbol: "MEZO" },
    },
    ...patch,
  } as Proposal
}

function receipt(
  hash: `0x${string}`,
  status: SignerReceipt["status"] = "success",
): SignerReceipt {
  return { hash, status, blockNumber: 13_078_800n }
}

const rejection = Object.assign(new Error("User rejected the request."), {
  name: "UserRejectedRequestError",
})

function deps(patch: Partial<SignerDeps> = {}): SignerDeps & {
  order: string[]
} {
  const order: string[] = []
  let sent = 0
  return {
    order,
    account: () => wallet,
    chainId: 31_612,
    ensureChain: async () => {
      order.push("chain")
    },
    simulate: async (target) => {
      order.push(`simulate ${target.index}`)
    },
    send: async (target) => {
      order.push(`send ${target.index}`)
      sent += 1
      return `0x${String(sent).padStart(64, "0")}`
    },
    wait: async (hash) => {
      order.push("wait")
      return receipt(hash)
    },
    failure: () => "Voting opens at 01:00 UTC",
    isRejection: (error) => error === rejection,
    done: vi.fn(),
    ...patch,
  }
}

async function run(
  target: Proposal,
  signer: SignerDeps,
  signal: AbortSignal = new AbortController().signal,
) {
  const statuses: CallStatus[] = []
  const result = await signProposal(
    { proposal: target, onStatus: (status) => statuses.push(status), signal },
    signer,
  )
  return { result, statuses, last: statuses.at(-1) }
}

describe("signProposal", () => {
  it("simulates each call right before its prompt, in index order", async () => {
    const signer = deps()
    const { result, last } = await run(
      proposal([call(1), call(0, { kind: "approve" })]),
      signer,
    )
    expect(signer.order).toEqual([
      "chain",
      "simulate 0",
      "send 0",
      "wait",
      "chain",
      "simulate 1",
      "send 1",
      "wait",
    ])
    expect(result.outcome).toBe("success")
    expect(result.hashes).toHaveLength(2)
    expect(last?.outcome).toBe("success")
    expect(last?.calls.map((state) => state.status)).toEqual(["mined", "mined"])
    expect(signer.done).toHaveBeenCalledOnce()
  })

  it("reports each step to Stuart as the wallet moves", async () => {
    const { statuses } = await run(proposal([call(0)]), deps())
    expect(statuses.map((status) => status.calls[0]?.status)).toEqual([
      "awaiting_wallet",
      "submitted",
      "mined",
      "mined",
    ])
    expect(statuses.at(-2)?.outcome).toBe("in_progress")
  })

  it("refuses a proposal for another wallet before anything is sent", async () => {
    const signer = deps({ account: () => boostVoter })
    const { result, last } = await run(proposal([call(0)]), signer)
    expect(result).toEqual({ outcome: "failed", hashes: [] })
    expect(last?.calls[0]?.error).toBe(signerCopy.wrongWallet)
    expect(signer.order).toEqual([])
  })

  it("refuses without a connected wallet, on another chain or when Stuart says it cannot sign", async () => {
    for (const [signer, target, copy] of [
      [deps({ account: () => null }), proposal([call(0)]), "wrongWallet"],
      [deps({ chainId: 31_611 }), proposal([call(0)]), "wrongChain"],
      [deps(), proposal([call(0)], { canSign: false }), "cannotSign"],
      [deps(), proposal([call(0, { from: boostVoter })]), "wrongWallet"],
    ] as const) {
      const { result, last } = await run(target, signer)
      expect(result.outcome).toBe("failed")
      expect(last?.calls[0]?.error).toBe(signerCopy[copy])
      expect(signer.order).toEqual([])
    }
  })

  it("stops at a simulated revert with the contract's reason", async () => {
    const signer = deps({
      simulate: async () => {
        throw new Error("DistributeWindow")
      },
    })
    const { result, last } = await run(proposal([call(0)]), signer)
    expect(result.outcome).toBe("failed")
    expect(last?.calls[0]).toMatchObject({
      status: "reverted",
      error: "Voting opens at 01:00 UTC",
      retryable: true,
    })
    expect(signer.done).not.toHaveBeenCalled()
  })

  it("reports a declined wallet prompt as rejected", async () => {
    const signer = deps({
      send: async () => {
        throw rejection
      },
    })
    const { result, last } = await run(proposal([call(0)]), signer)
    expect(result).toEqual({ outcome: "rejected", hashes: [] })
    expect(last?.calls[0]).toMatchObject({
      status: "rejected",
      error: signerCopy.rejected,
    })
  })

  it("is partial when a later call fails after one is mined", async () => {
    let calls = 0
    const signer = deps({
      send: async () => {
        calls += 1
        if (calls === 2) throw rejection
        return `0x${"1".padStart(64, "0")}`
      },
    })
    const { result, last } = await run(proposal([call(0), call(1)]), signer)
    expect(result.outcome).toBe("partial")
    expect(result.hashes).toHaveLength(1)
    expect(last?.outcome).toBe("partial")
    expect(last?.calls.map((state) => state.status)).toEqual([
      "mined",
      "rejected",
    ])
    expect(signer.done).not.toHaveBeenCalled()
  })

  it("marks a reverted receipt and never a success", async () => {
    const signer = deps({ wait: async (hash) => receipt(hash, "reverted") })
    const { result, last } = await run(proposal([call(0)]), signer)
    expect(result.outcome).toBe("failed")
    expect(last?.calls[0]).toMatchObject({
      status: "reverted",
      error: signerCopy.reverted,
    })
  })

  it("never offers to resend a call whose receipt did not come back", async () => {
    const signer = deps({
      wait: async () => {
        throw new Error("timeout")
      },
    })
    const { result, last } = await run(proposal([call(0)]), signer)
    expect(result.outcome).toBe("failed")
    expect(result.hashes).toHaveLength(1)
    expect(last?.calls[0]).toMatchObject({
      status: "submitted",
      error: signerCopy.unconfirmed,
      doNotRepeat: true,
      retryable: false,
    })
  })

  it("stops before the next prompt once the card is closed", async () => {
    const controller = new AbortController()
    const signer = deps({
      wait: async (hash) => {
        controller.abort()
        return receipt(hash)
      },
    })
    const { result } = await run(
      proposal([call(0), call(1)]),
      signer,
      controller.signal,
    )
    expect(result.outcome).toBe("partial")
    expect(signer.order).not.toContain("send 1")
  })

  it("is rejected when closed before anything was sent", async () => {
    const controller = new AbortController()
    controller.abort()
    const signer = deps()
    const { result } = await run(proposal([call(0)]), signer, controller.signal)
    expect(result).toEqual({ outcome: "rejected", hashes: [] })
    expect(signer.order).toEqual([])
  })

  it("blocks unlimited and lock approvals before the first prompt", async () => {
    const signer = deps()
    const { result, last } = await run(
      proposal([
        call(0, {
          kind: "approve",
          to: mezo,
          data: approveData((1n << 256n) - 1n),
        }),
        call(1),
      ]),
      signer,
    )
    expect(result.outcome).toBe("failed")
    expect(
      last?.calls.every(
        (state) => state.error === signerCopy.unlimitedApproval,
      ),
    ).toBe(true)
    expect(signer.order).toEqual([])
  })
})

describe("policyBlock", () => {
  it("allows exact ERC-20 approvals and ordinary calls", () => {
    expect(
      policyBlock(
        call(0, { to: mezo, data: approveData(6_000n * 10n ** 18n) }),
      ),
    ).toBeNull()
    expect(policyBlock(call(0))).toBeNull()
  })

  it("blocks approvals on the lock escrows and operator approvals", () => {
    expect(policyBlock(call(0, { to: veMezo, data: approveData(2207n) }))).toBe(
      signerCopy.lockApproval,
    )
    expect(
      policyBlock(
        call(0, {
          to: veMezo,
          data: `0xa22cb465${spender}${"1".padStart(64, "0")}`,
        }),
      ),
    ).toBe(signerCopy.lockApproval)
  })

  it("blocks unlimited approvals", () => {
    expect(
      policyBlock(call(0, { to: mezo, data: approveData((1n << 256n) - 1n) })),
    ).toBe(signerCopy.unlimitedApproval)
  })
})
