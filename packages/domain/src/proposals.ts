import { BOOST_VOTER_ABI, CHAIN_ID } from "@matchbox/chain"
import { FixedPoint } from "@thesis-co/cent"
import {
  type Address,
  encodeFunctionData,
  getAddress,
  type Hex,
  keccak256,
  stringToHex,
} from "viem"
import { z } from "zod"
import { type UsdAmount, usd, usdDecimal, zeroUsd } from "./money"
import { type GaugeSnapshot, optimizedBallotSchema } from "./voteOptimization"

// Prepared vote proposals for Stuart and the Matchbox MCP: the pure half of
// packages/matchbox-mcp/src/transactions.ts and proposals.ts. Owner checks,
// simulation, savings deposits and refresh against live chain state stay with
// Stuart; the checks they run first live here so they stay testable without a
// chain.

export const transactionRequestSchema = z.object({
  chainId: z.literal(CHAIN_ID.mainnet),
  from: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  data: z.string().regex(/^0x[a-fA-F0-9]*$/),
  value: z.literal("0x0"),
  label: z.string(),
})

export const proposalMetadataSchema = z.object({
  proposalId: z.string(),
  proposalHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  chainId: z.literal(CHAIN_ID.mainnet),
  from: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  origin: z.enum(["optimizer", "manual", "savings"]),
  expiresAt: z.string(),
  snapshotBlock: z.string(),
})

export const preparedVoteSchema = proposalMetadataSchema.extend({
  origin: z.enum(["optimizer", "manual"]),
  status: z.enum(["unsigned", "blocked", "read-only"]),
  canSign: z.boolean(),
  ballots: z.array(optimizedBallotSchema),
  transactionRequests: z.array(transactionRequestSchema),
  simulation: z.object({
    status: z.enum(["passed", "blocked", "not-run"]),
    calls: z.number().int().nonnegative(),
    gasEstimate: z.string().nullable(),
    reason: z.string().nullable(),
    results: z.array(
      z.object({
        label: z.string(),
        status: z.enum(["passed", "blocked", "not-run"]),
        gasEstimate: z.string().nullable(),
        reason: z.string().nullable(),
      }),
    ),
  }),
})

export type PreparedVote = z.infer<typeof preparedVoteSchema>
export type ProposalMetadata = z.infer<typeof proposalMetadataSchema>

export function proposalHashFor(input: {
  kind: "vote" | "savings"
  from: Address
  snapshotBlock: string
  content: unknown
}): Hex {
  return keccak256(
    stringToHex(
      JSON.stringify({
        kind: input.kind,
        chainId: CHAIN_ID.mainnet,
        from: input.from.toLowerCase(),
        snapshotBlock: input.snapshotBlock,
        content: input.content,
      }),
    ),
  )
}

export function createProposalMetadata(input: {
  kind: "vote" | "savings"
  from: Address
  origin: ProposalMetadata["origin"]
  snapshotBlock: string
  content: unknown
  now?: Date
}): ProposalMetadata {
  const proposalHash = proposalHashFor(input)
  const now = input.now ?? new Date()
  return proposalMetadataSchema.parse({
    proposalId: `${input.kind}_${proposalHash.slice(2, 10)}`,
    proposalHash,
    chainId: CHAIN_ID.mainnet,
    from: input.from,
    origin: input.origin,
    expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
    snapshotBlock: input.snapshotBlock,
  })
}

function voteTarget(
  gaugeType: GaugeSnapshot["gauges"][number]["type"],
  gaugeAddress: Address,
  targetAddress: Address | null,
): Address {
  if (gaugeType === "pool" || gaugeType === "vault") {
    if (!targetAddress) {
      throw new Error("Pool or vault vote is missing its canonical target")
    }
    return targetAddress
  }
  return gaugeAddress
}

export function buildVoteTransactionRequest(input: {
  account: Address
  ballot: z.infer<typeof optimizedBallotSchema>
  snapshot: GaugeSnapshot
}): z.infer<typeof transactionRequestSchema> {
  const targets = input.ballot.allocations.map((allocation) => {
    const gauge = input.snapshot.gauges.find(
      (candidate) => candidate.id === allocation.gaugeId,
    )
    if (!gauge) throw new Error(`Unknown gauge ${allocation.gaugeName}`)
    if (
      gauge.votingContract.toLowerCase() !==
      input.ballot.votingContract.toLowerCase()
    ) {
      throw new Error(`Gauge ${allocation.gaugeName} belongs to another voter`)
    }
    return voteTarget(gauge.type, gauge.address, gauge.targetAddress)
  })
  const data = encodeFunctionData({
    abi: BOOST_VOTER_ABI,
    functionName: "vote",
    args: [
      BigInt(input.ballot.position.tokenId),
      targets,
      input.ballot.allocations.map((allocation) =>
        BigInt(allocation.basisPoints),
      ),
    ],
  })
  return transactionRequestSchema.parse({
    chainId: CHAIN_ID.mainnet,
    from: input.account,
    to: input.ballot.votingContract,
    data,
    value: "0x0",
    label: `Vote ${input.ballot.votingBucket} with ${input.ballot.governanceAsset} #${input.ballot.position.tokenId}`,
  })
}

