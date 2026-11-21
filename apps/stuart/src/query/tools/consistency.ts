import type { GaugeConsistencyRanking } from "@matchbox/contracts/read-models"
import type {
  Fact,
  GaugeKind,
  GaugeRankingBlock,
  UiBlock,
  VoteBranch,
} from "@matchbox/stuart-ui/contract"
import { getAddress } from "viem"
import { clipName } from "../format"
import { makeEvidence, makeFact, type ToolOutcome, traceItem } from "../outcome"
import { MAINNET } from "../providers/abis"
import { epochNumberFor, OPTIMIZER_CALC_VERSION } from "../versions"
import { sourceCluster } from "./common"
import type { ToolContext } from "./tool"

// "Which gauges have most consistently had rewards?": gauges ranked by the
// epochs, of the last N completed, in which they carried incentives, from
// the API's gauge history (`/internal/pro/gauges/consistency`). Never the
// wallet's claimables.

const KIND_NOUN: Record<GaugeKind, string> = {
  vebtc: "veBTC gauges",
  mezo: "MEZO gauges",
  validator: "validator gauges",
  pool: "pool gauges",
}

const BRANCH_OF: Record<GaugeKind, VoteBranch> = {
  vebtc: "boost",
  mezo: "boost",
  validator: "validators",
  pool: "pools",
}

const VOTER_OF: Record<GaugeKind, string> = {
  vebtc: MAINNET.boostVoter,
  mezo: MAINNET.thirdPartyVoter,
  validator: MAINNET.validatorsVoter,
  pool: MAINNET.poolsVoter,
}

export const KIND_FOR_BRANCH: Record<VoteBranch, GaugeKind> = {
  boost: "vebtc",
  validators: "validator",
  pools: "pool",
}

function windowOf(value: number): GaugeRankingBlock["consistencyWindow"] {
  return value === 4 || value === 8 || value === 12 ? value : null
}

