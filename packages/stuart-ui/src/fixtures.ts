import {
  demoGauges,
  demoTokens,
  demoWallet,
} from "@matchbox/contracts/read-models/fixtures"
import type {
  Evidence,
  Proposal,
  StuartRequest,
  StuartResponse,
  UiBlock,
  WalletMode,
} from "./contract"

/**
 * The Epoch 47 demo (matchbox-v3 Shared demo data): Sun 8 Nov 2026, block
 * 13,078,795, veMEZO #2207 voting Kiln Labs 70% and veBTC #604 30%. Gauge
 * addresses come from the read-model fixtures so links open the same
 * profiles Pro shows in fixture mode. Every response passes the contract.
 */

export type FixtureTurn = {
  status: string[]
  response: StuartResponse
}

const block = "13078795"
const signBlock = "13078801"
const generatedAt = "2026-11-08T11:53:00.000Z"
const boostVoter = "0x2Ba614a598Cffa5a19d683cDCA97bac3a49313d1"
const epochStart = "1793836800"
const epochEndsAt = "2026-11-12T00:00:00.000Z"

const gaugeEvidence: Evidence = {
  id: "e.gauges",
  kind: "indexer",
  label: "Matchbox gauges",
  source: "BoostVoter 0x2Ba6…13d1",
  blockNumber: block,
  epoch: 47,
  fetchedAt: generatedAt,
  status: "live",
}

const simulationEvidence: Evidence = {
  id: "e.simulation",
  kind: "chain",
  label: "Simulation",
  source: "eth_call on Mezo Mainnet",
  blockNumber: signBlock,
  epoch: 47,
  fetchedAt: generatedAt,
  status: "live",
}

function walletOf(request: StuartRequest): {
  address: string
  mode: WalletMode
  label: string
} {
  if (request.wallet === undefined) {
    return {
      address: "0x0000000000000000000000000000000000000000",
      mode: "inspecting",
      label: "No wallet",
    }
  }
  return {
    address: request.wallet.address,
    mode: request.wallet.mode,
    label: request.wallet.label ?? request.wallet.address,
  }
}

function base(
  request: StuartRequest,
  id: string,
): Pick<
  StuartResponse,
  | "version"
  | "responseId"
  | "requestId"
  | "generatedAt"
  | "snapshot"
  | "wallet"
  | "presentation"
  | "service"
> {
  const wallet = walletOf(request)
  return {
    version: 1,
    responseId: `q_${id}`,
    requestId: id,
    generatedAt,
    snapshot: {
      chainId: 31_612,
      blockNumber: block,
      epoch: 47,
      label: "Epoch 47, block 13,078,795",
    },
    wallet: { ...wallet, network: "Mezo Mainnet" },
    presentation: { surface: "rail", openCanvas: false },
    service: {
      runtime: "deterministic",
      model: null,
      degraded: false,
      notice: null,
      rateLimited: false,
    },
  }
}

const mezo = (
  whole: string,
): { raw: string; decimals: number; symbol: string } => ({
  raw: `${whole}000000000000000000`,
  decimals: 18,
  symbol: "MEZO",
})

const priceEvidence: Evidence = {
  id: "e.prices",
  kind: "price",
  label: "Prices",
  source: "Aerodrome CL slot0 (Base)",
  fetchedAt: generatedAt,
  status: "live",
}

function trace(
  id: string,
  summary: string,
  items: { label: string; detail: string | null }[],
): UiBlock {
  return {
    type: "activity_trace",
    version: 1,
    id,
    evidenceRefs: [],
    summary,
    items: items.map((item, index) => ({
      id: `${id}.${index}`,
      label: item.label,
      detail: item.detail,
      tool: null,
      durationMs: null,
      status: "ok",
    })),
  }
}

const voter = "0x2Ba614a598Cffa5a19d683cDCA97bac3a49313d1"
const bribe = "0x7d2b6e1c0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d"

