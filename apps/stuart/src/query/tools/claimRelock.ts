import { ERC20_ABI, VOTING_ESCROW_WRITE_ABI } from "@matchbox/chain"
import type { Proposal, TransactionRequest } from "@matchbox/stuart-ui/contract"
import { encodeFunctionData } from "viem"
import { z } from "zod"
import { displayToken, shortAddress, tokenAmount, usd6 } from "../format"
import { BLOCKED_TEXT, lockVerdict } from "../lockRules"
import { makeFact, type ToolOutcome, traceItem } from "../outcome"
import {
  callTarget,
  expiresAt,
  type ProposalDraft,
  sealProposal,
  signability,
  simulationOf,
} from "../proposals"
import { MAINNET } from "../providers/abis"
import { CLAIM_CALC_VERSION } from "../versions"
import { errorOutcome, plainOutcome, ZERO_WALLET } from "./common"
import {
  ALL_SOURCES,
  type ClaimScan,
  claimCall,
  claimsOutcome,
  lastEpochField,
  scanClaims,
} from "./rewards"
import { defineTool, type ToolContext } from "./tool"

// Claim and relock: claim every reward, then add the claimed MEZO to a
// veMEZO lock, with an exact ERC-20 approval of MEZO to veMEZO when the
// allowance is short. The amounts are the chain's earned() at one block.

const TOOL = "prepare_claim_relock"

const relockInput = z.object({
  lockId: z
    .string()
    .regex(/^\d{1,12}$/)
    .nullable()
    .describe(
      "The veMEZO lock that receives the MEZO, null picks the largest that can take more.",
    ),
})

type Built =
  | {
      kind: "ok"
      proposal: Proposal
      scan: ClaimScan
      mezo: bigint
      tokenId: bigint
    }
  | { kind: "stop"; text: string; templateId: string }

export async function buildClaimRelock(
  context: ToolContext,
  lockId: string | null,
): Promise<Built> {
  const scan = await scanClaims(context, ALL_SOURCES, null)
  if (scan.raw.length === 0) {
    return {
      kind: "stop",
      text: "Nothing to claim for this wallet right now.",
      templateId: `${TOOL}.empty.v1`,
    }
  }
  const mezoToken = MAINNET.mezo.toLowerCase()
  const mezo = scan.raw
    .flatMap((lock) => lock.entries)
    .filter((entry) => entry.token.toLowerCase() === mezoToken)
    .reduce((sum, entry) => sum + entry.earned, 0n)
  if (mezo === 0n) {
    return {
      kind: "stop",
      text: "No MEZO to relock in these rewards.",
      templateId: `${TOOL}.no_mezo.v1`,
    }
  }
  const owner = context.wallet.address
  const locks = await context.providers.walletLocks(owner, "veMEZO")
  const candidates =
    lockId === null
      ? [...locks].sort((a, b) =>
          b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0,
        )
      : locks.filter((lock) => lock.tokenId.toString() === lockId)
  if (candidates.length === 0) {
    return {
      kind: "stop",
      text: "No veMEZO lock in this wallet to relock into.",
      templateId: `${TOOL}.no_lock.v1`,
    }
  }
  const states = await context.providers.lockStates(
    "veMEZO",
    candidates.slice(0, 8).map((lock) => lock.tokenId),
  )
  const target = states.locks.find(
    (lock) => lockVerdict(lock, "add", states.now, owner).ok,
  )
  if (target === undefined) {
    const first = states.locks[0]
    const verdict = first ? lockVerdict(first, "add", states.now, owner) : null
    return {
      kind: "stop",
      text:
        verdict !== null && !verdict.ok
          ? BLOCKED_TEXT[verdict.reason]
          : "No veMEZO lock can take more MEZO.",
      templateId: `${TOOL}.blocked.v1`,
    }
  }
  const funding = await context.providers.escrowFunding("veMEZO", owner)
  const claims = scan.raw.map((lock, index) => claimCall(context, lock, index))
  const shown = displayToken(tokenAmount(mezo, 18, "MEZO"))
  const needsApproval = funding.allowance < mezo
  const tail: TransactionRequest[] = []
  if (needsApproval) {
    tail.push({
      index: claims.length,
      chainId: 31_612,
      from: owner,
      to: funding.token,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [MAINNET.veMEZO, mezo],
      }),
      value: "0x0",
      kind: "approve",
      label: `Approve ${shown}`,
      detail: "Exactly this amount, nothing more",
      dependsOn: null,
      refreshAfterDependency: false,
    })
  }
  tail.push({
    index: claims.length + tail.length,
    chainId: 31_612,
    from: owner,
    to: MAINNET.veMEZO,
    data: encodeFunctionData({
      abi: VOTING_ESCROW_WRITE_ABI,
      functionName: "increaseAmount",
      args: [target.tokenId, mezo],
    }),
    value: "0x0",
    kind: "lock",
    label: `Add to #${target.tokenId}`,
    detail: `${shown} claimed above`,
    dependsOn: claims.length - 1,
    refreshAfterDependency: false,
  })
  const calls = [...claims, ...tail]
  const simulation = simulationOf(
    await context.providers.simulateSequence(owner, calls.map(callTarget)),
    "eth_simulateV1",
  )
  const draft: ProposalDraft = {
    kind: "claim_relock",
    chainId: 31_612,
    from: owner,
    origin: "user_request",
    ...signability({
      walletMode: context.wallet.mode,
      simulation,
      blockedReason: null,
      needsApproval,
    }),
    createdAt: context.now().toISOString(),
    expiresAt: expiresAt("claim_relock", context.now()),
    snapshotBlock: scan.blockNumber.toString(),
    calculationVersion: CLAIM_CALC_VERSION,
    atomicity: "sequential_non_atomic",
    approvals: needsApproval
      ? [
          {
            token: funding.token,
            spender: MAINNET.veMEZO,
            amount: tokenAmount(mezo, 18, "MEZO"),
            mode: "exact",
          },
        ]
      : [],
    calls,
    simulation,
    quote: null,
    content: {
      kind: "claim_relock",
      rows: scan.rows,
      totalUsd: scan.totalMicro === null ? null : usd6(scan.totalMicro),
      unpricedCount: scan.unpricedCount,
      relockTokenId: target.tokenId.toString(),
      relockAmount: tokenAmount(mezo, 18, "MEZO"),
      ...lastEpochField(context),
    },
  }
  return {
    kind: "ok",
    proposal: await sealProposal(draft, context.secret),
    scan,
    mezo,
    tokenId: target.tokenId,
  }
}

