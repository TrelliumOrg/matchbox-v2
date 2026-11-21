import {
  APY_MIN_INCENTIVES_MICRO_USD,
  APY_MIN_VOTES_WEI,
  type ApyVoteUnit,
  apyFloorMissed,
} from "@matchbox/domain/funding"
import {
  compareDensity,
  priceTarget,
  targetApyBps,
} from "@matchbox/domain/voteMath"
import type { Fact, UiBlock, VoteBranch } from "@matchbox/stuart-ui/contract"
import {
  clipName,
  displayBlock,
  displayBps,
  displayToken,
  displayUsd,
  tokenAmount,
  usd6,
} from "../format"
import { makeFact, type ToolOutcome, traceItem } from "../outcome"
import { priceMicroUsd } from "../providers/prices"
import { assetFor } from "../providers/voting"
import { epochNumberFor, OPTIMIZER_CALC_VERSION } from "../versions"
import {
  calcEvidence,
  domainEvidence,
  domainLabel,
  errorOutcome,
  FUNDED_WINDOW,
  fundedForRows,
  fundedShareFacts,
  incentiveTokenAddresses,
  plainOutcome,
  priceEvidence,
  queryFollowup,
  snapshotLabel,
  sourceCluster,
  targetKind,
  targetPicture,
  unpricedOnlyNote,
  unpricedPartNote,
} from "./common"
import { emptyRanking, withFacts } from "./pricingGaps"
import type { ToolContext } from "./tool"

/** "1 gauge with under $1.00 of incentives is not ranked." */
function belowFloorNote(input: {
  scope: ToolContext["scope"]
  count: number
  floor: "incentives" | "votes"
  unit: ApyVoteUnit
  evidenceRef: string
}): { facts: Fact[]; text: string } | null {
  if (input.count === 0) return null
  const count = makeFact({
    scope: input.scope,
    key: `below_floor.${input.floor}`,
    label:
      input.floor === "incentives"
        ? "Voted targets under the APY floor of incentives"
        : "Voted targets under the APY floor of votes",
    value: { kind: "count", count: input.count },
    display: String(input.count),
    status: "live",
    evidenceRefs: [input.evidenceRef],
  })
  const votes = tokenAmount(APY_MIN_VOTES_WEI[input.unit], 18, input.unit)
  const floor =
    input.floor === "incentives"
      ? makeFact({
          scope: input.scope,
          key: "apy_floor.incentives",
          label: "APY floor, incentives",
          value: { kind: "usd", usd: usd6(APY_MIN_INCENTIVES_MICRO_USD) },
          display: displayUsd(APY_MIN_INCENTIVES_MICRO_USD),
          status: "exact",
          evidenceRefs: [input.evidenceRef],
        })
      : makeFact({
          scope: input.scope,
          key: "apy_floor.votes",
          label: "APY floor, votes",
          value: { kind: "token", amount: votes },
          display: displayToken(votes),
          status: "exact",
          evidenceRefs: [input.evidenceRef],
        })
  const one = input.count === 1
  return {
    facts: [count, floor],
    text: `${count.display} ${one ? "gauge" : "gauges"} with under ${floor.display} of ${input.floor} ${one ? "is" : "are"} not ranked.`,
  }
}

/**
 * "Which gauge pays the most": live targets by incentives per vote (the Vote
 * page's APY ↓ sort). Not the wallet's optimum: that is optimize_votes.
 */
