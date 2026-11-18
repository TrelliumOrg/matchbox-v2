import { TokenIcon } from "@matchbox/token-icons"
import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import { type ReactNode, useEffect, useRef, useState } from "react"
import type { Lock, LockKind } from "../../data/view-models"
import { formatDate, formatVoteAmount } from "../../lib/format"
import { escrowUnit } from "../gauge/kinds"
import { lockBlock } from "./locks"

/**
 * "Vote with": the escrow's locks as mini lock cards (direction A on
 * `VIV1RuryQ3`): coloured tab with the coin, "#2930" and a checkbox, then
 * the voting power in the escrow's unit and one meta row (unlock date,
 * Auto max, or why it cannot vote). Locks that cannot vote stay visible,
 * dimmed. A lock that voted this epoch can be picked: its changes save for
 * the next epoch. A New lock card ends the row.
 *
 * The row is one line that scrolls sideways, for 2 locks or 50. A wallet
 * with 14 locks saw four cards, the fourth cut off, and nothing saying
 * there were more (Zho, 12 Nov 2026). So the heading counts ("12 of 14"),
 * Select all and Clear are both always there, and from 834px the cut edge
 * fades, arrows move the row a screenful and it has a thin scrollbar. On a
 * phone the row scrolls by touch and the next card peeks.
 *
 * Swappable: Vote only depends on `LockPickerProps`.
 */

export type LockPickerProps = {
  escrow: LockKind
  locks: readonly Lock[]
  selected: readonly string[]
  onSelectedChange: (ids: string[]) => void
  onNewLock: () => void
  /**
   * Locks whose changes are saved for `nextEpoch` (they voted this one).
   * A list, not a Set: the picker is an island and islands compare props
   * by value.
   */
  saved: readonly string[]
  nextEpoch: number
}

const tab: Record<LockKind, { surface: string; coin: "MEZO" | "BTC" }> = {
  vemezo: { surface: "bg-mezo text-on-mezo", coin: "MEZO" },
  vebtc: { surface: "bg-acc text-on-acc", coin: "BTC" },
}

function Meta({
  shape,
  children,
}: {
  shape: GlyphShape
  children: ReactNode
}): ReactNode {
  return (
    <span className="flex items-center gap-1.5 text-[13px] text-sec">
      <Glyph shape={shape} size={14} strokeWidth={1.8} />
      {children}
    </span>
  )
}

function MiniLock({
  lock,
  checked,
  onChange,
  savedFor,
}: {
  lock: Lock
  checked: boolean
  onChange: (checked: boolean) => void
  /** The epoch this voted lock's changes are saved for, if any. */
  savedFor: number | null
}): ReactNode {
  const block = lockBlock(lock)
  const id = `vote-lock-${lock.kind}-${lock.tokenId}`
  return (
    <li data-flip={id} className="w-[216px] flex-none snap-start">
      <label
        htmlFor={id}
        className={`relative block overflow-hidden rounded-[18px] bg-soft ${block === null ? "cursor-pointer" : "cursor-not-allowed opacity-55"}`}
      >
        <span
          aria-hidden="true"
          data-mbx-motion=""
          className={`pointer-events-none absolute inset-0 z-10 rounded-[18px] shadow-[inset_0_0_0_2px_var(--acc)] transition-opacity duration-200 ease-roll ${checked ? "opacity-100" : "opacity-0"}`}
        />
        <span
          className={`flex h-[38px] items-center gap-2 px-3 text-[14.5px] font-[650] ${tab[lock.kind].surface}`}
        >
          <span className="block rounded-full shadow-[0_0_0_1.5px_#fff]">
            <TokenIcon ticker={tab[lock.kind].coin} size={18} />
          </span>
          #{lock.tokenId}
          <input
            id={id}
            type="checkbox"
            checked={checked}
            disabled={block !== null}
            onChange={(event) => onChange(event.target.checked)}
            aria-describedby={`${id}-meta`}
            className="ml-auto size-[18px] cursor-pointer accent-white disabled:cursor-not-allowed"
          />
        </span>
        <span className="flex flex-col gap-1 px-3 pt-2.5 pb-3">
          <span className="text-[16px] font-[650] tabular-nums">
            {formatVoteAmount(lock.votingPowerWei, escrowUnit[lock.kind])}
          </span>
          <span id={`${id}-meta`}>
            {block !== null ? (
              <Meta shape={shapes.circleAlert}>{block}</Meta>
            ) : savedFor !== null ? (
              <Meta shape={shapes.check}>
                Changes saved for Epoch {savedFor}
              </Meta>
            ) : lock.votedThisEpoch ? (
              <Meta shape={shapes.check}>Voted this epoch</Meta>
            ) : lock.autoMax ? (
              <Meta shape={shapes.infinity}>Auto max</Meta>
            ) : lock.unlocksAt === null ? (
              <Meta shape={shapes.infinity}>Auto max</Meta>
            ) : (
              <Meta shape={shapes.calendarDays}>
                {formatDate(lock.unlocksAt)}
              </Meta>
            )}
          </span>
        </span>
      </label>
    </li>
  )
}

