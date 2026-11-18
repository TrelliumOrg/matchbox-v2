import { TokenIcon } from "@matchbox/token-icons"
import * as GaugeCard from "@matchbox/ui/gauge-card"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import * as Stepper from "@matchbox/ui/stepper"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { Usd } from "../../components/money"
import type { LockKind, Voter } from "../../data/view-models"
import { formatToken, formatUsd } from "../../lib/format"
import { gaugeName } from "../../lib/gauge-name"
import { useViewer } from "../../lib/viewer"
import { openTx, txIntent } from "../../tx/tx-store"
import { openWallet, walletIntent } from "../../wallet/wallet-store"
import { KindIcon } from "../gauge/kind-icon"
import { escrowUnit, gaugeKinds } from "../gauge/kinds"
import {
  allocated,
  type Ballot,
  microToUsd,
  signable,
  totalBps,
} from "./ballot"
import { type BallotPanelProps, ballotTitle, ballotVotes } from "./ballot-panel"
import { OptimizeButton } from "./optimize-button"

/** "12.5%" from basis points. */
function percentOf(bps: number): string {
  const value = bps / 100
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`
}

/** Allocated against 100%: "8% left" under, red "12% over" past it. */
export function bandLabel(used: number): { over: boolean; text: string } {
  const left = totalBps - used
  if (left < 0) return { over: true, text: `${percentOf(-left)} over` }
  return {
    over: false,
    text: left === 0 ? "0 left" : `${percentOf(left)} left`,
  }
}

export function AllocationBand({ ballot }: { ballot: Ballot }): ReactNode {
  const used = allocated(ballot)
  const { over, text } = bandLabel(used)
  return (
    <div
      className={`relative mt-4 flex h-10 items-center justify-between overflow-hidden rounded-[14px] px-3.5 text-sm ${over ? "bg-neg-soft text-neg" : "bg-soft2 text-ink2"}`}
    >
      <span
        aria-hidden="true"
        data-mbx-motion=""
        className={`absolute inset-0 origin-left transition-transform duration-[400ms] ease-roll ${over ? "bg-transparent" : "bg-band-acc"}`}
        style={{ transform: `scaleX(${Math.min(used, totalBps) / totalBps})` }}
      />
      <span className="relative">
        <b className={`font-[650] ${over ? "text-neg" : "text-ink"}`}>
          {percentOf(used)}
        </b>{" "}
        allocated
      </span>
      <span role="status" className="relative font-semibold">
        {text}
      </span>
    </div>
  )
}

export function NoLock({
  voter,
  escrow,
}: {
  voter: Voter | null
  escrow: LockKind
}): ReactNode {
  const viewer = useViewer()
  return (
    <>
      <p className="text-[15px] text-sec">Voting power</p>
      <p className="mt-0.5 text-[36px] font-[650] tracking-[-0.025em] text-mut">
        0
      </p>
      <div className="mt-4 flex h-10 items-center justify-between rounded-[14px] bg-soft2 px-3.5 text-sm text-sec">
        <span>No {escrowUnit[escrow]} lock picked</span>
        <span>0 left</span>
      </div>
      {voter?.wallet == null ? null : (
        <dl className="mt-4 flex flex-col gap-3 text-[15px] tabular-nums">
          {[voter.wallet.btc, voter.wallet.mezo].map((token) => (
            <div key={token.symbol} className="flex items-center gap-2.5">
              <TokenIcon ticker={token.symbol} size={22} />
              <dt className="text-ink">
                {token.symbol === "BTC" ? "Bitcoin" : "Mezo"}
              </dt>
              <dd className="ml-auto text-sec">
                {formatToken(token.amount, token.symbol)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <PillButton.Root
        size="lg"
        className="mt-5"
        {...(voter === null
          ? { ...walletIntent, onClick: openWallet }
          : {
              ...txIntent,
              onClick: () => openTx(viewer, { flow: "new-lock", kind: escrow }),
            })}
      >
        {voter === null ? (
          "Connect wallet"
        ) : (
          <>
            <Glyph shape={shapes.plus} size={18} strokeWidth={2.4} />
            New lock
          </>
        )}
      </PillButton.Root>
    </>
  )
}

/** The 336px ballot rail from 1280 up (`YfjCVNBQNy`). Hidden, and never loaded, below. */
export function BallotRail(props: BallotPanelProps): ReactNode {
  const { voter, ballot, gauges, epoch, escrow } = props
  const picks = [...ballot.entries()]
  const none = props.locks.length === 0
  return (
    <aside
      aria-label={ballotTitle(epoch, props.locks.length)}
      className="overflow-hidden rounded-[24px] bg-soft tabular-nums shadow-[inset_0_0_0_1px_var(--edge)]"
    >
      <div
        className={`flex h-[54px] items-center justify-between gap-3 px-5 text-[15px] font-[650] ${escrow === "vemezo" ? "bg-mezo text-on-mezo" : "bg-acc text-on-acc"}`}
      >
        <span className="flex items-center gap-2.5 whitespace-nowrap">
          <span className="block rounded-full shadow-[0_0_0_2px_#fff]">
            <TokenIcon
              ticker={escrow === "vemezo" ? "MEZO" : "BTC"}
              size={22}
            />
          </span>
          {ballotTitle(epoch, props.locks.length)}
        </span>
        <span className="truncate font-semibold opacity-90">
          {ballotVotes(props.power, escrow)}
        </span>
      </div>
      <div className="p-5">
        {none ? (
          <NoLock voter={voter} escrow={escrow} />
        ) : (
          <>
            <p className="text-[15px] text-sec">Projected</p>
            <p className="mt-0.5 text-[36px] leading-tight font-[650] tracking-[-0.025em]">
              <Usd
                value={microToUsd(props.projectedMicro)}
                style="cents"
                countUp="ballot-projected"
              />
            </p>
            <AllocationBand ballot={ballot} />
            {/* Zho, 12 Nov 2026: one shared 100% read as a bug. It was. */}
            <p className="mt-2.5 text-[13.5px] text-sec">
              {props.keeps === null
                ? `${gaugeKinds[props.kind].label} only`
                : `${gaugeKinds[props.kind].label} only. Votes on ${gaugeKinds[props.keeps].label} stay.`}
            </p>
            <ul data-flip-list="" className="mt-[18px] flex flex-col gap-3">
              {picks.map(([id, bps]) => {
                const gauge = gauges.get(id)
                if (gauge === undefined) return null
                return (
                  <li
                    key={id}
                    data-flip={id}
                    className="flex items-center gap-3"
                  >
                    <GaugeCard.Picture picture={gauge.picture} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-[15px] font-semibold">
                        <span className="truncate">{gaugeName(gauge)}</span>
                        <KindIcon kind={gauge.kind} size={14} />
                      </p>
                      <p className="text-[13.5px] text-sec">
                        ${microToUsd(props.perGaugeMicro.get(id) ?? 0n)}
                      </p>
                    </div>
                    <Stepper.Root
                      label={`Share for ${gaugeName(gauge)}`}
                      value={bps / 100}
                      onValueChange={(percent) =>
                        props.onShare(id, Math.round(percent * 100))
                      }
                      surface="raised"
                    />
                  </li>
                )
              })}
            </ul>
            {props.warning === null ? null : (
              <p
                role="status"
                className="mt-4 rounded-[14px] bg-soft2 px-3.5 py-2.5 text-[14px] text-ink2"
              >
                {props.warning}
              </p>
            )}
            {props.note === null ? null : (
              <p
                role="status"
                className="mt-4 flex items-center gap-2 text-[14px] text-ink2"
              >
                <Glyph shape={shapes.check} size={15} strokeWidth={2.2} />
                {props.note}
              </p>
            )}
            <div className="mt-5">
              <OptimizeButton
                state={props.optimize}
                onOptimize={props.onOptimize}
                onUndo={props.onUndo}
                compact={false}
              />
            </div>
            <PillButton.Root
              size="lg"
              className="mt-2.5 h-[50px]"
              {...props.reviewIntent}
              disabled={!signable(ballot)}
              onClick={props.onReview}
            >
              {props.primary}
            </PillButton.Root>
            <p className="mt-3.5 text-center">
              <button
                type="button"
                onClick={props.onSplitEvenly}
                className="cursor-pointer rounded-sm text-[14.5px] font-semibold text-ink2 underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-ink"
              >
                Split evenly
              </button>
            </p>
          </>
        )}
        {props.others.map((other) => (
          <Link
            key={other.kind}
            to="/vote/$type"
            params={{ type: other.kind }}
            resetScroll={false}
            className="mt-5 flex items-center justify-between rounded-[16px] bg-soft2 px-3.5 py-3 text-[14.5px] outline-none focus-visible:outline-2 focus-visible:outline-ink"
          >
            <span>
              <b className="block font-semibold">
                {gaugeKinds[other.kind].label}
              </b>
              <span className="text-sec">
                {other.locks === 1 ? "1 lock" : `${other.locks} locks`},{" "}
                {other.picks} picked
              </span>
            </span>
            <span className="font-semibold">
              {formatUsd(microToUsd(other.projectedMicro), "cents")}
            </span>
          </Link>
        ))}
      </div>
    </aside>
  )
}