/** Every ballot must spend exactly 100% of its lock. */
export function assertBallotTotals(
  ballots: readonly z.infer<typeof optimizedBallotSchema>[],
): void {
  for (const ballot of ballots) {
    const total = ballot.allocations.reduce(
      (sum, allocation) => sum + allocation.basisPoints,
      0,
    )
    if (total !== 10_000) {
      throw new Error(
        `${ballot.votingBucket} allocations must total 10,000 basis points`,
      )
    }
  }
}

/**
 * The part of preparing a vote that needs no chain: validates the ballots and
 * returns the finished proposal when nothing can be signed (no ballot, or a
 * watched or inspected wallet). Returns null for a connected wallet with
 * ballots, which Stuart then checks against the chain and simulates.
 */
export function prepareVoteWithoutChain(input: {
  address: string
  walletMode: "connected" | "watching" | "inspecting"
  snapshot: GaugeSnapshot
  ballots: z.infer<typeof optimizedBallotSchema>[]
  origin?: "optimizer" | "manual"
}): PreparedVote | null {
  const account = getAddress(input.address)
  const ballots = input.ballots.map((ballot) =>
    optimizedBallotSchema.parse(ballot),
  )
  assertBallotTotals(ballots)

  const emptyMetadata = createProposalMetadata({
    kind: "vote",
    from: account,
    origin: input.origin ?? "manual",
    snapshotBlock: input.snapshot.blockNumber,
    content: { ballots, transactionRequests: [] },
  })
  if (ballots.length === 0) {
    return preparedVoteSchema.parse({
      ...emptyMetadata,
      status: input.walletMode === "connected" ? "blocked" : "read-only",
      canSign: false,
      ballots: [],
      transactionRequests: [],
      simulation: {
        status: input.walletMode === "connected" ? "blocked" : "not-run",
        calls: 0,
        gasEstimate: null,
        reason: "No eligible voting position and ballot were available.",
        results: [],
      },
    })
  }
  if (input.walletMode !== "connected") {
    return preparedVoteSchema.parse({
      ...emptyMetadata,
      status: "read-only",
      canSign: false,
      ballots,
      transactionRequests: [],
      simulation: {
        status: "not-run",
        calls: 0,
        gasEstimate: null,
        reason: "Watched and inspected wallets are read-only.",
        results: ballots.map((ballot) => ({
          label: `Vote ${ballot.votingBucket} with ${ballot.governanceAsset} #${ballot.position.tokenId}`,
          status: "not-run",
          gasEstimate: null,
          reason: "Connect this wallet to simulate and sign this ballot.",
        })),
      },
    })
  }
  return null
}

/**
 * Rejects a prepared vote whose ballots or calls no longer match the hash it
 * was issued with (refreshProposal's assertProposalHash for votes).
 */
export function assertVoteProposalHash(proposal: PreparedVote): void {
  const expected = proposalHashFor({
    kind: "vote",
    from: getAddress(proposal.from),
    snapshotBlock: proposal.snapshotBlock,
    content: {
      ballots: proposal.ballots,
      transactionRequests: proposal.transactionRequests,
    },
  })
  if (
    expected.toLowerCase() !== proposal.proposalHash.toLowerCase() ||
    `vote_${expected.slice(2, 10)}` !== proposal.proposalId
  ) {
    throw new Error("Proposal content hash does not match its payload")
  }
}

export const allocationDiffSchema = z.object({
  material: z.boolean(),
  allocationChanged: z.boolean(),
  projectedChangeMaterial: z.boolean(),
  callsChanged: z.boolean(),
  beforeProjectedUsd: z.string().nullable(),
  afterProjectedUsd: z.string().nullable(),
  targets: z.array(
    z.object({
      ballotKey: z.string(),
      gaugeId: z.string(),
      gaugeName: z.string(),
      beforeBasisPoints: z.number().int().min(0).max(10_000),
      afterBasisPoints: z.number().int().min(0).max(10_000),
      deltaBasisPoints: z.number().int().min(-10_000).max(10_000),
    }),
  ),
  notice: z.string(),
})