/** "12 of 14": how many of the locks that can vote are picked. */
export function pickedLabel(
  locks: readonly Lock[],
  selected: readonly string[],
): string | null {
  const eligible = locks.filter((lock) => lockBlock(lock) === null)
  if (eligible.length < 2) return null
  const picked = eligible.filter((lock) =>
    selected.includes(lock.tokenId),
  ).length
  return `${picked} of ${eligible.length}`
}

type Overflow = { before: boolean; after: boolean }

/** Which ends of a sideways-scrolling row hide more. */
export function overflowOf(row: {
  scrollLeft: number
  scrollWidth: number
  clientWidth: number
}): Overflow {
  // A pixel of slack: fractional widths never quite reach the end.
  return {
    before: row.scrollLeft > 1,
    after: row.scrollLeft + row.clientWidth < row.scrollWidth - 1,
  }
}

// Desktop only: on a phone the next card peeks, and a fade would hide its
// checkbox.
const fade: Record<"none" | "before" | "after" | "both", string> = {
  none: "",
  before:
    "min-[834px]:[mask-image:linear-gradient(to_right,transparent,#000_48px)]",
  after:
    "min-[834px]:[mask-image:linear-gradient(to_left,transparent,#000_48px)]",
  both: "min-[834px]:[mask-image:linear-gradient(to_right,transparent,#000_48px,#000_calc(100%-48px),transparent)]",
}

function Arrow({
  side,
  onClick,
}: {
  side: "before" | "after"
  onClick: () => void
}): ReactNode {
  return (
    <button
      type="button"
      // The row itself scrolls with the keyboard (it holds the checkboxes),
      // so the arrows stay out of the tab order.
      tabIndex={-1}
      aria-label={side === "before" ? "Earlier locks" : "More locks"}
      onClick={onClick}
      className={`absolute top-1/2 z-20 hidden size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-raised text-ink shadow-[inset_0_0_0_1px_var(--edge),var(--lift)] outline-none hover:bg-soft2 min-[834px]:flex ${side === "before" ? "-left-3" : "-right-3"}`}
    >
      <Glyph
        shape={side === "before" ? shapes.chevronLeft : shapes.chevronRight}
        size={18}
        strokeWidth={2.2}
      />
    </button>
  )
}

const headButton =
  "cursor-pointer rounded-sm text-[14.5px] font-semibold underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-default disabled:text-mut disabled:no-underline"