export function consistencyOutcome(input: {
  context: ToolContext
  ranking: GaugeConsistencyRanking
  kind: GaugeKind | null
  blockNumber: bigint | null
}): ToolOutcome | null {
  const { context, ranking, kind } = input
  const { scope } = context
  const rows = ranking.gauges.slice(0, 10)
  const first = rows[0]
  if (first === undefined) return null
  const leadKind = kind ?? first.gauge.kind
  const nowSeconds = BigInt(Math.floor(context.now().getTime() / 1000))
  const epochStart = (nowSeconds / 604_800n) * 604_800n
  const evidence = [
    makeEvidence({
      scope,
      key: "history",
      kind: "indexer",
      label: "Gauge history",
      source: `Incentives per epoch through Epoch ${ranking.throughEpoch}`,
      ...(input.blockNumber === null
        ? {}
        : { blockNumber: input.blockNumber.toString() }),
      epoch: ranking.throughEpoch,
      fetchedAt: context.now().toISOString(),
      status: "historical",
    }),
  ]
  const refs = evidence.map((item) => item.id)
  const name = clipName(first.gauge.name, 32)
  const scope_ = kind === null ? "gauge" : KIND_NOUN[kind].replace(/s$/, "")
  const facts: Fact[] = [
    makeFact({
      scope,
      key: "name.0",
      label: "Gauge",
      value: { kind: "text", text: name },
      display: name,
      status: "historical",
      evidenceRefs: refs,
    }),
    makeFact({
      scope,
      key: "funded.0",
      label: "Funded epochs",
      value: { kind: "count", count: first.recent },
      display: `${first.recent} of the last ${ranking.window}`,
      status: "historical",
      evidenceRefs: refs,
    }),
    makeFact({
      scope,
      key: "streak.0",
      label: "Funded in a row",
      value: { kind: "count", count: first.streak },
      display: String(first.streak),
      status: "historical",
      evidenceRefs: refs,
    }),
  ]
  const [nameFact, fundedFact, streakFact] = facts
  // Ties count across the whole ranking, not just the rows shown.
  const tied = ranking.gauges.filter(
    (row) => row.recent === first.recent,
  ).length
  const windowFact = makeFact({
    scope,
    key: "window",
    label: "Epochs counted",
    value: { kind: "count", count: ranking.window },
    display: String(ranking.window),
    status: "historical",
    evidenceRefs: refs,
  })
  const tiedFact = makeFact({
    scope,
    key: "tied",
    label: "Gauges at that count",
    value: { kind: "count", count: tied },
    display: String(tied),
    status: "historical",
    evidenceRefs: refs,
  })
  facts.push(windowFact, tiedFact)
  const text =
    first.recent === 0
      ? `No ${kind === null ? "gauge" : KIND_NOUN[kind]} carried incentives in the last ${windowFact.display} completed epochs.`
      : tied > 1
        ? `${tiedFact.display} gauges were funded in ${fundedFact?.display} completed epochs. ${nameFact?.display} has the longest run, ${streakFact?.display} in a row.`
        : `${nameFact?.display} was funded in ${fundedFact?.display} completed epochs, ${streakFact?.display} in a row, the most consistent ${scope_}.`
  const blocks: UiBlock[] = [
    {
      type: "gauge_ranking",
      version: 1,
      id: scope.id("b.ranking"),
      evidenceRefs: refs,
      objective: "most_consistently_funded",
      domain: {
        branch: BRANCH_OF[leadKind],
        governanceAsset:
          leadKind === "vebtc" || leadKind === "mezo" ? "veMEZO" : "veBTC",
        votingContract: getAddress(VOTER_OF[leadKind]),
      },
      epoch: {
        number: epochNumberFor(epochStart),
        start: epochStart.toString(),
        endsAt: new Date(Number(epochStart + 604_800n) * 1000).toISOString(),
      },
      snapshotBlock: (input.blockNumber ?? 0n).toString(),
      calculationVersion: OPTIMIZER_CALC_VERSION,
      consistencyWindow: windowOf(ranking.window),
      rows: rows.map((row) => ({
        targetId: row.gauge.address.toLowerCase(),
        targetAddress: getAddress(row.gauge.address),
        name: row.gauge.name.slice(0, 80),
        nameSource: /^veBTC #\d+$|^0x[0-9a-fA-F]{4}…/.test(row.gauge.name)
          ? ("derived" as const)
          : ("profile" as const),
        tokenId: row.gauge.vebtcTokenId,
        allocationBps: null,
        projectedUsd: null,
        projectedNative: null,
        depositedUsd: null,
        pricingStatus: "complete" as const,
        fundedEpochs: row.recent,
        observedEpochs: row.window,
        competingWeight: "0",
        apyBps: null,
        picture: row.gauge.picture,
        incentiveTokens: [],
        kind: row.gauge.kind,
        votesUnit:
          row.gauge.kind === "vebtc" || row.gauge.kind === "mezo"
            ? ("veMEZO" as const)
            : ("veBTC" as const),
      })),
      proposalId: null,
      actions: ["open_vote_page"],
    },
    sourceCluster(scope, evidence),
  ]
  return {
    tool: "rank_gauges",
    intent: "rank_gauges",
    status: "ok",
    title: "Most consistently funded",
    snapshot: {
      blockNumber: input.blockNumber,
      epoch: epochNumberFor(epochStart),
      label: `Through Epoch ${ranking.throughEpoch}`,
    },
    answer: {
      kind: "result",
      templateId: "rank_gauges.consistency.v2",
      text,
      factRefs: facts.map((fact) => fact.id),
    },
    // The API's gauge-funding read model counts an epoch as funded when it
    // has any incentive token, priced or not, and carries only the counts:
    // say so rather than imply the epochs paid priced incentives.
    why: {
      templateId: "rank_gauges.consistency.why.v2",
      items: [
        {
          text: "Funded epochs here count any incentive token, including unpriced ones: this gauge history does not say which tokens were priced.",
          factRefs: [],
        },
      ],
    },
    facts,
    evidence,
    blocks,
    proposals: [],
    followups: [],
    trace: [
      traceItem({
        scope,
        key: "history",
        label: "Counted funded epochs",
        detail: `Last ${ranking.window} completed epochs, through Epoch ${ranking.throughEpoch}`,
        tool: "rank_gauges",
      }),
    ],
    model: {
      rows: rows.map((row) => ({
        name: row.gauge.name,
        funded: `${row.recent} of the last ${row.window}`,
        streak: String(row.streak),
        total: String(row.total),
      })),
      notes: [],
    },
    surface: "canvas",
    checked: [
      `${ranking.window} epochs of ${kind === null ? "gauge" : KIND_NOUN[kind].replace(/s$/, "")} history`,
    ],
  }
}