export async function rankByApy(
  context: ToolContext,
  branch: VoteBranch,
): Promise<ToolOutcome> {
  const tool = "rank_gauges"
  const { scope } = context
  const asset = assetFor(branch)
  const title = "Highest APY"
  try {
    const [domain, prices] = await Promise.all([
      context.providers.votingDomain(branch),
      context.providers.prices(),
    ])
    const assetPrice = priceMicroUsd(
      branch === "boost" ? prices.mezo.priceUsd : prices.btc.priceUsd,
    )
    const live = domain.targets
      .filter((target) => target.isAlive)
      .map((target) => priceTarget(target, prices, 0n))
    // Unpriced incentives are worth nothing here: a target ranks only on
    // what Matchbox can price by token address.
    const priced = live.filter((entry) => entry.incentiveMicroUsd > 0n)
    const voted = priced.filter((entry) => entry.target.weight > 0n)
    const unvoted = priced.length - voted.length
    // Pro's APY floors (`@matchbox/domain/funding`): no APY on under a
    // dollar of incentives or a handful of votes, so "3,690% on $0.28"
    // never leads Stuart's ranking while Pro's page shows "n/a".
    const below = { incentives: 0, votes: 0 }
    const ranked = voted.filter((entry) => {
      const missed = apyFloorMissed({
        incentivesMicro: entry.incentiveMicroUsd,
        votesWei: entry.target.weight,
        unit: asset,
      })
      if (missed !== null) below[missed] += 1
      return missed === null
    })
    const ordered = ranked.sort(compareDensity).slice(0, 10)
    const funded = await fundedForRows(
      context,
      domain,
      ordered.map((entry) => entry.target),
    )
    const evidence = [
      domainEvidence(scope, domain),
      priceEvidence(scope, prices, branch === "boost" ? "mezo" : "both"),
      calcEvidence(
        scope,
        OPTIMIZER_CALC_VERSION,
        "Incentives per vote, extrapolated APY",
        domain.fetchedAt,
      ),
    ]
    const refs = evidence.map((item) => item.id)
    const [domainRef, priceRef, calcRef] = refs
    const floorNotes = (["incentives", "votes"] as const).flatMap((floor) => {
      const note = belowFloorNote({
        scope,
        count: below[floor],
        floor,
        unit: asset,
        evidenceRef: calcRef ?? "",
      })
      return note === null ? [] : [note]
    })
    const floorText = floorNotes.map((note) => note.text).join(" ")
    const floorFacts = floorNotes.flatMap((note) => note.facts)
    const first = ordered[0]
    if (!first) {
      const empty = emptyRanking({
        scope,
        lead:
          floorNotes.length === 0
            ? "No live target has priced incentives and votes this epoch."
            : `No live target has enough priced incentives and votes for an APY this epoch. ${floorText}`,
        priced: live,
        prices,
        evidenceRef: priceRef ?? "",
      })
      return withFacts(
        plainOutcome({
          scope,
          tool,
          intent: "rank_gauges",
          status: "empty",
          title,
          templateId: "rank_gauges.apy_empty.v1",
          text: empty.text,
          kind: "empty",
          traceLabel: "Ranked targets",
          evidence,
        }),
        [...floorFacts, ...empty.facts],
      )
    }
    const apyOf = (entry: typeof first) =>
      targetApyBps({
        incentiveMicroUsd: entry.incentiveMicroUsd,
        weight: entry.target.weight,
        assetPriceMicroUsd: assetPrice,
      })
    const name = clipName(first.target.name, 32)
    const firstApy = apyOf(first)
    const facts: Fact[] = [
      makeFact({
        scope,
        key: "name.0",
        label: "Target",
        value: { kind: "text", text: name },
        display: name,
        status: "live",
        evidenceRefs: [domainRef ?? ""],
      }),
      makeFact({
        scope,
        key: "deposited.0",
        label: "Incentives this epoch",
        value: { kind: "usd", usd: usd6(first.incentiveMicroUsd) },
        display: displayUsd(first.incentiveMicroUsd),
        status: first.pricingStatus === "complete" ? "live" : "estimated",
        evidenceRefs: [domainRef ?? "", priceRef ?? ""],
      }),
    ]
    const [nameFact, incentivesFact] = facts
    const share = fundedShareFacts({
      scope,
      funded: priced.length,
      total: domain.targets.length,
      evidenceRef: domainRef ?? "",
    })
    facts.push(...share.facts, ...floorFacts)
    const floorSuffix = floorText === "" ? "" : ` ${floorText}`
    let text: string
    if (firstApy !== null) {
      const apyFact = makeFact({
        scope,
        key: "apy.0",
        label: "APY (extrapolated)",
        value: { kind: "bps", bps: firstApy },
        display: displayBps(firstApy),
        status: "estimated",
        evidenceRefs: [calcRef ?? "", priceRef ?? ""],
      })
      facts.push(apyFact)
      text = `${domainLabel(domain)}: ${nameFact?.display} pays the most per vote this epoch, APY ${apyFact.display} on ${incentivesFact?.display} incentives. ${share.text}${floorSuffix}`
    } else {
      const weight = tokenAmount(first.target.weight, 18, asset)
      const weightFact = makeFact({
        scope,
        key: "votes.0",
        label: "Current votes",
        value: { kind: "token", amount: weight },
        display: displayToken(weight),
        status: "live",
        evidenceRefs: [domainRef ?? ""],
      })
      facts.push(weightFact)
      text = `${domainLabel(domain)}: ${nameFact?.display} pays the most per vote this epoch, ${incentivesFact?.display} incentives on ${weightFact.display}. ${share.text}${floorSuffix}`
    }
    const whyItems: Array<{ text: string; factRefs: string[] }> = [
      {
        text: "APY extrapolates this epoch's priced incentives at current votes. Your own return also depends on how much you add.",
        factRefs: [],
      },
    ]
    const partNote = unpricedPartNote({
      scope,
      key: "unpriced.0",
      entry: first,
      name,
      evidenceRef: priceRef ?? "",
    })
    if (partNote) {
      facts.push(partNote.fact)
      whyItems.push({ text: partNote.text, factRefs: [partNote.fact.id] })
    }
    const onlyNote = unpricedOnlyNote({
      scope,
      priced: live,
      evidenceRef: priceRef ?? "",
    })
    if (onlyNote) {
      facts.push(onlyNote.fact)
      whyItems.push({ text: onlyNote.text, factRefs: [onlyNote.fact.id] })
    }
    if (unvoted > 0) {
      const unvotedFact = makeFact({
        scope,
        key: "unvoted",
        label: "Funded targets with no votes",
        value: { kind: "count", count: unvoted },
        display: `${unvoted}`,
        status: "live",
        evidenceRefs: [domainRef ?? ""],
      })
      facts.push(unvotedFact)
      whyItems.push({
        text: `${unvotedFact.display} funded targets have no votes yet, so their APY is undefined and they are not ranked.`,
        factRefs: [unvotedFact.id],
      })
    }
    const blocks: UiBlock[] = [
      {
        type: "gauge_ranking",
        version: 1,
        id: scope.id("b.ranking"),
        evidenceRefs: refs,
        objective: "highest_apy",
        domain: {
          branch,
          governanceAsset: asset,
          votingContract: domain.voter,
        },
        epoch: {
          number: epochNumberFor(domain.epochStart),
          start: domain.epochStart.toString(),
          endsAt: new Date(Number(domain.epochNext) * 1000).toISOString(),
        },
        snapshotBlock: domain.blockNumber.toString(),
        calculationVersion: OPTIMIZER_CALC_VERSION,
        consistencyWindow: null,
        rows: ordered.map((entry) => ({
          targetId: entry.target.targetAddress.toLowerCase(),
          targetAddress: entry.target.targetAddress,
          name: entry.target.name.slice(0, 80),
          nameSource: entry.target.nameSource,
          tokenId: entry.target.tokenId,
          allocationBps: null,
          projectedUsd: null,
          projectedNative: null,
          depositedUsd: usd6(entry.incentiveMicroUsd),
          pricingStatus: entry.pricingStatus,
          fundedEpochs: funded
            ? (funded.get(entry.target.targetAddress.toLowerCase()) ?? 0)
            : null,
          observedEpochs: funded ? FUNDED_WINDOW : null,
          competingWeight: entry.target.weight.toString(),
          apyBps: apyOf(entry),
          picture: targetPicture(domain, entry.target),
          kind: targetKind(domain, entry.target),
          votesUnit: asset,
          incentiveTokens: incentiveTokenAddresses(entry.target),
        })),
        proposalId: null,
        actions: ["open_vote_page"],
      },
      sourceCluster(scope, evidence),
    ]
    return {
      tool,
      intent: "rank_gauges",
      status: "ok",
      title,
      snapshot: {
        blockNumber: domain.blockNumber,
        epoch: epochNumberFor(domain.epochStart),
        label: snapshotLabel({
          blockNumber: domain.blockNumber,
          epochStart: domain.epochStart,
        }),
      },
      answer: {
        kind: "result",
        templateId:
          firstApy === null ? "rank_gauges.apy_votes.v1" : "rank_gauges.apy.v1",
        text,
        factRefs: facts.map((fact) => fact.id),
      },
      why: { templateId: "rank_gauges.apy.why.v1", items: whyItems },
      facts,
      evidence,
      blocks,
      proposals: [],
      followups: [
        queryFollowup(
          scope,
          "optimize",
          "Best return for me",
          "optimize my votes",
        ),
      ],
      trace: [
        traceItem({
          scope,
          key: "rank",
          label: `Ranked ${ranked.length} voted targets by APY at block ${displayBlock(domain.blockNumber)}`,
          tool,
        }),
      ],
      model: {
        rows: ordered.map((entry) => {
          const apy = apyOf(entry)
          return {
            name: entry.target.name,
            incentives: displayUsd(entry.incentiveMicroUsd),
            apy: apy === null ? null : displayBps(apy),
            votes: displayToken(tokenAmount(entry.target.weight, 18, asset)),
          }
        }),
        notes: [],
      },
      surface: "canvas",
      checked: [`${domain.targets.length} gauges`, "prices"],
    }
  } catch {
    return errorOutcome({ scope, tool, intent: "rank_gauges", title })
  }
}
