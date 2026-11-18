import { epochRef } from "@matchbox/api/read-models/gauges"
import {
  fromRaw,
  knownTokens,
  mergeTokenAmounts,
  priceBreakdown,
} from "@matchbox/api/read-models/money"
import type {
  GaugeEpoch,
  GaugeFunding,
  GaugeHistory,
  TokenAmount,
  VoteUnit,
} from "@matchbox/contracts/read-models"
import {
  EPOCH_SECONDS,
  EPOCH_ZERO_START,
  epochIndexFor,
} from "@matchbox/domain"
import type { BuildContext } from "./build"
import type { DepositRow, GaugeVoteRow } from "./reader"

// Every gauge's history, epoch by epoch, from the warehouse: votes as of the
// epoch's last vote event (carried forward through quiet epochs) and the
// incentives deposited for it. One `gauge-history` document per gauge, and a
// `gauge-funding` summary for consistency rankings (Stuart). Written only when
// a document changes, so a quiet week costs nothing but the epoch roll.

/** Finished epochs counted in `gauge-funding`'s `recent`. */
export const fundingWindow = 8

/** veMEZO votes veBTC and MEZO gauges; veBTC votes validators and pools. */
const unitBySource: Readonly<Record<string, VoteUnit>> = {
  BOOST_VOTER: "veMEZO",
  THIRD_PARTY_VOTER: "veMEZO",
  POOLS_VOTER: "veBTC",
  VALIDATORS_VOTER: "veBTC",
}

type GaugeTrack = {
  unit: VoteUnit | null
  /** Raw 18-decimal weight by epoch start. */
  votes: Map<number, bigint>
  /** Token amounts by epoch start. */
  deposits: Map<number, TokenAmount[]>
}

export type GaugeHistoryBuild = {
  histories: GaugeHistory[]
  funding: GaugeFunding
}

export function buildGaugeHistories(
  context: BuildContext,
  votes: readonly GaugeVoteRow[],
  deposits: readonly DepositRow[],
): GaugeHistoryBuild {
  const current = context.nowSeconds - (context.nowSeconds % EPOCH_SECONDS)
  const tracks = new Map<string, GaugeTrack>()
  const track = (gauge: string) => {
    const key = gauge.toLowerCase()
    const existing = tracks.get(key)
    if (existing !== undefined) return existing
    const created: GaugeTrack = {
      unit: null,
      votes: new Map(),
      deposits: new Map(),
    }
    tracks.set(key, created)
    return created
  }
  for (const row of votes) {
    const entry = track(row.gauge)
    entry.unit ??= unitBySource[row.source] ?? null
    entry.votes.set(Number(row.epoch_start), BigInt(row.weight))
  }
  for (const row of deposits) {
    const token = knownTokens[row.token.toLowerCase()]
    if (token === undefined) continue
    const start = Number(row.epoch_start)
    const entry = track(row.gauge)
    entry.unit ??= unitBySource[row.voter_source] ?? null
    const list = entry.deposits.get(start) ?? []
    list.push({
      token,
      amount: fromRaw(BigInt(row.amount), token.decimals),
      usd: null,
    })
    entry.deposits.set(start, list)
  }

  const histories: GaugeHistory[] = []
  const funding: GaugeFunding = {
    window: fundingWindow,
    throughEpoch: Math.max(0, epochIndexFor(current) - 1),
    gauges: {},
  }
  for (const [address, entry] of tracks) {
    const known = context.gauges.get(address)
    const unit: VoteUnit =
      known === undefined
        ? (entry.unit ?? "veMEZO")
        : known.kind === "vebtc" || known.kind === "mezo"
          ? "veMEZO"
          : "veBTC"
    const starts = [...entry.votes.keys(), ...entry.deposits.keys()]
    const first = Math.max(EPOCH_ZERO_START, Math.min(...starts))
    const epochs: GaugeEpoch[] = []
    let weight = 0n
    for (let start = first; start <= current; start += EPOCH_SECONDS) {
      weight = entry.votes.get(start) ?? weight
      const amounts = entry.deposits.get(start) ?? []
      epochs.push({
        epoch: epochRef(start),
        votes: fromRaw(weight, 18),
        incentives: priceBreakdown(
          mergeTokenAmounts([amounts]),
          context.prices,
        ),
      })
    }
    histories.push({ address, votesUnit: unit, epochs })

    // Consistency over finished epochs only.
    const finished = epochs.filter((epoch) => epoch.epoch.start < current)
    const funded = finished.map((epoch) => epoch.incentives.tokens.length > 0)
    const total = funded.filter(Boolean).length
    if (total === 0) continue
    let streak = 0
    for (
      let index = funded.length - 1;
      index >= 0 && funded[index];
      index -= 1
    ) {
      streak += 1
    }
    funding.gauges[address] = {
      recent: funded.slice(-fundingWindow).filter(Boolean).length,
      total,
      streak,
    }
  }
  return { histories, funding }
}
