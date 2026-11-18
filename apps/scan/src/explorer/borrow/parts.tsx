import { addressAvatar } from "@matchbox/domain/format"
import { TokenIcon } from "@matchbox/token-icons"
import * as Avatar from "@matchbox/ui/avatar"
import { Glyph, shapes } from "@matchbox/ui/icons"
import type { ReactNode } from "react"
import type { HealthBand } from "../../data/scan/words"
import { bandTone } from "../address/shared"

/**
 * Pieces the Borrow pages share (`mGK4_HnGnZ`, `BeSXytOlBc`, `SMPC0BE45O`,
 * `gEpCzgLLt1`): coins, the health bar, soft panels and the action on
 * Mezo. The title and tabs, charts and history live in their own modules,
 * so each page loads only what it draws. Every figure arrives formatted
 * from the server.
 */

/** Borrowing happens on Mezo (copy rules: actions point to the product). */
export const mezoBorrowUrl = "https://mezo.org/borrow"

// -- coins --------------------------------------------------------------------

export function Coin({
  ticker,
  size = 18,
}: {
  ticker: string | null
  size?: number
}): ReactNode {
  if (ticker === null) return null
  return <TokenIcon ticker={ticker} size={size} />
}

/** Collateral over loan, the loan coin offset down and right. */
export function CoinPair({
  collateral,
  loan,
  size = 32,
}: {
  collateral: string | null
  loan: string | null
  size?: number
}): ReactNode {
  return (
    <span
      aria-hidden="true"
      className="relative inline-block flex-none"
      style={{ width: size * 1.45, height: size * 1.3 }}
    >
      <span className="absolute top-0 left-0">
        <Coin ticker={collateral} size={size} />
      </span>
      <span className="absolute right-0 bottom-0 rounded-full shadow-[0_0_0_2px_var(--color-bg)]">
        <Coin ticker={loan} size={size} />
      </span>
    </span>
  )
}

/** Two 18px coins side by side (rows). */
export function CoinStack({
  collateral,
  loan,
}: {
  collateral: string | null
  loan: string | null
}): ReactNode {
  return (
    <span aria-hidden="true" className="inline-flex flex-none items-center">
      <Coin ticker={collateral} />
      <span className="-ml-[5px] rounded-full shadow-[0_0_0_2px_var(--color-bg)]">
        <Coin ticker={loan} />
      </span>
    </span>
  )
}

/** "1.3040 BTC" with its coin. */
export function Amount({
  coin,
  text,
  className,
}: {
  coin: string | null
  text: string | null
  className?: string
}): ReactNode {
  if (text === null) return <span className="text-sec">None</span>
  return (
    <span
      className={`inline-flex items-center gap-2 tabular-nums ${className ?? ""}`}
    >
      <Coin ticker={coin} />
      {text}
    </span>
  )
}

// -- health -------------------------------------------------------------------

const bandFill: Record<HealthBand, string> = {
  healthy: "bg-band-pos",
  near_liquidation: "bg-band-acc",
  liquidatable: "bg-band-neg",
  no_debt: "bg-soft2",
  unknown: "bg-soft2",
}

export { bandTone }

/**
 * LTV on a 0 to 100% track, filled in the band's colour (green healthy,
 * amber approaching, red liquidatable), with the liquidation LTV marked
 * when the market has one. Display only: shares come from API ratios.
 */
