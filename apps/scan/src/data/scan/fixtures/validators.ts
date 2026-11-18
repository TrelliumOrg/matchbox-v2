import type {
  GaugeCard,
  GaugeDetails,
  GaugeRef,
} from "@matchbox/contracts/read-models"
import {
  demoEpoch,
  demoGaugeDetails,
  demoKindCards,
  demoTokens,
} from "@matchbox/contracts/read-models/fixtures"
import type {
  ScanLockVoteItem,
  ScanValidatorRow,
} from "@matchbox/contracts/scan"
import { epochIndexFor } from "@matchbox/domain/epoch"
import { unitsToDecimal } from "@matchbox/domain/format"
import {
  aggregateMeta,
  type FixtureRoute,
  type FixtureScenario,
  fakeAddress,
  ok,
  vebtc,
} from "./shared"
import { labelsFor } from "./world"

/**
 * `/validators` (blocks proposed per validator per day, matched to the
 * set), and what the validator gauges need beyond the demo directory: two
 * more validator gauges, one of whose operators proposed a recorded block.
 * The demo set's one validator (Northfield Nodes) has a made-up operator.
 *
 * - Harbor Stake: its operator is the `miner` of recorded block 13,118,576
 *   (blockscout/fixtures/blocks.json), so the page matches a proposer.
 * - Tallow & Co: left the PoA set (no operator, gauge not alive).
 * - The `miner` of recorded block 13,118,577 belongs to no validator here:
 *   the page shows it as a proposer outside the set.
 *
 * voting.ts lists both cards in the directory, their details on the
 * profiles and Harbor Stake in the validators' epoch rankings. Each
 * validator gauge's voters, deposits and profile history are built from
 * its epoch rows (below), so they add up to the same figures.
 */

/** Proposer of recorded block 13,118,576, an operator in the set. */
export const matchedProposer = "0x41b1a7f633eb9dac1fc19adae41aa7562c620971"

/** Proposer of recorded block 13,118,577, in no validator's gauge. */
export const unmatchedProposer = "0xd056656123bea72fe9139bac0539b8f53d850247"

function validatorRef(
  address: string,
  name: string,
  initials: string,
  color: string,
): GaugeRef {
  return {
    address,
    voter: "validators",
    kind: "validator",
    name,
    vebtcTokenId: null,
    picture: { type: "initials", text: initials },
    poolType: null,
    color,
    tickSpacing: null,
    coin: null,
  }
}

const harborStakeGauge = fakeAddress("4a5b0e")
const tallowGauge = fakeAddress("7a110e")

export const validatorDetails = {
  harborStake: {
    kind: "validator",
    operator: matchedProposer,
    status: "active",
    moniker: "Harbor Stake",
    beneficiary: fakeAddress("4a5b0f"),
    votingPower: null,
    commission: null,
  },
  tallow: {
    kind: "validator",
    operator: null,
    status: "left",
    moniker: "Tallow & Co",
    beneficiary: null,
    votingPower: null,
    commission: null,
  },
} satisfies Record<string, GaugeDetails>

export const validatorCards = {
  harborStake: {
    gauge: validatorRef(harborStakeGauge, "Harbor Stake", "HS", "#2F6F8F"),
    votesUnit: "veBTC",
    tagline: null,
    isAlive: true,
    apy: "3.20",
    incentives: {
      usd: "120.00",
      tokens: [{ token: demoTokens.mezo, amount: "652.17", usd: "120.00" }],
    },
    vebtcWeight: null,
    votes: "27.6",
    optimalVotes: null,
    boost: null,
    meta: {
      kind: "validator",
      operator: validatorDetails.harborStake.operator,
      status: validatorDetails.harborStake.status,
    },
  },
  tallow: {
    gauge: validatorRef(tallowGauge, "Tallow & Co", "TC", "#8D6E63"),
    votesUnit: "veBTC",
    tagline: null,
    isAlive: false,
    apy: null,
    incentives: { usd: "0", tokens: [] },
    vebtcWeight: null,
    votes: "0",
    optimalVotes: null,
    boost: null,
    meta: { kind: "validator", operator: null, status: "left" },
  },
} satisfies Record<string, GaugeCard>

/** Harbor Stake in the validators' epoch rankings (voting.ts rankedGauges). */
export const validatorRanked = {
  gauge: harborStakeGauge,
  weight: "27.6",
  voters: 5,
  incentive: "652.17",
  source: "VALIDATORS_VOTER",
}

/** A validator gauge's epoch row, as voting.ts ranks it. */
export type ValidatorEpochRow = {
  epoch_start: number
  gauge: string
  vote_weight: string
  voters: number
  incentives: Record<string, string>
}

/**
 * The veBTC locks behind a validator gauge's epoch row: `voters` votes,
 * largest first, adding up to its weight exactly. Lock ids run from
 * `firstTokenId` (they are not in the locks list).
 */