function claimProposal(request: StuartRequest): Proposal {
  const wallet = walletOf(request)
  const from = wallet.mode === "inspecting" ? demoWallet : wallet.address
  const connected = wallet.mode === "connected"
  return {
    proposalId: "claim_3c94e1b2",
    proposalHash:
      "0x3c94e1b2a7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0",
    refreshToken:
      "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809",
    kind: "claim",
    chainId: 31_612,
    from,
    origin: "user_request",
    status: connected ? "unsigned" : "read_only",
    canSign: connected,
    blockedReason: connected ? null : "connect_this_wallet",
    createdAt: generatedAt,
    expiresAt: "2026-11-08T12:08:00.000Z",
    snapshotBlock: signBlock,
    calculationVersion: "1.0.0",
    atomicity: "single",
    approvals: [],
    calls: [
      {
        index: 0,
        chainId: 31_612,
        from,
        to: voter,
        data: "0x7715ee75",
        value: "0x0",
        kind: "claim",
        label: "Claim veMEZO #2930",
        detail: "Boost rewards from Epoch 46",
        dependsOn: null,
        refreshAfterDependency: false,
      },
    ],
    simulation: {
      status: "passed",
      method: "eth_call",
      calls: [
        { index: 0, status: "passed", gasEstimate: "212000", reason: null },
      ],
    },
    quote: null,
    content: {
      kind: "claim",
      rows: [
        {
          rowKey: "boost_bribes:2930",
          source: "boost_bribes",
          contract: bribe,
          tokenId: "2930",
          rewards: [
            {
              token: demoTokens.mezo.address,
              amount: {
                raw: "958960000000000000000",
                decimals: 18,
                symbol: "MEZO",
              },
              usd: "3.940000",
            },
          ],
          usd: "3.940000",
          unpricedCount: 0,
        },
      ],
      totalUsd: "3.940000",
      unpricedCount: 0,
    },
  }
}

function claimAll(request: StuartRequest, id: string): FixtureTurn {
  const proposal = claimProposal(request)
  return {
    status: [
      "Reading claimable rewards",
      "Pricing MEZO",
      "Simulating the claim",
    ],
    response: {
      ...base(request, id),
      intent: "claim_rewards",
      title: "Claim, #2930",
      answer: {
        kind: "result",
        origin: "template",
        templateId: "claim.all.v1",
        text: "$3.94 to claim from veMEZO #2930. One signature.",
        factRefs: ["f.claim"],
        evidenceRefs: ["e.gauges", "e.prices", "e.simulation"],
      },
      why: null,
      facts: [
        {
          id: "f.claim",
          label: "Claimable",
          value: { kind: "usd", usd: "3.940000" },
          display: "$3.94",
          status: "live",
          evidenceRefs: ["e.gauges"],
        },
      ],
      evidence: [gaugeEvidence, priceEvidence, simulationEvidence],
      uiBlocks: [
        trace("b.trace", "Checked 1 lock and prices, block 13,078,795", [
          {
            label: "Read claimable rewards",
            detail: "veMEZO #2930, boost rewards from veBTC #6033",
          },
          { label: "Priced MEZO at $0.0041", detail: "Aerodrome on Base" },
          { label: "Simulated the claim", detail: "Passed" },
        ]),
      ],
      proposedActions: [proposal],
      followups: [],
    },
  }
}