export function LockPicker({
  escrow,
  locks,
  selected,
  onSelectedChange,
  onNewLock,
  saved,
  nextEpoch,
}: LockPickerProps): ReactNode {
  const eligible = locks.filter((lock) => lockBlock(lock) === null)
  const picked = eligible.filter((lock) => selected.includes(lock.tokenId))
  const count = pickedLabel(locks, selected)

  const row = useRef<HTMLUListElement>(null)
  const [overflow, setOverflow] = useState<Overflow>({
    before: false,
    after: false,
  })
  // Measured again when the locks change, too: the row gets longer.
  const lockCount = locks.length
  useEffect(() => {
    const element = row.current
    if (element === null || lockCount < 0) return
    const measure = () => {
      const next = overflowOf(element)
      setOverflow((current) =>
        current.before === next.before && current.after === next.after
          ? current
          : next,
      )
    }
    measure()
    element.addEventListener("scroll", measure, { passive: true })
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    observer?.observe(element)
    return () => {
      element.removeEventListener("scroll", measure)
      observer?.disconnect()
    }
  }, [lockCount])

  function page(direction: 1 | -1): void {
    const element = row.current
    if (element === null) return
    // Most of a screenful, so the last card seen stays in view.
    element.scrollBy({
      left: direction * Math.max(228, element.clientWidth - 228),
      behavior: "smooth",
    })
  }

  const edge =
    overflow.before && overflow.after
      ? "both"
      : overflow.before
        ? "before"
        : overflow.after
          ? "after"
          : "none"

  return (
    <section aria-labelledby="vote-with">
      <div className="flex items-center gap-4">
        <h2 id="vote-with" className="text-[15px] text-sec">
          Vote with
          {count === null ? null : (
            <>
              {" "}
              <span
                data-vote-with-count=""
                className="font-semibold text-ink tabular-nums"
              >
                {count}
              </span>
            </>
          )}
        </h2>
        {eligible.length > 1 ? (
          <div className="ml-auto flex items-center gap-4">
            <button
              type="button"
              disabled={picked.length === eligible.length}
              onClick={() =>
                onSelectedChange(eligible.map((lock) => lock.tokenId))
              }
              className={headButton}
            >
              Select all
            </button>
            <button
              type="button"
              disabled={picked.length === 0}
              onClick={() => onSelectedChange([])}
              className={headButton}
            >
              Clear
            </button>
          </div>
        ) : null}
      </div>
      <div className="relative mt-2.5">
        <ul
          ref={row}
          data-flip-list=""
          data-vote-with-row=""
          className={`-mx-5 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none] min-[834px]:mx-0 min-[834px]:scroll-px-0 min-[834px]:px-0 min-[834px]:pb-2.5 min-[834px]:[scrollbar-color:var(--line)_transparent] min-[834px]:[scrollbar-width:thin] ${fade[edge]}`}
        >
          {locks.map((lock) => (
            <MiniLock
              key={lock.tokenId}
              lock={lock}
              checked={selected.includes(lock.tokenId)}
              savedFor={saved.includes(lock.tokenId) ? nextEpoch : null}
              onChange={(checked) =>
                onSelectedChange(
                  checked
                    ? [...selected, lock.tokenId]
                    : selected.filter((id) => id !== lock.tokenId),
                )
              }
            />
          ))}
          <li data-flip="new-lock" className="w-[176px] flex-none snap-start">
            <button
              type="button"
              onClick={onNewLock}
              className="flex h-full min-h-[100px] w-full cursor-pointer items-center justify-center gap-2 rounded-[18px] text-[15px] font-semibold shadow-[inset_0_0_0_1.5px_var(--line)] outline-none hover:bg-soft focus-visible:outline-2 focus-visible:outline-ink"
            >
              <Glyph shape={shapes.plus} size={18} strokeWidth={2} />
              New lock
            </button>
          </li>
        </ul>
        {overflow.before ? (
          <Arrow side="before" onClick={() => page(-1)} />
        ) : null}
        {overflow.after ? <Arrow side="after" onClick={() => page(1)} /> : null}
      </div>
      {locks.length === 0 ? (
        <p className="mt-2 text-[14.5px] text-sec">
          No {escrowUnit[escrow]} lock
        </p>
      ) : null}
    </section>
  )
}