export const prepareClaimRelockTool = defineTool({
  name: TOOL,
  family: "rewards",
  description:
    "Claim every claimable reward, then add the claimed MEZO to a veMEZO lock (the named one, else the largest that can take more). Unsigned, one signature per step.",
  input: relockInput,
  async run(context, input): Promise<ToolOutcome> {
    if (context.wallet.address === ZERO_WALLET) {
      return plainOutcome({
        scope: context.scope,
        tool: TOOL,
        intent: "claim_rewards",
        status: "empty",
        title: "Claim and relock",
        templateId: `${TOOL}.no_wallet.v1`,
        text: "Connect or watch a wallet to claim and relock.",
        kind: "empty",
        traceLabel: "No wallet selected",
      })
    }
    try {
      const built = await buildClaimRelock(context, input.lockId)
      if (built.kind === "stop") {
        return plainOutcome({
          scope: context.scope,
          tool: TOOL,
          intent: "claim_rewards",
          status: "empty",
          title: "Claim and relock",
          templateId: built.templateId,
          text: built.text,
          kind: "empty",
          traceLabel: "Read claimable rewards",
        })
      }
      const base = claimsOutcome(context, built.scan, null, TOOL)
      const { scope } = context
      const refs = base.evidence.slice(0, 1).map((item) => item.id)
      const relockText = `then ${displayToken(tokenAmount(built.mezo, 18, "MEZO"))} added to veMEZO #${built.tokenId}`
      const relockFact = makeFact({
        scope,
        key: "relock",
        label: "Relock",
        value: { kind: "text", text: relockText.slice(0, 80) },
        display: relockText.slice(0, 60),
        status: "live",
        evidenceRefs: refs,
      })
      const countFact = makeFact({
        scope,
        key: "signatures",
        label: "Signatures",
        value: { kind: "count", count: built.proposal.calls.length },
        display: String(built.proposal.calls.length),
        status: "live",
        evidenceRefs: refs,
      })
      const totalFact = base.facts.find((fact) => fact.id === scope.id("total"))
      const facts = [...base.facts, relockFact, countFact]
      const simulated = built.proposal.simulation.status === "passed"
      return {
        ...base,
        title: "Claim and relock",
        answer: {
          kind: "result",
          templateId: `${TOOL}.lead.v1`,
          text: `${totalFact?.display ?? "Rewards"} to claim, ${relockFact.display}. ${countFact.display} signatures.`,
          factRefs: facts.map((fact) => fact.id),
        },
        facts,
        blocks: [],
        proposals: [built.proposal],
        trace: [
          ...base.trace,
          traceItem({
            scope,
            key: "relock",
            label: `Checked veMEZO #${built.tokenId}`,
            detail: "Not vesting, not managed, not expired",
            tool: TOOL,
          }),
          traceItem({
            scope,
            key: "simulate",
            label: "Simulated the claim and relock",
            detail: `From ${shortAddress(context.wallet.address)}, ${simulated ? "passed" : "reverted"}`,
            tool: TOOL,
            status: simulated ? "ok" : "error",
          }),
        ],
        surface: "canvas",
      }
    } catch {
      return errorOutcome({
        scope: context.scope,
        tool: TOOL,
        intent: "claim_rewards",
        title: "Claim and relock",
      })
    }
  },
})
