import { CHAIN_ID } from "@matchbox/chain"
import { getAddress } from "viem"
import { z } from "zod"
import { proportionalUsd, usd, usdDecimal, zeroUsd } from "./money"
import { optimizeRewardAllocations } from "./rewardOptimizer"

// Gauge-snapshot ballots for Stuart and the Matchbox MCP: the pure half of
// packages/matchbox-mcp/src/optimizer.ts on feat/pro-rebuild. Each voting
// domain is solved once with the closed-form reward optimizer, jointly across
// every eligible lock, and each lock gets an independent ballot with the same
// basis-point vector. Reading positions and snapshots over RPC stays with
// Stuart.

// Every Mezo voter rejects ballots over maxVotingNum (30) targets.
const MAX_TARGETS_PER_BALLOT = 30

/**
 * Identifies the optimizer's output. The closed-form optimizer replaced the
 * earlier greedy 1% allocator (`optimizer-live-v1`) under this label.
 */
export const REWARD_OPTIMIZER_VERSION = "optimizer-live-v2"

// The Matchbox indexer gauge snapshot (adapters/matchbox-gauges.ts).

const rawAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .transform((value) => getAddress(value))
const rawUintSchema = z.string().regex(/^\d+$/)
const usdStringSchema = z.string().regex(/^\d+(?:\.\d+)?$/)

export const indexedGaugeSchema = z.object({
  id: z.string(),
  address: rawAddressSchema,
  targetAddress: rawAddressSchema.nullable(),
  name: z.string(),
  type: z.enum(["boost", "pool", "vault", "validator"]),
  governanceAsset: z.enum(["veMEZO", "veBTC"]),
  votingBucket: z.string(),
  votingContract: rawAddressSchema,
  depositedUsd: usdStringSchema,
  currentWeight: rawUintSchema,
  consistencyBps: z.number().int().min(0).max(10_000),
  fundedEpochs: z.number().int().min(0),
  observedEpochs: z.number().int().positive(),
  tokenPair: z.array(z.string()).min(1),
  pricingStatus: z.enum(["complete", "partial"]),
  unpricedTokenCount: z.number().int().nonnegative(),
  /**
   * veBTC gauges: the boosted lock's state. Expired and withdrawn locks have
   * no voting power and earn voters nothing, so they are never candidates.
   */
  lockState: z.enum(["active", "auto-max", "expired", "withdrawn"]).optional(),
})

export const gaugeSnapshotSchema = z.object({
  chainId: z.literal(CHAIN_ID.mainnet),
  blockNumber: rawUintSchema,
  epochStart: rawUintSchema,
  generatedAt: z.string(),
  gauges: z.array(indexedGaugeSchema),
  source: z.object({
    name: z.literal("Matchbox mainnet indexer + Mezo RPC"),
    url: z.string().url(),
    status: z.literal("live"),
  }),
})

export type IndexedGauge = z.infer<typeof indexedGaugeSchema>
export type GaugeSnapshot = z.infer<typeof gaugeSnapshotSchema>

export const votingPositionSchema = z.object({
  governanceAsset: z.enum(["veMEZO", "veBTC"]),
  tokenId: z.string().regex(/^\d+$/),
  votingPower: z.string().regex(/^\d+$/),
  votingPowerFormatted: z.string(),
})

export const optimizedAllocationSchema = z.object({
  gaugeId: z.string(),
  gaugeAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  gaugeName: z.string(),
  gaugeType: z.enum(["boost", "pool", "vault", "validator"]),
  tokenPair: z.array(z.string()),
  pricingStatus: z.enum(["complete", "partial"]),
  // Display only; basisPoints is what the ballot signs.
  percentage: z.number().min(0.01).max(100),
  basisPoints: z.number().int().min(1).max(10_000),
  depositedUsd: z.string(),
  projectedReturnUsd: z.string(),
  consistencyBps: z.number().int().min(0).max(10_000),
})

export const optimizedBallotSchema = z.object({
  votingContract: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  votingBucket: z.string(),
  governanceAsset: z.enum(["veMEZO", "veBTC"]),
  position: votingPositionSchema,
  allocations: z.array(optimizedAllocationSchema).min(1),
  projectedReturnUsd: z.string(),
})

