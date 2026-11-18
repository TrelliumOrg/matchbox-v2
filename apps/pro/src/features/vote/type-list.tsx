import { prefersReducedMotion, useSlidingIndicator } from "@matchbox/motion"
import { TokenIcon } from "@matchbox/token-icons"
import { Glyph } from "@matchbox/ui/icons"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useEffect, useRef } from "react"
import type { GaugeKind, GaugeKindTotals } from "../../data/view-models"
import { formatUsd, groupThousands } from "../../lib/format"
import { kindShape } from "../gauge/kind-icon"
import { escrowGroups, gaugeKinds } from "../gauge/kinds"

/**
 * Vote's gauge type selector (option 3 on `KU0DDjXECD`): from 834px a 220px
 * sticky list beside the grid, grouped by the lock that votes each type,
 * with one "Incentives this epoch" caption so each row's figure fits whole;
 * below, a snapping row of type cards that peeks at the edge (`ZqgJOq9aZQ`).
 * Each entry links to `/vote/<type>`, so types preload on hover.
 *
 * Swappable: Vote only depends on `TypeSelectorProps`.
 */

export type TypeSelectorProps = {
  totals: GaugeKindTotals
  active: GaugeKind
}

const coinFor = { vemezo: "MEZO", vebtc: "BTC" } as const

function incentivesLine(usd: string): string {
  return `${formatUsd(usd, "cents")} this epoch`
}

const listCaption = "Incentives this epoch"

function TypeLink({
  kind,
  className,
  children,
}: {
  kind: GaugeKind
  className: string
  children: ReactNode
}): ReactNode {
  return (
    <Link
      to="/vote/$type"
      params={{ type: kind }}
      resetScroll={false}
      viewTransition={false}
      activeOptions={{ includeSearch: false }}
      className={className}
    >
      {children}
    </Link>
  )
}

/** The type icon: the active one turns orange with a cross fade. */
function KindIcon({
  kind,
  current,
  size,
}: {
  kind: GaugeKind
  current: boolean
  size: "row" | "card"
}): ReactNode {
  return (
    <span
      className={`relative grid flex-none place-items-center rounded-full bg-soft2 ${size === "row" ? "size-9" : "size-8"} ${current ? "text-on-acc" : "text-ink2"}`}
    >
      <span
        aria-hidden="true"
        data-mbx-motion=""
        className={`absolute inset-0 rounded-full bg-acc transition-[opacity,scale] duration-300 ease-roll ${current ? "scale-100 opacity-100" : "scale-75 opacity-0"}`}
      />
      <Glyph
        shape={kindShape[kind]}
        size={size === "row" ? 17 : 16}
        className="relative"
      />
    </span>
  )
}

/** A row of the desktop list; the soft fill slides to the active row. */
function TypeRow({
  kind,
  current,
  totals,
}: {
  kind: GaugeKind
  current: boolean
  totals: GaugeKindTotals
}): ReactNode {
  const fill = useRef<HTMLSpanElement | null>(null)
  useSlidingIndicator(fill, "vote-type-list", current)
  return (
    <TypeLink
      kind={kind}
      className="relative isolate flex items-center gap-3 rounded-[16px] px-3 py-2.5 outline-none hover:bg-soft focus-visible:outline-2 focus-visible:outline-ink"
    >
      <span
        ref={fill}
        aria-hidden="true"
        data-mbx-motion=""
        className={`absolute inset-0 -z-10 origin-top-left rounded-[16px] bg-soft ${current ? "" : "invisible"}`}
      />
      <KindIcon kind={kind} current={current} size="row" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">
          {gaugeKinds[kind].label}
        </span>
        <span className="block text-[13px] whitespace-nowrap text-sec tabular-nums">
          {formatUsd(totals[kind].incentivesUsd, "cents")}
          <span className="sr-only"> this epoch</span>
        </span>
      </span>
      <span className="text-[14px] text-sec tabular-nums">
        {groupThousands(BigInt(totals[kind].count))}
      </span>
    </TypeLink>
  )
}

/** A card of the phone row; the soft fill slides to the active card. */
function TypeCard({
  kind,
  coin,
  current,
  totals,
}: {
  kind: GaugeKind
  coin: "MEZO" | "BTC"
  current: boolean
  totals: GaugeKindTotals
}): ReactNode {
  const fill = useRef<HTMLSpanElement | null>(null)
  useSlidingIndicator(fill, "vote-type-row", current)
  return (
    <TypeLink
      kind={kind}
      className={`relative isolate flex h-full flex-col gap-2 rounded-[20px] p-3.5 outline-none focus-visible:outline-2 focus-visible:outline-ink ${current ? "" : "shadow-[inset_0_0_0_1px_var(--line)]"}`}
    >
      <span
        ref={fill}
        aria-hidden="true"
        data-mbx-motion=""
        className={`absolute inset-0 -z-10 origin-top-left rounded-[20px] bg-soft ${current ? "" : "invisible"}`}
      />
      <span className="flex items-center justify-between">
        <KindIcon kind={kind} current={current} size="card" />
        <TokenIcon ticker={coin} size={18} />
      </span>
      <span className="text-[15px] font-semibold">
        {gaugeKinds[kind].label}{" "}
        <span className="font-normal text-sec tabular-nums">
          {groupThousands(BigInt(totals[kind].count))}
        </span>
      </span>
      <span className="text-[13px] text-sec tabular-nums">
        {incentivesLine(totals[kind].incentivesUsd)}
      </span>
    </TypeLink>
  )
}

export function TypeList({ totals, active }: TypeSelectorProps): ReactNode {
  const row = useRef<HTMLUListElement | null>(null)
  const scrolled = useRef(false)

  // The active card scrolls into view on phones: at once on load, smoothly
  // when the type changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs again when the active type changes
  useEffect(() => {
    const element = row.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    )
    if (element === null || element === undefined) return
    const parent = row.current
    if (parent === null || parent.scrollWidth <= parent.clientWidth) return
    parent.scrollTo({
      left: element.offsetLeft - 20,
      behavior:
        scrolled.current && !prefersReducedMotion() ? "smooth" : "instant",
    })
    scrolled.current = true
  }, [active])

  return (
    <nav aria-label="Gauge types">
      <div data-indicator-root="" className="hidden min-[834px]:block">
        <p aria-hidden="true" className="mb-5 px-3 text-[13.5px] text-sec">
          {listCaption}
        </p>
        {escrowGroups.map((group) => (
          <section key={group.escrow} className="not-first-of-type:mt-6">
            <h2 className="px-3 text-[13.5px] text-sec">{group.label}</h2>
            <ul className="mt-1.5 flex flex-col gap-1">
              {group.kinds.map((kind) => (
                <li key={kind}>
                  <TypeRow
                    kind={kind}
                    current={kind === active}
                    totals={totals}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <ul
        ref={row}
        data-indicator-root=""
        className="-mx-5 flex snap-x snap-mandatory scroll-px-5 gap-2.5 overflow-x-auto px-5 [scrollbar-width:none] min-[834px]:hidden"
      >
        {escrowGroups.flatMap((group) =>
          group.kinds.map((kind) => (
            <li key={kind} className="w-[200px] flex-none snap-start">
              <TypeCard
                kind={kind}
                coin={coinFor[group.escrow]}
                current={kind === active}
                totals={totals}
              />
            </li>
          )),
        )}
      </ul>
    </nav>
  )
}