export type AllocationDiff = z.infer<typeof allocationDiffSchema>

export function assertProposalBinding(input: {
  address: string
  chainId: number
  from: string
}): void {
  if (input.chainId !== 31_612) {
    throw new Error("Proposal refresh is limited to Mezo Mainnet")
  }
  if (input.address.toLowerCase() !== input.from.toLowerCase()) {
    throw new Error("Proposal refresh wallet does not match its bound address")
  }
}

function ballotKey(ballot: z.infer<typeof optimizedBallotSchema>): string {
  return [
    ballot.votingContract.toLowerCase(),
    ballot.votingBucket,
    ballot.governanceAsset,
    ballot.position.tokenId,
  ].join(":")
}

function projectedTotal(
  ballots: z.infer<typeof optimizedBallotSchema>[],
): UsdAmount {
  return ballots.reduce(
    (total, ballot) => total.add(usd(ballot.projectedReturnUsd)),
    zeroUsd(),
  )
}

function projectedChangeIsMaterial(
  before: UsdAmount,
  after: UsdAmount,
): boolean {
  const difference =
    after.compare(before) >= 0 ? after.subtract(before) : before.subtract(after)
  if (before.compare(zeroUsd()) === 0) {
    return difference.compare(zeroUsd()) > 0
  }
  return difference.compare(before.multiply(FixedPoint("0.01"))) >= 0
}

export function createVoteAllocationDiff(input: {
  before: z.infer<typeof optimizedBallotSchema>[]
  after: z.infer<typeof optimizedBallotSchema>[]
  callsChanged: boolean
}): AllocationDiff {
  type AllocationEntry = {
    ballotKey: string
    gaugeId: string
    gaugeName: string
    basisPoints: number
  }
  function allocations(
    ballots: z.infer<typeof optimizedBallotSchema>[],
  ): Map<string, AllocationEntry> {
    const entries = ballots.flatMap((ballot) =>
      ballot.allocations.map((allocation) => {
        const key = ballotKey(ballot)
        return [
          `${key}:${allocation.gaugeId}`,
          {
            ballotKey: key,
            gaugeId: allocation.gaugeId,
            gaugeName: allocation.gaugeName,
            basisPoints: allocation.basisPoints,
          },
        ] as const
      }),
    )
    return new Map(entries)
  }
  const beforeAllocations = allocations(input.before)
  const afterAllocations = allocations(input.after)
  const keys = new Set([
    ...beforeAllocations.keys(),
    ...afterAllocations.keys(),
  ])
  const targets = [...keys]
    .map((key) => {
      const before = beforeAllocations.get(key)
      const after = afterAllocations.get(key)
      const beforeBasisPoints = before?.basisPoints ?? 0
      const afterBasisPoints = after?.basisPoints ?? 0
      return {
        ballotKey: before?.ballotKey ?? after?.ballotKey ?? "unknown",
        gaugeId: before?.gaugeId ?? after?.gaugeId ?? key,
        gaugeName: before?.gaugeName ?? after?.gaugeName ?? "Unknown gauge",
        beforeBasisPoints,
        afterBasisPoints,
        deltaBasisPoints: afterBasisPoints - beforeBasisPoints,
      }
    })
    .filter((target) => target.deltaBasisPoints !== 0)
    .sort(
      (left, right) =>
        left.ballotKey.localeCompare(right.ballotKey) ||
        left.gaugeName.localeCompare(right.gaugeName),
    )
  const allocationChanged = targets.some(
    (target) => Math.abs(target.deltaBasisPoints) >= 100,
  )
  const beforeProjected = projectedTotal(input.before)
  const afterProjected = projectedTotal(input.after)
  const projectedChangeMaterial = projectedChangeIsMaterial(
    beforeProjected,
    afterProjected,
  )
  const material =
    allocationChanged || projectedChangeMaterial || input.callsChanged
  return allocationDiffSchema.parse({
    material,
    allocationChanged,
    projectedChangeMaterial,
    callsChanged: input.callsChanged,
    beforeProjectedUsd: usdDecimal(beforeProjected),
    afterProjectedUsd: usdDecimal(afterProjected),
    targets,
    notice: material
      ? "Live proposal inputs changed materially. Acknowledge this diff before opening the wallet."
      : "The refreshed proposal remains within the material-change thresholds.",
  })
}