export const voteOptimizationSchema = z.object({
  objective: z.literal("Best personal return"),
  calculationVersion: z.literal(REWARD_OPTIMIZER_VERSION),
  chainId: z.literal(CHAIN_ID.mainnet),
  snapshotBlock: z.string(),
  generatedAt: z.string(),
  positions: z.array(votingPositionSchema),
  ballots: z.array(optimizedBallotSchema),
  projectedTotalUsd: z.string(),
  notices: z.array(z.string()),
})

export type VotingPosition = z.infer<typeof votingPositionSchema>
export type VoteOptimization = z.infer<typeof voteOptimizationSchema>

/** False for veBTC gauges whose lock expired or was withdrawn. */
export function isOptimizableLockState(
  state: "active" | "auto-max" | "expired" | "withdrawn" | undefined | null,
): boolean {
  return state !== "expired" && state !== "withdrawn"
}

export function projectedGaugeReturn(input: {
  depositedUsd: string
  currentWeight: bigint
  votingPower: bigint
  allocationBasisPoints: number
}) {
  if (input.allocationBasisPoints === 0) return zeroUsd()
  const allocatedPower =
    (input.votingPower * BigInt(input.allocationBasisPoints)) / 10_000n
  return proportionalUsd(
    usd(input.depositedUsd),
    allocatedPower,
    input.currentWeight + allocatedPower,
  )
}

export function repriceBallots(input: {
  ballots: z.infer<typeof optimizedBallotSchema>[]
  positions: VotingPosition[]
  snapshot: GaugeSnapshot
}): z.infer<typeof optimizedBallotSchema>[] {
  const positions = new Map(
    input.positions.map((position) => [
      `${position.governanceAsset}:${position.tokenId}`,
      position,
    ]),
  )
  return input.ballots.map((ballot) => {
    const position = positions.get(
      `${ballot.governanceAsset}:${ballot.position.tokenId}`,
    )
    if (!position) {
      throw new Error(
        `${ballot.governanceAsset} #${ballot.position.tokenId} is no longer eligible`,
      )
    }
    const allocations = ballot.allocations.map((allocation) => {
      const gauge = input.snapshot.gauges.find(
        (candidate) => candidate.id === allocation.gaugeId,
      )
      if (!gauge) {
        throw new Error(`${allocation.gaugeName} is no longer a live gauge`)
      }
      if (
        gauge.votingContract.toLowerCase() !==
          ballot.votingContract.toLowerCase() ||
        gauge.votingBucket !== ballot.votingBucket
      ) {
        throw new Error(`${allocation.gaugeName} changed voting domains`)
      }
      return optimizedAllocationSchema.parse({
        gaugeId: gauge.id,
        gaugeAddress: gauge.address,
        gaugeName: gauge.name,
        gaugeType: gauge.type,
        tokenPair: gauge.tokenPair,
        pricingStatus: gauge.pricingStatus,
        percentage: allocation.percentage,
        basisPoints: allocation.basisPoints,
        depositedUsd: gauge.depositedUsd,
        projectedReturnUsd: usdDecimal(
          projectedGaugeReturn({
            depositedUsd: gauge.depositedUsd,
            currentWeight: BigInt(gauge.currentWeight),
            votingPower: BigInt(position.votingPower),
            allocationBasisPoints: allocation.basisPoints,
          }),
        ),
        consistencyBps: gauge.consistencyBps,
      })
    })
    const projectedTotal = allocations.reduce(
      (total, allocation) => total.add(usd(allocation.projectedReturnUsd)),
      zeroUsd(),
    )
    return optimizedBallotSchema.parse({
      ...ballot,
      position,
      allocations,
      projectedReturnUsd: usdDecimal(projectedTotal),
    })
  })
}

function usdMicro(decimal: string): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(decimal.trim())
  if (!match) return 0n
  return (
    BigInt(match[1] ?? "0") * 1_000_000n +
    BigInt((match[2] ?? "").slice(0, 6).padEnd(6, "0"))
  )
}

