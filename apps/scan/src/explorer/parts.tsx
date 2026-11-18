import { shortAddress, shortHash } from "@matchbox/domain/format"
import { Tip } from "@matchbox/ui/floating"
import * as HashChip from "@matchbox/ui/hash-chip"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as UntrustedText from "@matchbox/ui/untrusted-text"
import { Link, useRouter } from "@tanstack/react-router"
import { cloneElement, isValidElement, type ReactNode } from "react"
import type { Entity } from "../data/explorer"
import type { AddressView, Cursor } from "../data/views"
import { sectionStateText } from "./section-text"

/**
 * Pieces every chain page shares: addresses and hashes as links, the
 * states of a section whose read failed, the keyset pager and detail rows.
 * Every chain-supplied string renders through UntrustedText.
 */

/**
 * The name to show for an address: our label (from the labels read model,
 * put on the view by the server), else Blockscout's name, else null.
 */
export function displayName(view: AddressView): string | null {
  return view.label?.name ?? view.name
}

/** An address as a link: its name when known (untrusted), else 0x7f3a…91c2. */
export function AddressLink({
  view,
  className,
}: {
  view: AddressView
  className?: string
}): ReactNode {
  const label = displayName(view)
  return (
    <Link
      to="/address/$address"
      params={{ address: view.address }}
      title={view.address}
      className={`rounded-sm outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink ${label === null ? "font-mono text-[14.5px]" : ""} ${className ?? ""}`}
    >
      {label === null ? (
        shortAddress(view.address)
      ) : (
        <UntrustedText.Root value={label} limit={40} />
      )}
    </Link>
  )
}

/** A name over its short address, for proposers and parties. */
export function AddressStack({ view }: { view: AddressView }): ReactNode {
  const label = displayName(view)
  return (
    <span className="flex min-w-0 flex-col">
      <Link
        to="/address/$address"
        params={{ address: view.address }}
        className="truncate rounded-sm font-semibold outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
      >
        {label === null ? (
          <span className="font-mono">{shortAddress(view.address)}</span>
        ) : (
          <UntrustedText.Root value={label} limit={40} />
        )}
      </Link>
      {label === null ? null : (
        <span className="font-mono text-[14px] text-sec">
          {shortAddress(view.address)}
        </span>
      )}
    </span>
  )
}

export function TxLink({ hash }: { hash: string }): ReactNode {
  return (
    <HashChip.Root value={hash} kind="hash">
      <HashChip.Value asChild>
        <Link to="/tx/$hash" params={{ hash }} />
      </HashChip.Value>
    </HashChip.Root>
  )
}

export function BlockLink({ height }: { height: number }): ReactNode {
  return (
    <Link
      to="/block/$id"
      params={{ id: String(height) }}
      className="rounded-sm font-mono text-[14.5px] underline decoration-line underline-offset-[5px] outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink"
    >
      {height.toLocaleString("en-US")}
    </Link>
  )
}

/**
 * A short hash whose full value shows in a tip on hover, keyboard focus and
 * tap (a title does nothing on touch).
 */
export function ShortHash({ hash }: { hash: string }): ReactNode {
  return (
    <Tip
      content={<span className="font-mono break-all">{hash}</span>}
      trigger={(props) => (
        <span
          {...props}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the full hash must be reachable by keyboard and tap
          tabIndex={0}
          className="cursor-default rounded-sm font-mono text-[14px] text-sec outline-none focus-visible:outline-2 focus-visible:outline-ink"
        >
          {shortHash(hash)}
        </span>
      )}
    />
  )
}

/**
 * A Mezo ID's mark: the key-round icon with a tip, as `@matchbox/ui`'s
 * PropertyIcon draws properties, without that component's table of every
 * property's shape (about 2.6 kB brotli on the address page).
 */
export function MezoIdMark(): ReactNode {
  return (
    <Tip
      content="Mezo ID"
      trigger={(props) => (
        <span
          role="img"
          aria-label="Mezo ID"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need the tooltip
          tabIndex={0}
          className="inline-grid flex-none cursor-default place-items-center rounded-sm text-sec outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          {...props}
        >
          <Glyph shape={shapes.keyRound} size={16} strokeWidth={1.75} />
        </span>
      )}
    />
  )
}

/**
 * A section whose read failed: one line and a retry, in the space the
 * section would have taken, so the rest of the page stands.
 */
export function SectionState({
  section,
  retry,
}: {
  section: Exclude<Entity<unknown>, { status: "ok" }>
  /** Reads the section again; by default the route's data is reloaded. */
  retry?: () => void
}): ReactNode {
  const router = useRouter()
  return (
    <div
      role="status"
      className="flex min-h-[180px] flex-col items-center justify-center gap-4 rounded-[24px] bg-soft px-6 py-10 text-center"
    >
      <Glyph shape={shapes.circleAlert} size={22} strokeWidth={1.8} />
      <p className="text-[16px] font-semibold">
        {sectionStateText[section.status]}
      </p>
      {section.status === "disabled" || section.status === "missing" ? null : (
        <button
          type="button"
          onClick={retry ?? (() => void router.invalidate())}
          className="h-10 cursor-pointer rounded-[20px] bg-raised px-5 text-[15px] font-semibold text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          Try again
        </button>
      )}
    </div>
  )
}

