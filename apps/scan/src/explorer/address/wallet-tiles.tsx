import { groupThousands } from "@matchbox/domain/format"
import { TokenIcon } from "@matchbox/token-icons"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as Inspect from "@matchbox/ui/inspect"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { Section } from "../../data/explorer"
import { proOrigin } from "../../data/pro-links"
import type { StreakView, WalletView } from "../../data/wallet-views"
import { figureClass, Tile } from "./tile"

/**
 * The address page's wallet tiles (`eSwId--0MF`): rewards claimed, the
 * locks' voting streak, veMEZO votes and claimable, from the read models
 * Matchbox Pro reads and the wallet's lock votes. Loaded after the page
 * (wallet-panels), each tile keeps its place whatever the answer: a
 * figure, "None" or the read's state. Claiming happens on Matchbox Pro;
 * Matchscan never signs.
 */

export const proRewardsUrl = `${proOrigin}/rewards`

const noteClass =
  "mt-1 text-[15px] text-sec max-sm:truncate max-sm:text-[13.5px]"

/** A read that failed, in the tile's figure, with Retry once offered. */
function Failed({
  section,
  retry,
}: {
  section: Section<unknown>
  retry: (() => void) | null
}): ReactNode {
  return (
    <>
      <p
        role="status"
        className="mt-2 text-[22px] leading-tight font-[650] text-sec max-sm:text-[18px]"
      >
        {section.status === "rate-limited" ? "Busy" : "Not available"}
      </p>
      {retry === null ? null : (
        <button
          type="button"
          onClick={retry}
          className="mt-auto self-start rounded-sm text-[14.5px] font-semibold underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ink"
        >
          Retry
        </button>
      )}
    </>
  )
}

export function RewardsClaimedTile({
  wallet,
  retry = null,
}: {
  wallet: Section<WalletView>
  retry?: (() => void) | null
}): ReactNode {
  if (wallet.status !== "ok") {
    return (
      <Tile label="Rewards claimed">
        <Failed section={wallet} retry={retry} />
      </Tile>
    )
  }
  const claimed = wallet.data.claimed
  return (
    <Tile label="Rewards claimed">
      <p className={figureClass}>{claimed?.usd ?? "None"}</p>
      <p className={noteClass}>
        {claimed === null
          ? "No claims"
          : `${claimed.epochs === 1 ? "1 epoch" : `${claimed.epochs} epochs`}${claimed.capped ? ", last 12 claims" : ""}`}
      </p>
    </Tile>
  )
}

function squareTone(square: StreakView["squares"][number]): string {
  if (square.voted) return "bg-pos"
  if (square.current) return "bg-bg shadow-[inset_0_0_0_2px_var(--color-acc)]"
  return "bg-mut/35"
}

function squareValue(square: StreakView["squares"][number]): string {
  if (square.voted) return "Voted"
  return square.current ? "Not voted yet" : "No votes"
}

/**
 * The streak of the locks the wallet holds now: votes are stored per
 * lock, so a lock sold since takes its votes with it.
 */
export function StreakTile({
  streak,
  retry = null,
}: {
  streak: Section<StreakView>
  retry?: (() => void) | null
}): ReactNode {
  Inspect.useInspect(streak.status === "ok")
  const label = "Locks' voting streak"
  if (streak.status !== "ok") {
    return (
      <Tile label={label}>
        <Failed section={streak} retry={retry} />
      </Tile>
    )
  }
  const view = streak.data
  const first = view.squares[0]
  const last = view.squares.at(-1)
  return (
    <Tile label={label}>
      <p className={figureClass}>
        {view.more ? `${view.streak}+` : view.streak}{" "}
        {view.streak === 1 && !view.more ? "epoch" : "epochs"}
      </p>
      {view.missed === null ? null : (
        <p className={noteClass}>Missed Epoch {view.missed}</p>
      )}
      <div className="mt-auto pt-3">
        <ul
          aria-label="Votes by epoch"
          className="flex gap-1.5 max-sm:gap-1"
          {...Inspect.root("items", "tip", false)}
        >
          {view.squares.map((square) => (
            <li key={square.epoch} className="min-w-0 flex-1">
              <Link
                to="/epochs/$epoch"
                params={{ epoch: String(square.epoch) }}
                aria-label={`Epoch ${square.epoch}, ${squareValue(square)}`}
                className={`block h-[22px] rounded-[6px] outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink max-sm:h-4 max-sm:rounded-[4px] ${squareTone(square)}`}
                {...Inspect.point({
                  label: `Epoch ${square.epoch}`,
                  value: squareValue(square),
                })}
              />
            </li>
          ))}
        </ul>
        <p
          aria-hidden="true"
          className="mt-2 flex justify-between gap-2 text-[12.5px] text-mut max-sm:text-[11.5px]"
        >
          <span>Epoch {first?.epoch}</span>
          <span>Epoch {last?.epoch}</span>
        </p>
      </div>
    </Tile>
  )
}