function usdCents(micro: bigint): string {
  const cents = (micro + 5_000n) / 10_000n
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`
}

/**
 * Adapter over Matchbox Pro's closed-form reward optimizer — the only
 * optimizer. Each voting domain is solved once, jointly across every
 * eligible lock, and each lock gets an independent ballot with the same
 * basis-point vector (non-atomic, one signature per lock).
 */
export function optimizeGaugeSnapshot(input: {
  snapshot: GaugeSnapshot
  positions: VotingPosition[]
}): VoteOptimization {
  const groups = new Map<string, GaugeSnapshot["gauges"]>()
  for (const gauge of input.snapshot.gauges) {
    if (!isOptimizableLockState(gauge.lockState)) continue
    const key = `${gauge.votingContract.toLowerCase()}:${gauge.votingBucket}`
    const group = groups.get(key) ?? []
    group.push(gauge)
    groups.set(key, group)
  }

  const ballots: z.infer<typeof optimizedBallotSchema>[] = []
  let projectedTotal = 0n
  for (const gauges of groups.values()) {
    const firstGauge = gauges[0]
    if (!firstGauge) continue
    const eligiblePositions = input.positions.filter(
      (position) =>
        position.governanceAsset === firstGauge.governanceAsset &&
        BigInt(position.votingPower) > 0n,
    )
    if (eligiblePositions.length === 0) continue
    const votingPowers = eligiblePositions.map((position) =>
      BigInt(position.votingPower),
    )
    let candidates = gauges.map((gauge) => ({
      id: gauge.id,
      existingWeight: BigInt(gauge.currentWeight),
      incentiveValueMicroUsd: usdMicro(gauge.depositedUsd),
    }))
    let result = optimizeRewardAllocations({ gauges: candidates, votingPowers })
    if (result && result.allocations.length > MAX_TARGETS_PER_BALLOT) {
      const keep = new Set(
        result.allocations
          .slice(0, MAX_TARGETS_PER_BALLOT)
          .map((allocation) => allocation.id),
      )
      candidates = candidates.filter((gauge) => keep.has(gauge.id))
      result = optimizeRewardAllocations({ gauges: candidates, votingPowers })
    }
    if (!result) continue
    const allocations = result.allocations.flatMap((allocation) => {
      const gauge = gauges.find((candidate) => candidate.id === allocation.id)
      return gauge ? [{ allocation, gauge }] : []
    })
    for (const position of eligiblePositions) {
      const power = BigInt(position.votingPower)
      const rows = allocations.map(({ allocation, gauge }) => {
        const lockWeight = (power * allocation.basisPoints) / 10_000n
        const share =
          allocation.voteWeight > 0n
            ? (allocation.projectedRewardMicroUsd * lockWeight) /
              allocation.voteWeight
            : 0n
        return { allocation, gauge, share }
      })
      const ballotProjected = rows.reduce((sum, row) => sum + row.share, 0n)
      projectedTotal += ballotProjected
      ballots.push(
        optimizedBallotSchema.parse({
          votingContract: firstGauge.votingContract,
          votingBucket: firstGauge.votingBucket,
          governanceAsset: firstGauge.governanceAsset,
          position,
          allocations: rows.map(({ allocation, gauge, share }) =>
            optimizedAllocationSchema.parse({
              gaugeId: gauge.id,
              gaugeAddress: gauge.address,
              gaugeName: gauge.name,
              gaugeType: gauge.type,
              tokenPair: gauge.tokenPair,
              pricingStatus: gauge.pricingStatus,
              percentage: Number(allocation.basisPoints) / 100,
              basisPoints: Number(allocation.basisPoints),
              depositedUsd: gauge.depositedUsd,
              projectedReturnUsd: usdCents(share),
              consistencyBps: gauge.consistencyBps,
            }),
          ),
          projectedReturnUsd: usdCents(ballotProjected),
        }),
      )
    }
  }

  const missing = (["veMEZO", "veBTC"] as const).filter(
    (asset) =>
      !input.positions.some((position) => position.governanceAsset === asset),
  )
  return voteOptimizationSchema.parse({
    objective: "Best personal return",
    calculationVersion: REWARD_OPTIMIZER_VERSION,
    chainId: input.snapshot.chainId,
    snapshotBlock: input.snapshot.blockNumber,
    generatedAt: input.snapshot.generatedAt,
    positions: input.positions,
    ballots,
    projectedTotalUsd: usdCents(projectedTotal),
    notices: missing.map(
      (asset) => `No eligible ${asset} lock was found for this wallet.`,
    ),
  })
}