export { sectionStateText }

/**
 * Section heading: 24/650 title, optional quiet detail on the right. A link
 * there ("All blocks") is marked `data-tap`, so under a finger it answers
 * in 44 by 44 with nothing moving on screen.
 */
export function SectionHeading({
  id,
  children,
  aside,
}: {
  id: string
  children: ReactNode
  aside?: ReactNode
}): ReactNode {
  return (
    <div className="mb-4 flex items-baseline gap-4">
      <h2 id={id} className="text-[24px] font-[650] tracking-[-0.015em]">
        {children}
      </h2>
      <span className="flex-1" />
      {aside === undefined ? null : (
        <span className="text-[15px] text-sec">
          {isValidElement<{ "data-tap"?: string }>(aside) &&
          (aside.type === Link || aside.type === "a")
            ? cloneElement(aside, { "data-tap": "" })
            : aside}
        </span>
      )}
    </div>
  )
}

/** Detail rows (block and transaction pages): label, value. */
export function Details({ children }: { children: ReactNode }): ReactNode {
  return <dl className="flex flex-col">{children}</dl>
}

export function Detail({
  label,
  children,
}: {
  label: string
  children: ReactNode
}): ReactNode {
  return (
    <div className="flex min-h-[46px] items-start gap-6 border-b border-line py-3 max-md:flex-col max-md:gap-1">
      <dt className="w-44 flex-none text-[15px] text-sec">{label}</dt>
      <dd className="min-w-0 flex-1 text-[15px] [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  )
}

const pagerButton =
  "grid size-10 flex-none place-items-center rounded-full bg-soft text-ink outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"

/**
 * Keyset paging: Latest returns to the first page, Older follows the
 * proxy's next cursor. No offsets and no page numbers: a page is the same
 * rows however fast the chain moves.
 *
 * Long lists put one above the list (`position="top"`, under its heading,
 * so nobody scrolls to the foot to turn the page) and one below it
 * (`"bottom"`, named "Pages, end of list" so the two navigations differ).
 * A list with a single pager leaves `position` out.
 */
export function Pager({
  position = "only",
  label,
  paged: pagedProp,
  next,
  to,
  params,
  extra,
  skipped,
  restarted,
}: {
  /** Rows the API left out of this page (failed their schema). */
  skipped?: number | undefined
  /** A stale cursor was dropped and this is the list from the top. */
  restarted?: boolean | undefined
  /** Above the list, below it with one above, or the list's only pager. */
  position?: "top" | "bottom" | "only"
  label: string
  /** True when this page came from a cursor (not the first page). */
  paged: boolean
  next: Cursor | null
  to: string
  params?: Record<string, string>
  extra?: Record<string, string>
}): ReactNode {
  const paged = pagedProp && restarted !== true
  return (
    <nav
      aria-label={position === "bottom" ? "Pages, end of list" : label}
      className={
        position === "top"
          ? "mb-3 flex min-h-10 items-center gap-3"
          : "mt-2 flex min-h-16 items-center gap-3 border-t border-line pt-5"
      }
    >
      <p className="mr-auto text-[15px] text-sec">
        {paged ? "Older" : "Latest"}
        {skipped === undefined || skipped <= 0 ? null : (
          <span>, {skipped === 1 ? "1 row" : `${skipped} rows`} not shown</span>
        )}
      </p>
      {paged ? (
        <Link
          to={to}
          params={params ?? {}}
          search={extra ?? {}}
          aria-label="Latest"
          className={pagerButton}
        >
          <Glyph shape={shapes.chevronLeft} size={18} strokeWidth={2} />
        </Link>
      ) : (
        <button
          type="button"
          disabled
          aria-label="Latest"
          className={`${pagerButton} cursor-not-allowed text-mut hover:bg-soft`}
        >
          <Glyph shape={shapes.chevronLeft} size={18} strokeWidth={2} />
        </button>
      )}
      {next === null ? (
        <button
          type="button"
          disabled
          aria-label="Older"
          className={`${pagerButton} cursor-not-allowed text-mut hover:bg-soft`}
        >
          <Glyph shape={shapes.chevronRight} size={18} strokeWidth={2} />
        </button>
      ) : (
        <Link
          to={to}
          params={params ?? {}}
          search={{ ...(extra ?? {}), ...next }}
          aria-label="Older"
          rel="next"
          className={pagerButton}
        >
          <Glyph shape={shapes.chevronRight} size={18} strokeWidth={2} />
        </Link>
      )}
    </nav>
  )
}

/**
 * The document named only its first `limit` addresses (the API's label
 * limit): the rest show as addresses, which is said once, quietly.
 */
export function LabelsCapped({ limit }: { limit: number | null }): ReactNode {
  if (limit === null) return null
  return (
    <p className="mt-3 text-[14.5px] text-sec">
      Names for the first {limit} addresses
    </p>
  )
}
