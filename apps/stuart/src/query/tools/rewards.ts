import { BOOST_VOTER_ABI } from "@matchbox/chain"
import type {
  ClaimRow,
  ClaimSourceKind,
  Evidence,
  Fact,
  Proposal,
  TransactionRequest,
  UiBlock,
} from "@matchbox/stuart-ui/contract"
import { encodeFunctionData } from "viem"
import { z } from "zod"
import {
  displayBlock,
  displayUsd,
  listWithAnd,
  microFromUsd6,
  shortAddress,
  tokenAmount,
  usd6,
} from "../format"
import { makeFact, type ToolOutcome, traceItem } from "../outcome"
import {
  callTarget,
  expiresAt,
  type ProposalDraft,
  sealProposal,
  signability,
  simulationOf,
} from "../proposals"
import { POOLS_VOTER_CLAIM_ABI } from "../providers/abis"
import { type ClaimableLock, claimArguments } from "../providers/claims"
import {
  type PriceSnapshot,
  priceSourceLabel,
  tokenMicroUsd,
} from "../providers/prices"
import { CLAIM_CALC_VERSION, epochNumberFor } from "../versions"
import {
  calcEvidence,
  chainEvidence,
  errorOutcome,
  navigateFollowup,
  plainOutcome,
  priceEvidence,
  queryFollowup,
  sourceCluster,
  ZERO_WALLET,
} from "./common"
import { defineTool, type ToolContext } from "./tool"

type VoterSource = Exclude<ClaimSourceKind, "collateral_surplus">

const sourceSchema = z.enum([
  "boost_bribes",
  "mezo_bribes",
  "pool_fees_bribes",
  "validator_bribes",
])

/** Where a claim's rewards come from, in plain words (step subtitles). */
export const SOURCE_LABEL: Record<ClaimSourceKind, string> = {
  boost_bribes: "Boost rewards",
  mezo_bribes: "Cross-chain rewards",
  pool_fees_bribes: "Pool fees and incentives",
  validator_bribes: "Validator rewards",
  collateral_surplus: "BTC collateral surplus",
}

function assetOf(source: ClaimSourceKind): "veMEZO" | "veBTC" {
  return source === "boost_bribes" || source === "mezo_bribes"
    ? "veMEZO"
    : "veBTC"
}

export type ClaimScan = {
  rows: ClaimRow[]
  raw: ClaimableLock[]
  prices: PriceSnapshot
  blockNumber: bigint
  fetchedAt: string
  totalMicro: bigint | null
  unpricedCount: number
}

export async function scanClaims(
  context: ToolContext,
  sources: readonly VoterSource[],
  lockIds: readonly string[] | null,
): Promise<ClaimScan> {
  const [prices, chain] = await Promise.all([
    context.providers.prices(),
    context.providers.claims(
      context.wallet.address,
      lockIds === null ? null : new Set(lockIds),
    ),
  ])
  const wanted = new Set<ClaimSourceKind>(sources)
  // Exact earned() amounts at one block; the read models only said where to
  // look.
  const raw = chain.locks.filter((lock) => wanted.has(lock.source))
  const blockNumber = chain.blockNumber
  let total: bigint | null = null
  let unpricedCount = 0
  const rows: ClaimRow[] = raw.map((lock) => {
    let rowUsd: bigint | null = null
    let rowUnpriced = 0
    const rewards = lock.entries.map((entry) => {
      const usd = tokenMicroUsd({
        amount: entry.earned,
        decimals: entry.decimals,
        token: entry.token,
        prices,
      })
      if (usd === null) rowUnpriced += 1
      else rowUsd = (rowUsd ?? 0n) + usd
      return {
        token: entry.token,
        amount: tokenAmount(entry.earned, entry.decimals, entry.symbol),
        usd: usd === null ? null : usd6(usd),
      }
    })
    if (rowUsd !== null) total = (total ?? 0n) + rowUsd
    unpricedCount += rowUnpriced
    return {
      rowKey: `${lock.source}:${lock.tokenId}`,
      source: lock.source,
      contract: lock.voter,
      tokenId: lock.tokenId.toString(),
      rewards,
      usd: rowUsd === null ? null : usd6(rowUsd),
      unpricedCount: rowUnpriced,
    }
  })
  return {
    rows,
    raw,
    prices,
    blockNumber,
    fetchedAt: new Date().toISOString(),
    totalMicro: total,
    unpricedCount,
  }
}

