import { AnimatedNumber } from "@matchbox/motion"
import { Btc } from "@matchbox/ui/amount"
import * as GaugeCard from "@matchbox/ui/gauge-card"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { CoinMarks, Incentives } from "../../components/coins"
import type { GaugeSummary } from "../../data/view-models"
import {
  formatCompact,
  formatVoteAmount,
  shortAddress,
  weiToWhole,
} from "../../lib/format"
import { KindIcon } from "../gauge/kind-icon"
import { gaugeTransitionName } from "../gauge/transition"

/**
 * One gauge on Vote. Votes and APY follow the local ballot: picking adds the
 * lock's votes (the count ticks up) and the APY ticks down, since the same
 * incentives spread over more votes. The whole card opens the gauge (its
 * name is the one link); the check adds it to the ballot. A pool gauge
 * names its pool type beside the pair ("BTC/MUSD CL200").
 */

export type GaugeTileProps = {
  gauge: GaugeSummary
  picked: boolean
  disabled: boolean
  /** Votes on the gauge under the local ballot, whole units. */
  votes: bigint
  /** The same votes in wei, for the compact row's exact veBTC figure. */
  votesWei: bigint
  onPickedChange: (picked: boolean) => void
  /** The gauge is opening: Vote records where its list was. */
  onOpen?: () => void
}

/** "5.88M veMEZO", "240.3554 veBTC": the compact row's votes column. */
export function compactVotes(
  votes: bigint,
  votesWei: bigint,
  unit: GaugeSummary["votesUnit"],
): string {
  return unit === "veMEZO"
    ? `${formatCompact(votes)} veMEZO`
    : formatVoteAmount(votesWei, unit)
}

/** APY in percent after the ballot's votes: the same incentives over more votes. */
export function apyAfter(
  apyBps: number,
  before: bigint,
  after: bigint,
): number {
  if (after <= 0n || before <= 0n) return apyBps / 100
  return Number((BigInt(apyBps) * before * 100n) / after) / 10_000
}

export function GaugeTile({
  gauge,
  picked,
  disabled,
  votes,
  votesWei,
  onPickedChange,
  onOpen,
}: GaugeTileProps): ReactNode {
  const listed = weiToWhole(gauge.votes)
  // Pool and validator gauges have no boost, so no band.
  const optimal =
    gauge.optimalVotes === null ? null : weiToWhole(gauge.optimalVotes)
  const rising = picked
  // Under the votes an APY needs, the draft shows none, as the signed
  // vote will (`withSignedVotes`): scaling 12,000 votes' APY to 1,000
  // would show twelve times it.
  const apyBps =
    gauge.apyMinVotes == null || votesWei < BigInt(gauge.apyMinVotes)
      ? null
      : gauge.apyBps
  // Grey after the name: a pool's type, else the boosted lock's id.
  const id =
    gauge.poolLabel !== undefined && gauge.poolLabel !== null
      ? gauge.poolLabel
      : gauge.tokenId === null || gauge.name.includes("#")
        ? null
        : `#${gauge.tokenId}`
  return (
    <GaugeCard.Root
      picked={picked}
      onPickedChange={onPickedChange}
      name={id === null ? gauge.name : `${gauge.name} ${id}`}
      disabled={disabled}
      muted={gauge.expired}
    >
      <GaugeCard.Body>
        <GaugeCard.Head
          picture={
            <GaugeCard.Picture
              picture={gauge.picture}
              transitionName={gaugeTransitionName(gauge.address)}
            />
          }
          name={
            <GaugeCard.Name>
              <Link
                to="/gauges/$address"
                params={{ address: gauge.address }}
                onClick={onOpen}
              >
                {gauge.name}
                {id === null ? null : <span className="sr-only"> {id}</span>}
              </Link>
            </GaugeCard.Name>
          }
          id={id}
          icon={<KindIcon kind={gauge.kind} />}
          state={gauge.expired ? "Expired" : null}
          subline={gauge.tagline ?? shortAddress(gauge.address)}
        />
        <GaugeCard.Votes>
          {compactVotes(votes, votesWei, gauge.votesUnit)}
        </GaugeCard.Votes>
        <GaugeCard.Figures
          apy={
            // An expired lock earns no boost: no APY to promote.
            gauge.expired ? (
              <span className="text-[17px] font-medium text-mut">No boost</span>
            ) : apyBps === null ? (
              // Incentives, but too little or too unpriced for an APY (P6).
              gauge.funded || gauge.unpriced > 0 ? (
                <span className="font-medium text-mut">n/a</span>
              ) : null
            ) : (
              <AnimatedNumber
                value={apyAfter(apyBps, listed, votes)}
                format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
                suffix="%"
              />
            )
          }
          // The arrow is the APY's: none beside "n/a" or "No boost".
          apyFalling={rising && !gauge.expired && apyBps !== null}
          coins={
            <CoinMarks symbols={gauge.incentiveTokens} surface="var(--soft)" />
          }
          incentives={
            <Incentives
              usd={gauge.incentivesUsd}
              priced={gauge.priced}
              unpriced={gauge.unpriced}
            />
          }
        />
        {gauge.kind === "vebtc" ? (
          <GaugeCard.Weight>
            <Btc value={gauge.veBtcWeight} unit="veBTC" />
          </GaugeCard.Weight>
        ) : null}
      </GaugeCard.Body>
      {gauge.expired ? (
        <GaugeCard.Note>Lock expired</GaugeCard.Note>
      ) : optimal === null ? null : (
        <GaugeCard.Band
          votes={Number(votes)}
          optimal={Number(optimal)}
          count={
            <AnimatedNumber
              value={Number(votes)}
              format={{ useGrouping: true }}
            />
          }
          of={`of ${formatCompact(optimal)} ${gauge.votesUnit}`}
          toGo={`${formatCompact(optimal > votes ? optimal - votes : 0n)} ${gauge.votesUnit} to go`}
          over={`${formatCompact(votes > optimal ? votes - optimal : 0n)} ${gauge.votesUnit} over`}
          rising={rising}
        />
      )}
    </GaugeCard.Root>
  )
}
