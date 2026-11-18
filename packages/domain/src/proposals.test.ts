import { CHAIN_ID, CONTRACTS } from "@matchbox/chain"
import { decodeFunctionData, getAddress, type Hex } from "viem"
import { describe, expect, it } from "vitest"
import {
  assertProposalBinding,
  assertVoteProposalHash,
  buildVoteTransactionRequest,
  createProposalMetadata,
  createVoteAllocationDiff,
  preparedVoteSchema,
  prepareVoteWithoutChain,
} from "./proposals"
import { gaugeSnapshotSchema, optimizedBallotSchema } from "./voteOptimization"

// packages/matchbox-mcp/src/proposals.test.ts and transactions.test.ts on
// feat/stuart-query-mvp. Cases that went through refreshProposal or
// prepareVoteTransactions call the chain-free steps those run first.

function diffBallot(basisPoints: number, projectedReturnUsd: string) {
  return optimizedBallotSchema.parse({
    votingContract: CONTRACTS.mainnet.poolsVoter,
    votingBucket: "pool-gauges",
    governanceAsset: "veBTC",
    position: {
      governanceAsset: "veBTC",
      tokenId: "42",
      votingPower: "1000000000000000000",
      votingPowerFormatted: "1",
    },
    allocations: [
      {
        gaugeId: "pool-a",
        gaugeAddress: "0x1111111111111111111111111111111111111111",
        gaugeName: "BTC / MUSD",
        gaugeType: "pool",
        tokenPair: ["BTC", "MUSD"],
        pricingStatus: "complete",
        percentage: basisPoints / 100,
        basisPoints,
        depositedUsd: "100",
        projectedReturnUsd,
        consistencyBps: 10_000,
      },
      {
        gaugeId: "pool-b",
        gaugeAddress: "0x2222222222222222222222222222222222222222",
        gaugeName: "MEZO / MUSD",
        gaugeType: "pool",
        tokenPair: ["MEZO", "MUSD"],
        pricingStatus: "complete",
        percentage: (10_000 - basisPoints) / 100,
        basisPoints: 10_000 - basisPoints,
        depositedUsd: "100",
        projectedReturnUsd: "0",
        consistencyBps: 10_000,
      },
    ],
    projectedReturnUsd,
  })
}

describe("proposal refresh diff", () => {
  it("marks a one-percentage-point allocation change as material", () => {
    const diff = createVoteAllocationDiff({
      before: [diffBallot(5_000, "100")],
      after: [diffBallot(5_100, "100")],
      callsChanged: false,
    })

    expect(diff.material).toBe(true)
    expect(diff.allocationChanged).toBe(true)
    expect(diff.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ deltaBasisPoints: 100 }),
      ]),
    )
  })

  it("marks a one-percent projected-USD change as material", () => {
    const diff = createVoteAllocationDiff({
      before: [diffBallot(5_000, "100")],
      after: [diffBallot(5_000, "101")],
      callsChanged: false,
    })

    expect(diff.material).toBe(true)
    expect(diff.projectedChangeMaterial).toBe(true)
  })

  // refreshProposal checks the binding and then the hash before reading the
  // chain; those checks are what this case exercises.
  it("rejects a refreshed proposal whose content no longer matches its hash", () => {
    const originalBallot = diffBallot(5_000, "100")
    const metadata = createProposalMetadata({
      kind: "vote",
      from: "0x9999999999999999999999999999999999999999",
      origin: "manual",
      snapshotBlock: "100",
      content: { ballots: [originalBallot], transactionRequests: [] },
    })
    const proposal = preparedVoteSchema.parse({
      ...metadata,
      status: "read-only",
      canSign: false,
      ballots: [originalBallot],
      transactionRequests: [],
      simulation: {
        status: "not-run",
        calls: 0,
        gasEstimate: null,
        reason: "Read-only",
        results: [],
      },
    })

    const tampered = { ...proposal, ballots: [diffBallot(5_100, "100")] }
    expect(() =>
      assertProposalBinding({
        address: proposal.from,
        chainId: tampered.chainId,
        from: tampered.from,
      }),
    ).not.toThrow()
    expect(() => assertVoteProposalHash(proposal)).not.toThrow()
    expect(() => assertVoteProposalHash(tampered)).toThrow(/content hash/)
  })
})

const account = getAddress("0x9999999999999999999999999999999999999999")
const pool = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const gauge = "0x1111111111111111111111111111111111111111"
const snapshot = gaugeSnapshotSchema.parse({
  chainId: CHAIN_ID.mainnet,
  blockNumber: "11052919",
  epochStart: "1786320000",
  generatedAt: "2026-08-11T12:00:00.000Z",
  source: {
    name: "Matchbox mainnet indexer + Mezo RPC",
    url: "https://app.matchbox.markets",
    status: "live",
  },
  gauges: [
    {
      id: gauge,
      address: gauge,
      targetAddress: pool,
      name: "BTC / MUSD",
      type: "pool",
      governanceAsset: "veBTC",
      votingBucket: "staking-gauges",
      votingContract: CONTRACTS.mainnet.poolsVoter,
      depositedUsd: "100",
      currentWeight: "1",
      consistencyBps: 10_000,
      fundedEpochs: 8,
      observedEpochs: 8,
      tokenPair: ["BTC", "MUSD"],
      pricingStatus: "complete",
      unpricedTokenCount: 0,
    },
  ],
})
const ballot = optimizedBallotSchema.parse({
  votingContract: CONTRACTS.mainnet.poolsVoter,
  votingBucket: "staking-gauges",
  governanceAsset: "veBTC",
  position: {
    governanceAsset: "veBTC",
    tokenId: "42",
    votingPower: "1000000000000000000",
    votingPowerFormatted: "1",
  },
  allocations: [
    {
      gaugeId: gauge,
      gaugeAddress: gauge,
      gaugeName: "BTC / MUSD",
      gaugeType: "pool",
      tokenPair: ["BTC", "MUSD"],
      pricingStatus: "complete",
      percentage: 100,
      basisPoints: 10_000,
      depositedUsd: "100",
      projectedReturnUsd: "50",
      consistencyBps: 10_000,
    },
  ],
  projectedReturnUsd: "50",
})

describe("vote transaction safety", () => {
  it("keeps watched-wallet ballots read-only", () => {
    const result = prepareVoteWithoutChain({
      address: account,
      walletMode: "watching",
      snapshot,
      ballots: [ballot],
    })

    expect(result?.status).toBe("read-only")
    expect(result?.transactionRequests).toEqual([])
    expect(result?.canSign).toBe(false)
  })

  it("encodes pool targets rather than pool-gauge addresses", () => {
    const voteAbi = [
      {
        inputs: [
          { type: "uint256", name: "_tokenId" },
          { type: "address[]", name: "_poolVote" },
          { type: "uint256[]", name: "_weights" },
        ],
        name: "vote",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
      },
    ] as const
    const request = buildVoteTransactionRequest({
      account,
      ballot,
      snapshot,
    })
    const decoded = decodeFunctionData({
      abi: voteAbi,
      data: request.data as Hex,
    })

    expect(decoded.args?.[1]).toEqual([getAddress(pool)])
  })

  it("rejects ballots that do not total 10,000 basis points", () => {
    expect(() =>
      prepareVoteWithoutChain({
        address: account,
        walletMode: "watching",
        snapshot,
        ballots: [
          {
            ...ballot,
            allocations: ballot.allocations.map((allocation) => ({
              ...allocation,
              percentage: 99,
              basisPoints: 9_900,
            })),
          },
        ],
      }),
    ).toThrow(/10,000 basis points/)
  })
})