function ranking(request: StuartRequest, id: string): FixtureTurn {
  return {
    status: ["Reading 34 gauges", "Ranking 34 gauges", "Read 34 gauges"],
    response: {
      ...base(request, id),
      intent: "rank_gauges",
      title: "veBTC gauges by APY, Epoch 47",
      answer: {
        kind: "result",
        origin: "template",
        templateId: "rank.apy.v1",
        text: "Sats Collective pays most per vote. Moving your 70% from Kiln Labs there adds $2.83 this epoch.",
        factRefs: ["f.gain"],
        evidenceRefs: ["e.gauges"],
      },
      why: null,
      facts: [
        {
          id: "f.gain",
          label: "Added this epoch",
          value: { kind: "usd", usd: "2.830000" },
          display: "$2.83",
          status: "projected",
          evidenceRefs: ["e.gauges"],
        },
      ],
      evidence: [gaugeEvidence, priceEvidence],
      uiBlocks: [
        trace("b.trace", "Checked 34 gauges and prices, block 13,078,795", [
          { label: "Read 34 gauges", detail: "veBTC gauges, Epoch 47" },
          { label: "Priced the incentives", detail: "MEZO and BTC" },
          { label: "Ranked by incentives per veMEZO", detail: null },
        ]),
        {
          type: "gauge_ranking",
          version: 1,
          id: "b.ranking",
          evidenceRefs: ["e.gauges"],
          objective: "highest_apy",
          domain: {
            branch: "boost",
            governanceAsset: "veMEZO",
            votingContract: boostVoter,
          },
          epoch: { number: 47, start: epochStart, endsAt: epochEndsAt },
          snapshotBlock: block,
          calculationVersion: "apy.v1",
          consistencyWindow: null,
          rows: [
            {
              targetId: demoGauges.satsCollective.address,
              targetAddress: demoGauges.satsCollective.address,
              name: "Sats Collective",
              nameSource: "profile",
              tokenId: "112",
              allocationBps: null,
              projectedUsd: null,
              projectedNative: null,
              depositedUsd: "388.000000",
              pricingStatus: "complete",
              fundedEpochs: 6,
              observedEpochs: 8,
              competingWeight: "1270000000000000000000000",
              apyBps: 330,
              picture: demoGauges.satsCollective.picture,
              incentiveTokens: [
                demoTokens.btc.address,
                demoTokens.mezo.address,
              ],
            },
            {
              targetId: demoGauges.vebtc604.address,
              targetAddress: demoGauges.vebtc604.address,
              name: "veBTC #604",
              nameSource: "derived",
              tokenId: "604",
              allocationBps: null,
              projectedUsd: null,
              projectedNative: null,
              depositedUsd: "519.420000",
              pricingStatus: "complete",
              fundedEpochs: 8,
              observedEpochs: 8,
              competingWeight: "2180000000000000000000000",
              apyBps: 305,
              picture: demoGauges.vebtc604.picture,
              incentiveTokens: [demoTokens.mezo.address],
            },
            {
              targetId: demoGauges.northgate.address,
              targetAddress: demoGauges.northgate.address,
              name: "Northgate Capital",
              nameSource: "profile",
              tokenId: "31",
              allocationBps: null,
              projectedUsd: null,
              projectedNative: null,
              depositedUsd: "802.000000",
              pricingStatus: "complete",
              fundedEpochs: 8,
              observedEpochs: 8,
              competingWeight: "3410000000000000000000000",
              apyBps: 261,
              picture: demoGauges.northgate.picture,
              incentiveTokens: [
                demoTokens.mezo.address,
                demoTokens.musd.address,
              ],
            },
            {
              targetId: demoGauges.kilnLabs.address,
              targetAddress: demoGauges.kilnLabs.address,
              name: "Kiln Labs",
              nameSource: "profile",
              tokenId: "7",
              allocationBps: null,
              projectedUsd: null,
              projectedNative: null,
              depositedUsd: "1180.000000",
              pricingStatus: "complete",
              fundedEpochs: 8,
              observedEpochs: 8,
              competingWeight: "5880000000000000000000000",
              apyBps: 256,
              picture: demoGauges.kilnLabs.picture,
              incentiveTokens: [demoTokens.mezo.address],
            },
          ],
          proposalId: null,
          actions: ["open_vote_page"],
        },
      ],
      proposedActions: [],
      followups: [
        {
          id: "fu.move",
          label: "Move the Kiln Labs 70% to Sats Collective",
          action: {
            kind: "query",
            query: "Move the Kiln Labs 70% to Sats Collective",
          },
        },
        {
          id: "fu.vote",
          label: "Open Vote",
          action: { kind: "navigate", to: "/vote" },
        },
      ],
    },
  }
}