/** `{ epoch }`: the last completed epoch, the one claims run through. */
export function lastEpochField(context: Pick<ToolContext, "now">): {
  epoch?: number
} {
  const current = epochNumberFor(
    BigInt(Math.floor(context.now().getTime() / 1000)),
  )
  return current === null || current < 1 ? {} : { epoch: current - 1 }
}

export function claimCall(
  context: ToolContext,
  lock: ClaimableLock,
  index: number,
): TransactionRequest {
  const { contracts, tokens } = claimArguments(lock.entries)
  const data =
    lock.source === "pool_fees_bribes"
      ? encodeFunctionData({
          abi: POOLS_VOTER_CLAIM_ABI,
          functionName: "claimFeesAndBribes",
          args: [contracts, tokens, lock.tokenId],
        })
      : encodeFunctionData({
          // Same selector on every voter.
          abi: BOOST_VOTER_ABI,
          functionName: "claimBribes",
          args: [contracts, tokens, lock.tokenId],
        })
  const lastEpoch = epochNumberFor(
    BigInt(Math.floor(context.now().getTime() / 1000)),
  )
  return {
    index,
    chainId: 31_612,
    from: context.wallet.address,
    to: lock.voter,
    data,
    value: "0x0",
    kind: "claim",
    label: `Claim ${assetOf(lock.source)} #${lock.tokenId}`,
    detail:
      lastEpoch === null
        ? SOURCE_LABEL[lock.source]
        : `${SOURCE_LABEL[lock.source]} through Epoch ${lastEpoch - 1}`,
    dependsOn: null,
    refreshAfterDependency: false,
  }
}

