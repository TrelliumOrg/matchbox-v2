import * as PillButton from "@matchbox/ui/pill-button"
import type { ReactNode } from "react"
import { island } from "../../components/island"
import { Usd } from "../../components/money"
import type {
  GaugeKind,
  GaugeSummary,
  Lock,
  LockKind,
  Voter,
} from "../../data/view-models"
import { formatVoteAmount } from "../../lib/format"
import { escrowUnit } from "../gauge/kinds"
import { type Ballot, microToUsd, signable } from "./ballot"

/**
 * The ballot: a 336px sticky rail with a MEZO tab from 1280 up (`YfjCVNBQNy`),
 * a bottom bar below (`ABcm2yOumi`, `x9pE1TDtMD`). Projected dollars, the
 * allocation band, picked rows with steppers, Optimize (one click, never
 * Stuart) and Review and sign.
 */

export type OptimizeState =
  | { kind: "idle" }
  | { kind: "ready"; gainMicro: bigint }
  | {
      kind: "optimized"
      /**
       * Set when Optimize was pressed here and the ballot is still the one
       * it gave: what the ballot projected before and what Optimize added.
       * Null when the ballot already was the best one. Data only: the way
       * back is the panel's `onUndo`, a handler, so a section that keeps
       * this object between renders never keeps an old Undo with it.
       */
      applied: { wasMicro: bigint; gainMicro: bigint } | null
    }

/** Another gauge type's ballot, when it was changed here (a link each). */
export type OtherBallot = {
  escrow: LockKind
  kind: GaugeKind
  locks: number
  picks: number
  projectedMicro: bigint
}

export type BallotPanelProps = {
  epoch: number
  voter: Voter | null
  escrow: LockKind
  /** The gauge type this ballot votes: one voter, its own 100%. */
  kind: GaugeKind
  /** The locks' other type, when they hold votes there that this keeps. */
  keeps: GaugeKind | null
  /** The selected locks that vote this ballot, the same split each. */
  locks: readonly Lock[]
  /** Their summed voting power, wei. */
  power: bigint
  /** Set when an expired gauge is picked. */
  warning: string | null
  others: readonly OtherBallot[]
  gauges: ReadonlyMap<string, GaugeSummary>
  ballot: Ballot
  projectedMicro: bigint
  perGaugeMicro: ReadonlyMap<string, bigint>
  optimize: OptimizeState
  onShare: (address: string, bps: number) => void
  onOptimize: () => void
  /** Puts back the ballot Optimize replaced. */
  onUndo: () => void
  onSplitEvenly: () => void
  /**
   * "Review and sign", "Save for Epoch 48" when every lock voted, or
   * "Viewing only" on someone else's wallet.
   */
  primary: string
  /** Someone else's wallet: the primary button stays disabled. */
  readOnly: boolean
  /** A saved split's state: "Changes saved for Epoch 48", "Saved split". */
  note: string | null
  /** Opens Review vote (or Review changes). */
  onReview: () => void
  /** Loads the sheets on hover or focus of Review and sign. */
  reviewIntent: {
    onPointerEnter: () => unknown
    onFocus: () => unknown
    onTouchStart: () => unknown
  }
}

const BarOptimize = island(
  "ballot-bar-optimize",
  () => import("./optimize-button").then((module) => module.OptimizeButton),
  // The button's own box (44 by 188, see optimize-button), held by the
  // wrapper. The optimizer answers after first paint, sometimes before
  // this section has hydrated; React then renders it from an empty
  // fallback for a frame, and without a held box the bar's right-hand
  // group collapsed and came back (0.0034 on 2 of 5 loads of the live
  // page, 13 Nov 2026).
  "hidden h-11 min-w-[188px] md:block",
)

const BarMark = island(
  "ballot-bar-mark",
  () => import("./ballot-mark").then((module) => module.BallotMark),
  "hidden lg:block",
)

/** "Epoch 47, 2 locks" or "Epoch 47 ballot". */
export function ballotTitle(epoch: number, locks: number): string {
  return locks > 1 ? `Epoch ${epoch}, ${locks} locks` : `Epoch ${epoch} ballot`
}

/** "22,582 veMEZO" */
export function ballotVotes(power: bigint, escrow: LockKind): string {
  return formatVoteAmount(power, escrowUnit[escrow])
}

/** "Review and sign, 14 signatures" to "Review and sign". */
export function shortPrimary(primary: string): string {
  return primary.replace(/, \d+ signatures$/, "")
}

/**
 * Docked at `--dock` (see styles.css): on a phone 11px over the tab bar,
 * which grows by the system's bottom inset. A flat 76px let the tab bar
 * cover the lower half of Review and sign on Android Chrome (14 Nov 2026).
 *
 * At 360px there is room for little else beside Review and sign: a phone
 * drops the epoch beside "2 locks", and Projected gives way first, cut
 * short, so the button always fits whole. With one lock ("Epoch 47") the
 * label must still show whole, with a few pixels to spare: text runs a
 * pixel wider on some systems, and a fit with none to spare cut it there.
 */
export function BallotBar(props: BallotPanelProps): ReactNode {
  const { ballot, gauges, epoch } = props
  if (props.locks.length === 0) return null
  return (
    <section
      data-ballot-bar=""
      aria-label={`Epoch ${epoch} ballot`}
      className="fixed inset-x-3 bottom-(--dock) z-30 flex h-[76px] items-center overflow-hidden rounded-[24px] bg-soft tabular-nums shadow-[inset_0_0_0_1px_var(--edge),var(--lift)] md:right-[100px] md:left-[112px] lg:left-[120px] xl:left-[340px] min-[100rem]:hidden"
    >
      <div
        className={`flex h-full flex-none flex-col justify-center px-3 sm:px-4 md:px-[18px] ${props.escrow === "vemezo" ? "bg-mezo text-on-mezo" : "bg-acc text-on-acc"}`}
      >
        <span className="text-[15px] font-[650]">
          {props.locks.length > 1 ? (
            <>
              <span className="sm:hidden">{props.locks.length} locks</span>
              <span className="hidden sm:inline">
                Epoch {epoch}, {props.locks.length} locks
              </span>
            </>
          ) : (
            `Epoch ${epoch}`
          )}
        </span>
        <span className="text-[13.5px] opacity-90">{ballot.size} picked</span>
      </div>
      <div className="min-w-0 px-2.5 sm:px-4">
        <p className="truncate text-[13.5px] text-sec">Projected</p>
        <p className="truncate text-[18px] leading-tight font-[650] sm:text-[20px]">
          <Usd
            value={microToUsd(props.projectedMicro)}
            style="cents"
            countUp="ballot-projected"
          />
        </p>
      </div>
      <BarMark ballot={ballot} gauges={gauges} />
      <div className="ml-auto flex flex-none items-center gap-2.5 pr-2.5 sm:pr-3">
        <BarOptimize
          state={props.optimize}
          onOptimize={props.onOptimize}
          onUndo={props.onUndo}
          compact
        />
        <PillButton.Root
          {...props.reviewIntent}
          className="max-sm:px-4"
          disabled={props.readOnly || !signable(ballot)}
          onClick={props.onReview}
        >
          {/* A phone has no room for ", 14 signatures": the sheet says it. */}
          <span className="sm:hidden">{shortPrimary(props.primary)}</span>
          <span className="hidden sm:inline">{props.primary}</span>
        </PillButton.Root>
      </div>
    </section>
  )
}