export function validatorLockVotes(
  row: ValidatorEpochRow,
  firstTokenId: number,
): ScanLockVoteItem[] {
  const count = row.voters
  const total = BigInt(row.vote_weight)
  const parts = BigInt((count * (count + 1)) / 2)
  const weights = Array.from(
    { length: count },
    (_, index) => (total * BigInt(count - index)) / parts,
  )
  const rest = total - weights.reduce((sum, weight) => sum + weight, 0n)
  if (weights[0] !== undefined) weights[0] += rest
  return weights.map((weight, index) => ({
    epoch_start: row.epoch_start,
    gauge: row.gauge,
    escrow: vebtc,
    token_id: String(firstTokenId + index),
    source: "VALIDATORS_VOTER",
    pool: null,
    weight: weight.toString(),
    voted_at: row.epoch_start + 3_700 + index,
    carried: false,
  }))
}

/**
 * A validator gauge's profile history from its epoch rows, oldest first:
 * votes in whole veBTC, incentives as the card prices them today.
 */
export function validatorHistory(
  rows: readonly ValidatorEpochRow[],
  card: GaugeCard,
) {
  return [...rows]
    .sort((a, b) => a.epoch_start - b.epoch_start)
    .map((row) => ({
      epoch: demoEpoch(epochIndexFor(row.epoch_start)),
      votes: unitsToDecimal(row.vote_weight, 18),
      incentives: card.incentives,
    }))
}

// -- /validators ------------------------------------------------------------

/** The day the counts are for, and the day of the running totals' read. */
export const validatorsDay = "2026-11-08"
const totalsDay = "2026-11-09"

const northfield = {
  address: (demoGaugeDetails.northfieldNodes.operator ?? "").toLowerCase(),
  gauge: demoKindCards.northfieldNodes.gauge.address.toLowerCase(),
  name: demoKindCards.northfieldNodes.gauge.name,
}

/** Blocks on `validatorsDay` and every block so far, per proposer. */
const proposed = [
  {
    address: northfield.address,
    name: northfield.name,
    gauge: northfield.gauge,
    blocks: "11512",
    total: "6481203",
  },
  {
    address: matchedProposer,
    name: validatorCards.harborStake.gauge.name,
    gauge: validatorCards.harborStake.gauge.address,
    blocks: "10944",
    total: "6112418",
  },
  {
    address: unmatchedProposer,
    name: null,
    gauge: null,
    blocks: "240",
    total: "120544",
  },
]

/**
 * The route's answer: counts once the jobs Worker has two daily reads;
 * in the `filling` scenario only the first read (totals, no day's count),
 * so `available` is false with the API's reason.
 */
export function validatorsAnswer(scenario: FixtureScenario) {
  const counted = scenario !== "filling"
  const dayTotal = proposed.reduce((sum, row) => sum + BigInt(row.blocks), 0n)
  // As the API from b07ccde: shares are of every block the chain produced
  // that day; the daily read of 50 blocks misses some proposers, so a
  // tenth of the day is no listed validator's.
  const blocksInDay = dayTotal + dayTotal / 10n
  const validators: ScanValidatorRow[] = proposed
    .map((row) => ({
      address: row.address,
      name: row.name,
      label: labelsFor([row.address])[row.address]?.name ?? null,
      operator: row.gauge === null ? null : row.address,
      gauge: row.gauge,
      pool_status: row.gauge === null ? null : ("active" as const),
      blocks: counted ? row.blocks : null,
      share_bps: counted
        ? Number((BigInt(row.blocks) * 10_000n) / blocksInDay)
        : null,
      blocks_total: { value: row.total, day: totalsDay },
    }))
    .sort((a, b) => (a.address < b.address ? -1 : 1))
  return {
    data: {
      available: counted,
      reason: counted
        ? null
        : "Not available yet: a day's count needs two daily reads of each validator's counter.",
      day: counted ? validatorsDay : null,
      day_total: counted ? dayTotal.toString() : null,
      shares_complete: counted,
      share_of: counted ? ("all_blocks" as const) : null,
      blocks_in_day: counted ? blocksInDay.toString() : null,
      unattributed_blocks: counted ? (blocksInDay - dayTotal).toString() : null,
      missing_counts: [],
      validators,
      pool_without_operator: [
        {
          gauge: validatorCards.tallow.gauge.address,
          name: validatorCards.tallow.gauge.name,
          pool_status: "left" as const,
        },
      ],
    },
    meta: aggregateMeta(scenario, counted),
  }
}

/** The fixtures' validators routes. */
export const validatorsFixtures: FixtureRoute[] = [
  {
    pattern: /^validators$/,
    answer: (_match, _query, scenario) => ok(validatorsAnswer(scenario)),
  },
]