export async function buildClaimProposal(
  context: ToolContext,
  scan: ClaimScan,
): Promise<Proposal | null> {
  if (scan.raw.length === 0) return null
  const calls = scan.raw.map((lock, index) => claimCall(context, lock, index))
  const simulated = await Promise.all(
    calls.map((call) =>
      context.providers.simulateSingle(
        context.wallet.address,
        callTarget(call),
      ),
    ),
  )
  const simulation = simulationOf(simulated, "eth_call")
  const draft: ProposalDraft = {
    kind: "claim",
    chainId: 31_612,
    from: context.wallet.address,
    origin: "user_request",
    ...signability({
      walletMode: context.wallet.mode,
      simulation,
      blockedReason: null,
      needsApproval: false,
    }),
    createdAt: context.now().toISOString(),
    expiresAt: expiresAt("claim", context.now()),
    snapshotBlock: scan.blockNumber.toString(),
    calculationVersion: CLAIM_CALC_VERSION,
    atomicity: calls.length > 1 ? "batchable" : "single",
    approvals: [],
    calls,
    simulation,
    quote: null,
    content: {
      kind: "claim",
      rows: scan.rows,
      totalUsd: scan.totalMicro === null ? null : usd6(scan.totalMicro),
      unpricedCount: scan.unpricedCount,
      ...lastEpochField(context),
    },
  }
  return sealProposal(draft, context.secret)
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

/** "veMEZO #2689 and #82, veBTC #6033": the locks a claim covers. */
export function lockListText(scan: Pick<ClaimScan, "raw">): string {
  const byAsset = new Map<string, string[]>()
  for (const lock of scan.raw) {
    const asset = assetOf(lock.source)
    const ids = byAsset.get(asset) ?? []
    const id = `#${lock.tokenId}`
    if (!ids.includes(id)) ids.push(id)
    byAsset.set(asset, ids)
  }
  return [...byAsset.entries()]
    .map(([asset, ids]) => `${asset} ${listWithAnd(ids)}`)
    .join(", ")
    .slice(0, 60)
}

function claimTrace(
  context: ToolContext,
  scan: ClaimScan,
  proposal: Proposal | null,
  tool: string,
) {
  const { scope } = context
  const symbols = [
    ...new Set(scan.raw.flatMap((lock) => lock.entries.map((e) => e.symbol))),
  ]
  const items = [
    traceItem({
      scope,
      key: "scan",
      label: "Read claimable rewards",
      detail: `${lockListText(scan)}, ${listWithAnd([
        ...new Set(
          scan.raw.map((lock) => SOURCE_LABEL[lock.source].toLowerCase()),
        ),
      ])}`,
      tool,
    }),
    traceItem({
      scope,
      key: "prices",
      label: `Priced ${listWithAnd(symbols.slice(0, 3)) || "rewards"}`,
      detail: priceSourceLabel(scan.prices.mezo),
      tool,
    }),
  ]
  if (proposal) {
    items.push(
      traceItem({
        scope,
        key: "simulate",
        label:
          proposal.calls.length === 1
            ? "Simulated the claim"
            : "Simulated the claims",
        detail: `From ${shortAddress(context.wallet.address)}, ${
          proposal.simulation.status === "passed" ? "passed" : "reverted"
        }`,
        tool,
        status: proposal.simulation.status === "passed" ? "ok" : "error",
      }),
    )
  }
  return items
}

export function claimsOutcome(
  context: ToolContext,
  scan: ClaimScan,
  proposal: Proposal | null,
  tool: string,
): ToolOutcome {
  const { scope } = context
  const evidence: Evidence[] = [
    chainEvidence({
      scope,
      key: "earned",
      label: "Claimable",
      source: "Reward contracts earned(token, tokenId)",
      blockNumber: scan.blockNumber,
      fetchedAt: scan.fetchedAt,
    }),
    priceEvidence(scope, scan.prices, "both"),
    calcEvidence(
      scope,
      CLAIM_CALC_VERSION,
      "Priced claimable rewards",
      scan.fetchedAt,
    ),
  ]
  const refs = evidence.map((item) => item.id)
  const facts: Fact[] = [
    makeFact({
      scope,
      key: "total",
      label: "Claimable (priced)",
      value:
        scan.totalMicro === null
          ? { kind: "text", text: "Unpriced" }
          : { kind: "usd", usd: usd6(scan.totalMicro) },
      display: displayUsd(scan.totalMicro),
      status: scan.totalMicro === null ? "unpriced" : "live",
      evidenceRefs: refs,
    }),
    makeFact({
      scope,
      key: "claims",
      label: "Claims",
      value: { kind: "count", count: scan.rows.length },
      display: `${scan.rows.length}`,
      status: "live",
      evidenceRefs: [refs[0] ?? ""],
    }),
  ]
  if (scan.unpricedCount > 0) {
    facts.push(
      makeFact({
        scope,
        key: "unpriced",
        label: "Unpriced rewards",
        value: { kind: "count", count: scan.unpricedCount },
        display: `${scan.unpricedCount}`,
        status: "unpriced",
        evidenceRefs: [refs[1] ?? ""],
      }),
    )
  }
  const lockText = lockListText(scan)
  const locksFact = makeFact({
    scope,
    key: "locks",
    label: "Locks",
    value: { kind: "text", text: lockText.slice(0, 80) },
    display: lockText,
    status: "live",
    evidenceRefs: [refs[0] ?? ""],
  })
  facts.push(locksFact)
  const [totalFact, countFact] = facts
  const unpricedFact = facts.find((fact) => fact.id === scope.id("unpriced"))
  const signatures = proposal?.calls.length ?? 0
  // With nothing priced there is no dollar figure to lead with: say how many
  // unpriced rewards there are instead of "Unpriced claimable".
  const allUnpriced = scan.totalMicro === null && unpricedFact !== undefined
  const what = allUnpriced
    ? `${unpricedFact.display} unpriced ${scan.unpricedCount === 1 ? "reward" : "rewards"}`
    : `${totalFact?.display}`
  const lead = proposal
    ? `${what} to claim from ${locksFact.display}. ${
        signatures === 1 ? "One signature" : `${countFact?.display} signatures`
      }.`
    : `${what} claimable from ${locksFact.display}.`
  const text = `${lead}${
    unpricedFact && !allUnpriced
      ? ` ${unpricedFact.display} ${scan.unpricedCount === 1 ? "reward is" : "rewards are"} unpriced.`
      : ""
  }`
  const blocks: UiBlock[] = [
    {
      type: "claim_review",
      version: 1,
      id: scope.id("b.claims"),
      evidenceRefs: refs,
      proposalId: proposal?.proposalId ?? null,
      rows: scan.rows,
      totalUsd: scan.totalMicro === null ? null : usd6(scan.totalMicro),
      unpricedCount: scan.unpricedCount,
      signatures: {
        count: proposal?.calls.length ?? 0,
        atomic: (proposal?.calls.length ?? 0) <= 1,
      },
      irreversibilityNote: "claim_final",
    },
    sourceCluster(scope, evidence),
  ]
  return {
    tool,
    intent: "claim_rewards",
    status: "ok",
    title: "Claimable rewards",
    snapshot: {
      blockNumber: scan.blockNumber,
      epoch: null,
      label: `block ${displayBlock(scan.blockNumber)}`,
    },
    answer: {
      kind: "result",
      templateId: `${tool}.lead.v1`,
      text,
      factRefs: facts.map((fact) => fact.id),
    },
    why: null,
    facts,
    evidence,
    blocks,
    proposals: proposal ? [proposal] : [],
    followups: proposal
      ? [navigateFollowup(scope, "rewards", "Open Rewards", "/rewards")]
      : [
          queryFollowup(scope, "claim", "Claim all", "claim all my rewards"),
          navigateFollowup(scope, "rewards", "Open Rewards", "/rewards"),
        ],
    trace: claimTrace(context, scan, proposal, tool),
    checked: [
      plural(new Set(scan.raw.map((lock) => lock.tokenId)).size, "lock"),
      "prices",
    ],
    model: {
      rows: [
        {
          total: displayUsd(scan.totalMicro),
          claims: `${scan.rows.length}`,
          unpriced: `${scan.unpricedCount}`,
        },
        ...scan.rows.map((row) => ({
          source: SOURCE_LABEL[row.source],
          lock: row.tokenId ? `#${row.tokenId}` : null,
          usd:
            row.usd === null ? "Unpriced" : displayUsd(microFromUsd6(row.usd)),
        })),
      ],
      notes: proposal
        ? [
            `Unsigned claim proposal ${proposal.proposalId}: ${proposal.status}.`,
          ]
        : [],
    },
    surface: proposal ? "canvas" : "rail",
  }
}

const rewardsInput = z.object({
  sources: z
    .array(sourceSchema)
    .min(1)
    .max(4)
    .nullable()
    .describe("Reward sources, null = all four."),
  lockIds: z.array(z.string().regex(/^\d+$/)).max(64).nullable(),
})

export const ALL_SOURCES: VoterSource[] = [
  "boost_bribes",
  "mezo_bribes",
  "pool_fees_bribes",
  "validator_bribes",
]

async function runRewards(
  context: ToolContext,
  input: z.infer<typeof rewardsInput>,
  prepare: boolean,
): Promise<ToolOutcome> {
  const tool = prepare ? "prepare_claim" : "list_claimable_rewards"
  if (context.wallet.address === ZERO_WALLET) {
    return plainOutcome({
      scope: context.scope,
      tool,
      intent: "claim_rewards",
      status: "empty",
      title: "Claimable rewards",
      templateId: `${tool}.no_wallet.v1`,
      text: "Connect or watch a wallet to see claimable rewards.",
      kind: "empty",
      traceLabel: "No wallet selected",
    })
  }
  try {
    const scan = await scanClaims(
      context,
      input.sources ?? ALL_SOURCES,
      input.lockIds,
    )
    if (scan.rows.length === 0) {
      return plainOutcome({
        scope: context.scope,
        tool,
        intent: "claim_rewards",
        status: "empty",
        title: "Claimable rewards",
        templateId: `${tool}.empty.v1`,
        text: "Nothing to claim for this wallet right now.",
        kind: "empty",
        traceLabel: "Read claimable rewards",
        evidence: [
          chainEvidence({
            scope: context.scope,
            key: "earned",
            label: "Claimable",
            source: "Reward contracts earned(token, tokenId)",
            blockNumber: scan.blockNumber,
            fetchedAt: scan.fetchedAt,
          }),
        ],
      })
    }
    const proposal = prepare ? await buildClaimProposal(context, scan) : null
    return claimsOutcome(context, scan, proposal, tool)
  } catch {
    return errorOutcome({
      scope: context.scope,
      tool,
      intent: "claim_rewards",
      title: "Claimable rewards",
    })
  }
}

export const listClaimableTool = defineTool({
  name: "list_claimable_rewards",
  family: "rewards",
  description:
    "Claimable voting rewards for the selected wallet, exact on-chain amounts per lock: boost rewards and cross-chain (MEZO gauge) rewards on veMEZO locks, validator rewards and pool fees and incentives on veBTC locks. Read only.",
  input: rewardsInput,
  run: (context, input) => runRewards(context, input, false),
})

export const prepareClaimTool = defineTool({
  name: "prepare_claim",
  family: "rewards",
  description:
    "Prepare unsigned claim transactions for every lock with claimable rewards (one per lock and voter), exact amounts from earned(). Use when the user asks to claim.",
  input: rewardsInput,
  run: (context, input) => runRewards(context, input, true),
})
