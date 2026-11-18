import { TokenIcon } from "@matchbox/token-icons"
import { Glyph, shapes } from "@matchbox/ui/icons"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { PoolChain, PoolLink, PoolRow, Rate } from "../../data/pools"

/**
 * Pieces the Pools pages and the token pages' pool tables share: the chain
 * mark, a pool's coins with its chain's badge (`br-mark`: badge, chain in
 * the subline, Chain column), a yearly rate cell, and links that say where
 * they go.
 */

export const textLink =
  "rounded-sm font-semibold outline-none underline underline-offset-4 decoration-1 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-ink"

const nameLink =
  "rounded-sm font-semibold outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"

/**
 * A chain's mark: Mezo's coin, Ethereum's diamond, Base's square. Drawn
 * inline, no request of its own.
 */
export function ChainMark({
  chain,
  size = 16,
}: {
  chain: PoolChain
  size?: number
}): ReactNode {
  if (chain === "mezo") return <TokenIcon ticker="MEZO" size={size} />
  if (chain === "base") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
        <rect width="16" height="16" rx="3" fill="#0000FF" />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="8" className="fill-soft2" />
      <path d="M8 2.5 4.6 8.1 8 10.1l3.4-2L8 2.5Z" className="fill-ink" />
      <path d="M8 10.8 4.6 8.8 8 13.5l3.4-4.7L8 10.8Z" className="fill-ink2" />
    </svg>
  )
}

/** The pool's coins, MUSD first, with the chain's badge off Mezo. */
export function PoolCoins({
  row,
  size = 28,
}: {
  row: Pick<PoolRow, "tickers" | "chain">
  size?: number
}): ReactNode {
  return (
    <span aria-hidden="true" className="relative inline-flex flex-none">
      {row.tickers.map((ticker, index) => (
        <span
          key={ticker}
          className="block rounded-full shadow-[0_0_0_2px_var(--color-bg)] [&+&]:-ml-[7px]"
          style={{ zIndex: row.tickers.length - index }}
        >
          <TokenIcon ticker={ticker} size={size} />
        </span>
      ))}
      {row.chain === "mezo" ? null : (
        <span className="absolute -right-1.5 -bottom-1 z-10 flex rounded-full bg-bg p-px">
          <ChainMark chain={row.chain} size={Math.round(size * 0.55)} />
        </span>
      )}
    </span>
  )
}

/** Router props for a pool's page on Matchscan. */
export function poolLinkProps(link: PoolLink) {
  return link.chain === "mezo"
    ? ({ to: "/pools/$pool", params: { pool: link.pool } } as const)
    : ({
        to: "/pools/$chain/$pool",
        params: { chain: link.chain, pool: link.pool },
      } as const)
}

/** The pool's name, linked to its page, with "Curve on Ethereum" under it. */
export function PoolName({
  row,
}: {
  row: Pick<
    PoolRow,
    "link" | "title" | "legacy" | "where" | "tickers" | "chain"
  >
}): ReactNode {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <PoolCoins row={row} />
      <span className="flex min-w-0 flex-col">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <Link {...poolLinkProps(row.link)} className={nameLink}>
            {row.title}
          </Link>
          {row.legacy ? (
            <span className="text-[13.5px] whitespace-nowrap text-sec">
              legacy pool
            </span>
          ) : null}
        </span>
        <span className="truncate text-[14.5px] text-sec">{row.where}</span>
      </span>
    </span>
  )
}

/** A link off Matchscan: the arrow and where it goes. */
export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string
  children: ReactNode
  className?: string
}): ReactNode {
  return (
    <a
      href={href}
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 ${textLink} ${className ?? ""}`}
    >
      {children}
      <Glyph shape={shapes.arrowUpRight} size={14} strokeWidth={2.2} />
    </a>
  )
}

const muted = "font-normal whitespace-nowrap text-sec"

/** A pool figure no source gave (none stored yet, or a source down). */
export function NotAvailable({
  children,
}: {
  children?: ReactNode
}): ReactNode {
  return <span className={muted}>{children ?? "Not available yet"}</span>
}

/** A yearly rate: the figure (with "est." when ours), none, or why not. */
export function RateText({
  rate,
  strong = false,
}: {
  rate: Rate
  strong?: boolean
}): ReactNode {
  switch (rate.kind) {
    case "value":
      return (
        <span className={strong ? "font-semibold" : undefined}>
          {rate.from ? "From " : ""}
          {rate.text}
          {rate.est ? (
            <span className="ml-1 text-[13.5px] font-normal text-sec">
              est.
            </span>
          ) : null}
        </span>
      )
    case "none":
      return <span className={muted}>None</span>
    case "not-yet":
      return <span className={muted}>Not available yet</span>
    case "hidden":
      return <span className={muted}>Under $25k</span>
  }
}