function voteProposal(request: StuartRequest): Proposal {
  const wallet = walletOf(request)
  const from = wallet.mode === "inspecting" ? demoWallet : wallet.address
  const connected = wallet.mode === "connected"
  return {
    proposalId: "vote_5a1c0e47",
    proposalHash:
      "0x5a1c0e47d3b2a19f6e8c7b4a3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e",
    refreshToken:
      "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0",
    kind: "vote",
    chainId: 31_612,
    from,
    origin: "user_request",
    status: connected ? "unsigned" : "read_only",
    canSign: connected,
    blockedReason: connected ? null : "connect_this_wallet",
    createdAt: generatedAt,
    expiresAt: "2026-11-08T12:08:00.000Z",
    snapshotBlock: signBlock,
    calculationVersion: "vote.v1",
    atomicity: "single",
    approvals: [],
    calls: [
      {
        index: 0,
        chainId: 31_612,
        from,
        to: boostVoter,
        data: "0x7ac09bf7",
        value: "0x0",
        kind: "vote",
        label: "Vote with #2207",
        dependsOn: null,
        refreshAfterDependency: false,
      },
    ],
    simulation: {
      status: "passed",
      method: "eth_call",
      calls: [
        { index: 0, status: "passed", gasEstimate: "182400", reason: null },
      ],
    },
    quote: null,
    content: {
      kind: "vote",
      ballots: [
        {
          ballotKey: "boost:2207",
          branch: "boost",
          governanceAsset: "veMEZO",
          votingContract: boostVoter,
          tokenId: "2207",
          votingPower: "41260000000000000000000",
          selected: true,
          allocations: [
            {
              targetId: demoGauges.satsCollective.address,
              targetAddress: demoGauges.satsCollective.address,
              name: "Sats Collective",
              bps: 7000,
              projectedUsd: "9.760000",
            },
            {
              targetId: demoGauges.vebtc604.address,
              targetAddress: demoGauges.vebtc604.address,
              name: "veBTC #604",
              bps: 3000,
              projectedUsd: "1.820000",
            },
          ],
        },
      ],
      manualOverride: false,
      projectedUsd: "11.580000",
      projectedNative: null,
    },
  }
}

function preparedVote(request: StuartRequest, id: string): FixtureTurn {
  const proposal = voteProposal(request)
  return {
    status: [
      "Reading your ballot",
      "Simulating your ballot",
      "Simulated your ballot",
    ],
    response: {
      ...base(request, id),
      intent: "custom_vote",
      title: "Vote change, #2207",
      answer: {
        kind: "result",
        origin: "template",
        templateId: "vote.custom.v1",
        text: "Ready to sign. veBTC #604 keeps its 30%.",
        factRefs: [],
        evidenceRefs: ["e.gauges", "e.simulation"],
      },
      why: null,
      facts: [
        {
          id: "f.projected",
          label: "Projected",
          value: { kind: "usd", usd: "11.580000" },
          display: "$11.58",
          status: "projected",
          evidenceRefs: ["e.gauges"],
        },
      ],
      evidence: [gaugeEvidence, simulationEvidence],
      uiBlocks: [
        {
          type: "allocation_diff",
          version: 1,
          id: "b.diff",
          evidenceRefs: ["e.gauges"],
          proposalId: proposal.proposalId,
          refreshedProposalId: proposal.proposalId,
          refreshedAtBlock: signBlock,
          material: false,
          reasons: [],
          beforeProjectedUsd: "8.750000",
          afterProjectedUsd: "11.580000",
          projectedDeltaBps: 3234,
          beforeNative: null,
          afterNative: null,
          rows: [
            {
              ballotKey: "boost:2207",
              targetId: demoGauges.satsCollective.address,
              name: "Sats Collective",
              beforeBps: 0,
              afterBps: 7000,
              deltaProjectedUsd: "9.760000",
            },
            {
              ballotKey: "boost:2207",
              targetId: demoGauges.kilnLabs.address,
              name: "Kiln Labs",
              beforeBps: 7000,
              afterBps: 0,
              deltaProjectedUsd: "-6.930000",
            },
            {
              ballotKey: "boost:2207",
              targetId: demoGauges.vebtc604.address,
              name: "veBTC #604",
              beforeBps: 3000,
              afterBps: 3000,
              deltaProjectedUsd: "0.000000",
            },
          ],
          manualEditsPreserved: false,
          actions: [],
        },
      ],
      proposedActions: [proposal],
      followups: [],
    },
  }
}