export function HealthBar({
  share,
  limit,
  band,
  label,
  size = "small",
}: {
  share: number | null
  limit: number | null
  band: HealthBand
  label: string
  size?: "small" | "large"
}): ReactNode {
  const height = size === "large" ? "h-3" : "h-1.5"
  return (
    <span
      role="img"
      aria-label={label}
      className={`relative block w-full rounded-full bg-soft2 ${height}`}
    >
      {share === null ? null : (
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${bandFill[band]}`}
          style={{ width: `${Math.max(1, share * 100)}%` }}
        />
      )}
      {limit === null ? null : (
        <span
          className="absolute -inset-y-1 w-0.5 rounded-full bg-neg"
          style={{ left: `${limit * 100}%` }}
        />
      )}
    </span>
  )
}

/** "1.85" over a short bar with the LTV, for table cells. */
export function HealthCell({
  band,
  figure,
  detail,
  share,
  limit,
  label,
}: {
  band: HealthBand
  figure: string | null
  detail: string | null
  share: number | null
  limit: number | null
  label: string
}): ReactNode {
  return (
    <span className="flex min-w-[150px] flex-col gap-1.5">
      <span className="flex items-baseline gap-2">
        <span className={`font-semibold tabular-nums ${bandTone[band]}`}>
          {figure ?? "None"}
        </span>
        {detail === null ? null : (
          <span className="text-[14px] text-sec">{detail}</span>
        )}
      </span>
      <span className="max-w-[140px]">
        <HealthBar share={share} limit={limit} band={band} label={label} />
      </span>
    </span>
  )
}

// -- panels -------------------------------------------------------------------

/** A soft card, radius 24: label left, aside right, then the content. */
export function Panel({
  label,
  aside,
  children,
  className,
}: {
  label: string
  aside?: ReactNode
  children: ReactNode
  className?: string
}): ReactNode {
  return (
    <section
      aria-label={label}
      className={`flex min-w-0 flex-col rounded-[24px] bg-soft p-6 max-md:p-5 ${className ?? ""}`}
    >
      <div className="flex min-h-7 items-center justify-between gap-4">
        <p className="text-[15px] text-ink2">{label}</p>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Stat({
  label,
  children,
  sub,
}: {
  label: string
  children: ReactNode
  sub?: ReactNode
}): ReactNode {
  return (
    <div className="min-w-0">
      <dt className="text-[14px] text-sec">{label}</dt>
      <dd className="mt-0.5 text-[16px] font-semibold tabular-nums">
        {children}
      </dd>
      {sub === undefined || sub === null ? null : (
        <dd className="text-[14px] text-sec tabular-nums">{sub}</dd>
      )}
    </div>
  )
}

// -- incomplete lists -----------------------------------------------------------

/**
 * Rows the API left out of a list without a pager (they failed their
 * schema): said once, quietly, so the list is not read as whole.
 */
export function RowsNotShown({
  skipped,
}: {
  skipped: number | undefined
}): ReactNode {
  if (skipped === undefined || skipped <= 0) return null
  return (
    <p className="mt-3 text-[14.5px] text-sec">
      {skipped === 1 ? "1 row" : `${skipped} rows`} not shown
    </p>
  )
}

// -- delay --------------------------------------------------------------------

/**
 * The page's live Borrow reads came from a snapshot the API calls stale
 * (`snapshot.stale`): one quiet line above the page.
 */
export function BorrowDelayed({ delayed }: { delayed: boolean }): ReactNode {
  if (!delayed) return null
  return (
    <p role="status" className="pt-4 text-[14.5px] text-sec">
      Borrow data is delayed: loans and markets show an earlier block than the
      chain's latest.
    </p>
  )
}

// -- actions ------------------------------------------------------------------

export function MezoAction({ label }: { label: string }): ReactNode {
  return (
    <a
      href={mezoBorrowUrl}
      className="flex h-11 items-center justify-center gap-2 rounded-[22px] bg-acc px-5 font-semibold text-on-acc outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink max-md:w-full"
    >
      {label}
      <Glyph shape={shapes.arrowUpRight} size={16} strokeWidth={2} />
    </a>
  )
}

// -- rows ---------------------------------------------------------------------

export const rowLink =
  "rounded-sm font-semibold outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"

export function Borrower({
  address,
  children,
}: {
  address: string
  children: ReactNode
}): ReactNode {
  const avatar = addressAvatar(address)
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar.Root initials={avatar.initials} hue={avatar.hue} size={36} />
      <span className="flex min-w-0 flex-col">{children}</span>
    </span>
  )
}