export function VeMezoTile({
  wallet,
  retry = null,
}: {
  wallet: Section<WalletView>
  retry?: (() => void) | null
}): ReactNode {
  if (wallet.status !== "ok") {
    return (
      <Tile label="veMEZO votes">
        <Failed section={wallet} retry={retry} />
      </Tile>
    )
  }
  const votes = wallet.data.veMezo
  if (votes === null) {
    return (
      <Tile label="veMEZO votes">
        <p className={figureClass}>None</p>
        <p className={noteClass}>No veMEZO locks</p>
      </Tile>
    )
  }
  const share = Math.min(10_000, Math.max(0, votes.usedBps))
  return (
    <Tile label="veMEZO votes">
      <p className={`flex items-center gap-2.5 max-sm:gap-1.5 ${figureClass}`}>
        <TokenIcon ticker="MEZO" size={24} />
        {votes.votes}
      </p>
      <p className={noteClass}>
        {votes.voted
          ? votes.projectedApr === null
            ? `Voted in Epoch ${votes.epoch}`
            : `${votes.projectedApr} projected APR`
          : `Not voted in Epoch ${votes.epoch}`}
      </p>
      <div className="mt-auto pt-3">
        <div
          aria-hidden="true"
          className="h-2 overflow-hidden rounded-full bg-soft2"
        >
          <div
            className="h-full rounded-full bg-mezo"
            style={{ width: `${share / 100}%` }}
          />
        </div>
        <p className="mt-2 flex justify-between gap-x-2 text-[12.5px] text-mut max-sm:text-[11.5px]">
          <span className="min-w-0 truncate">
            {Math.round(share / 100)}% of power used
          </span>
          {votes.epoch === null ? null : (
            <span className="flex-none">Epoch {votes.epoch}</span>
          )}
        </p>
      </div>
    </Tile>
  )
}

export function ClaimableTile({
  wallet,
  retry = null,
}: {
  wallet: Section<WalletView>
  retry?: (() => void) | null
}): ReactNode {
  if (wallet.status !== "ok") {
    return (
      <Tile label="Claimable">
        <Failed section={wallet} retry={retry} />
      </Tile>
    )
  }
  const claimable = wallet.data.claimable
  if (claimable === null) {
    return (
      <Tile label="Claimable">
        <p className={figureClass}>$0.00</p>
        <p className={noteClass}>Nothing to claim</p>
      </Tile>
    )
  }
  return (
    <Tile label="Claimable">
      <p className={`flex items-center gap-2.5 max-sm:gap-1.5 ${figureClass}`}>
        {claimable.symbols.length === 0 ? null : (
          <span className="flex flex-none items-center max-sm:hidden">
            {claimable.symbols.slice(0, 3).map((symbol, index) => (
              <span
                key={symbol}
                className={`flex rounded-full shadow-[0_0_0_2px_var(--color-soft)] ${index > 0 ? "-ml-1.5" : ""}`}
              >
                <TokenIcon ticker={symbol} size={22} />
              </span>
            ))}
          </span>
        )}
        {claimable.usd}
      </p>
      <p className={noteClass}>
        {[
          claimable.epoch === null ? null : `Epoch ${claimable.epoch} votes`,
          claimable.storedAt === null
            ? null
            : `as of block ${groupThousands(BigInt(claimable.storedAt))}`,
        ]
          .filter((part) => part !== null)
          .join(", ")}
      </p>
      <a
        href={proRewardsUrl}
        aria-label="Claim on Matchbox"
        className="mt-auto flex h-10 items-center justify-center gap-2 rounded-[20px] bg-bg text-[14.5px] font-semibold outline-none hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink max-sm:h-9 max-sm:gap-1 max-sm:text-[13px] whitespace-nowrap"
      >
        {/* "Claim" on a phone, where the tile is half the width. */}
        <span className="max-sm:hidden">Claim on Matchbox</span>
        <span className="sm:hidden">Claim</span>
        <Glyph shape={shapes.arrowUpRight} size={15} strokeWidth={2} />
      </a>
    </Tile>
  )
}