function gaugeExplain(request: StuartRequest, id: string): FixtureTurn {
  const kiln = demoGauges.kilnLabs
  return {
    status: ["Reading Kiln Labs gauge", "Read Kiln Labs gauge"],
    response: {
      ...base(request, id),
      intent: "explain_gauge",
      title: "Kiln Labs to 5×",
      answer: {
        kind: "result",
        origin: "template",
        templateId: "gauge.optimal.v1",
        text: "1.09M votes short. Your 70% from #2207 is already 28,882 of the 5.88M.",
        factRefs: ["f.short", "f.yours"],
        evidenceRefs: ["e.kiln"],
      },
      why: null,
      facts: [
        {
          id: "f.short",
          label: "To 5×",
          value: { kind: "token", amount: mezo("1090000") },
          display: "1.09M",
          status: "live",
          evidenceRefs: ["e.kiln"],
        },
        {
          id: "f.yours",
          label: "Your votes",
          value: { kind: "token", amount: mezo("28882") },
          display: "28,882",
          status: "live",
          evidenceRefs: ["e.kiln"],
        },
      ],
      evidence: [
        {
          ...gaugeEvidence,
          id: "e.kiln",
          label: "Kiln Labs gauge",
          source: `Gauge ${kiln.address.slice(0, 6)}…${kiln.address.slice(-4)}`,
        },
      ],
      uiBlocks: [
        {
          type: "gauge_explain",
          version: 1,
          id: "b.explain",
          evidenceRefs: ["e.kiln"],
          target: {
            targetAddress: kiln.address,
            name: "Kiln Labs",
            nameSource: "profile",
            tokenId: "7",
            branch: "boost",
            isAlive: true,
            picture: kiln.picture,
          },
          incentivesUsd: "1180.000000",
          pricingStatus: "complete",
          incentives: [mezo("6413")],
          weight: { ...mezo("5880000"), symbol: "veMEZO" },
          apyBps: 256,
          boostWad: "4400000000000000000",
          optimalVeMEZO: { ...mezo("6970000"), symbol: "veMEZO" },
          additionalVeMEZO: { ...mezo("1090000"), symbol: "veMEZO" },
          epochs: [],
          historyStatus: "live",
          notSelectedReason: null,
          snapshotBlock: block,
        },
      ],
      proposedActions: [],
      followups: [
        {
          id: "fu.add",
          label: "Add votes",
          action: { kind: "navigate", to: "/vote" },
        },
      ],
    },
  }
}

let counter = 0

function requestId(): string {
  counter += 1
  const tail = counter.toString(16).padStart(12, "0")
  return `5f0c7a2e-8b1d-4c3e-9a6f-${tail}`
}

/** Picks the demo answer that fits the question. */
export function fixtureTurn(request: StuartRequest): FixtureTurn {
  const query = request.query.toLowerCase()
  const id = requestId()
  if (/\bclaim\b/.test(query)) return claimAll(request, id)
  if (/\b(move|sign|switch|change)\b/.test(query))
    return preparedVote(request, id)
  if (
    request.context?.page?.entity?.type === "gauge" ||
    query.includes("5×") ||
    query.includes("5x") ||
    query.includes("how far")
  ) {
    return gaugeExplain(request, id)
  }
  return ranking(request, id)
}
