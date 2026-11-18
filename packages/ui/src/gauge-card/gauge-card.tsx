import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"
import { Glyph, shapes } from "../icons"
import * as Slot from "../slot"

/**
 * Gauge card (Vote `YfjCVNBQNy`): 52px picture, name 17/650 with a grey id,
 * one-line tagline, APY 22/650, incentive coins plus dollars, veBTC weight,
 * then the 48px labelled band. The whole card opens the gauge: the name is
 * the card's one link (`Name`), stretched over the card, and the check
 * button above it is the ballot control.
 *
 * Compact: inside an element with `data-gauge-view="compact"` (Pro sets it
 * on <html> before first paint), the same markup lays out as one 48px row:
 * picture, name and type, votes, APY, incentives and the check. CSS only,
 * so the server HTML is the same for every reader and nothing moves when
 * the setting is read.
 *
 * Motion is transform and opacity only: the orange ring fades in, the check
 * pops, the band fill grows with scaleX.
 */

export type RootProps = {
  picked: boolean
  onPickedChange: (picked: boolean) => void
  /** Gauge name, for the check button's label. */
  name: string
  /** No voting power: the check is dashed and does nothing. */
  disabled?: boolean
  /** Expired gauges: quieter text, no promotion. */
  muted?: boolean
  children: ReactNode
  className?: string
}

export function Root({
  picked,
  onPickedChange,
  name,
  disabled = false,
  muted = false,
  children,
  className,
}: RootProps): ReactNode {
  const [peek, setPeek] = useState(false)
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (peekTimer.current !== null) clearTimeout(peekTimer.current)
    },
    [],
  )

  return (
    <article
      data-picked={picked}
      data-peek={peek || undefined}
      // A tap shows the band's hover line for a moment (no hover on touch).
      onPointerDown={(event) => {
        if (event.pointerType !== "touch") return
        if (peekTimer.current !== null) clearTimeout(peekTimer.current)
        setPeek(true)
        peekTimer.current = setTimeout(() => setPeek(false), 2400)
      }}
      data-muted={muted || undefined}
      className={`group/gauge relative flex flex-col overflow-hidden rounded-[24px] bg-soft text-ink tabular-nums shadow-[inset_0_0_0_1px_var(--edge)] transition-shadow duration-150 data-[muted]:text-ink2 has-[[data-card-link]:hover]:shadow-[inset_0_0_0_1.5px_var(--mut)] has-[[data-card-link]:focus-visible]:outline-2 has-[[data-card-link]:focus-visible]:outline-offset-2 has-[[data-card-link]:focus-visible]:outline-ink in-data-[gauge-view=compact]:flex-row in-data-[gauge-view=compact]:items-center in-data-[gauge-view=compact]:rounded-[16px] ${className ?? ""}`}
    >
      {children}
      <span
        aria-hidden="true"
        data-mbx-motion=""
        className="pointer-events-none absolute inset-0 z-10 rounded-[24px] opacity-0 shadow-[inset_0_0_0_2px_var(--acc)] transition-opacity duration-200 ease-roll group-data-[picked=true]/gauge:opacity-100 in-data-[gauge-view=compact]:rounded-[16px]"
      />
      <button
        type="button"
        aria-pressed={picked}
        aria-label={
          disabled
            ? `${name}, no voting power`
            : picked
              ? `Remove ${name} from ballot`
              : `Add ${name} to ballot`
        }
        disabled={disabled}
        onClick={() => onPickedChange(!picked)}
        data-tap=""
        className={`absolute top-[18px] right-[18px] z-20 grid size-7 cursor-pointer place-items-center rounded-full border-2 text-on-acc outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-default in-data-[gauge-view=compact]:top-1/2 in-data-[gauge-view=compact]:right-3.5 in-data-[gauge-view=compact]:-translate-y-1/2 ${
          disabled
            ? "border-dashed border-dash bg-transparent"
            : "border-dash bg-raised"
        }`}
      >
        <span
          aria-hidden="true"
          data-mbx-motion=""
          className={`absolute -inset-0.5 rounded-full bg-acc transition-[opacity,scale] duration-200 ease-roll ${picked ? "scale-100 opacity-100" : "scale-50 opacity-0"}`}
        />
        <span
          data-mbx-motion=""
          className={`relative grid transition-opacity duration-150 ease-out ${picked ? "opacity-100" : "opacity-0"}`}
        >
          <Glyph
            key={picked ? "picked" : "unpicked"}
            shape={shapes.check}
            size={15}
            strokeWidth={2.8}
            className={picked ? "mbx-draw" : undefined}
          />
        </span>
      </button>
    </article>
  )
}

Root.displayName = "GaugeCard"

/** True while the reader has text selected inside `element`'s card. */
function selectingIn(element: Element): boolean {
  const selection = typeof window === "undefined" ? null : window.getSelection()
  if (selection === null || selection.isCollapsed) return false
  const card = element.closest("article")
  const anchor = selection.anchorNode
  return card !== null && anchor !== null && card.contains(anchor)
}

/**
 * The card's one link (pass the router's link with `asChild`): the gauge's
 * name, stretched over the whole card so a click anywhere on it opens the
 * gauge, a middle click opens it in a new tab and the context menu offers
 * the link. The check button sits above it. A click that ends a text
 * selection inside the card does not navigate.
 */
export function Name({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): ReactNode {
  return (
    <Slot.Root
      data-card-link=""
      draggable={false}
      onClick={(event: MouseEvent<HTMLElement>) => {
        if (selectingIn(event.currentTarget)) event.preventDefault()
      }}
      className={`rounded-sm decoration-[1.5px] underline-offset-[3px] outline-none after:absolute after:inset-0 after:z-[1] after:content-[''] group-hover/gauge:underline ${className ?? ""}`}
    >
      {children}
    </Slot.Root>
  )
}

Name.displayName = "GaugeCard.Name"

export function Body({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-1 flex-col px-5 pt-5 pb-[18px] in-data-[gauge-view=compact]:min-w-0 in-data-[gauge-view=compact]:flex-row in-data-[gauge-view=compact]:flex-wrap in-data-[gauge-view=compact]:items-center in-data-[gauge-view=compact]:gap-x-5 in-data-[gauge-view=compact]:gap-y-1 in-data-[gauge-view=compact]:py-1.5 in-data-[gauge-view=compact]:pr-14 in-data-[gauge-view=compact]:pl-3">
      {children}
    </div>
  )
}

Body.displayName = "GaugeCard.Body"

export type HeadProps = {
  picture: ReactNode
  /** The name: a `Name` holding the router link to the profile. */
  name: ReactNode
  /**
   * Grey text after the name: the lock id ("#7") or the pool type
   * ("CL200"). Hidden from screen readers: put it in the name link too.
   */
  id?: string | null
  /** The gauge type icon with its tooltip (a PropertyIcon). */
  icon?: ReactNode
  /** A real state chip ("Expired"), never decoration. */
  state?: string | null
  /** Tagline or short address. */
  subline: ReactNode
}

/**
 * The grey id gives way first: when name and id do not fit, the id wraps
 * onto a clipped second line, so the name keeps its room and an id is
 * never shown cut. Only a name too long on its own truncates.
 */
export function Head({
  picture,
  name,
  id,
  icon,
  state,
  subline,
}: HeadProps): ReactNode {
  return (
    <div className="flex items-center gap-3.5 pr-10 in-data-[gauge-view=compact]:min-w-[11rem] in-data-[gauge-view=compact]:flex-1 in-data-[gauge-view=compact]:gap-3 in-data-[gauge-view=compact]:pr-0">
      <span className="flex flex-none in-data-[gauge-view=compact]:[zoom:0.5385]">
        {picture}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-[17px] font-[650] tracking-[-0.01em] in-data-[gauge-view=compact]:text-[15.5px]">
          <span className="flex h-[1lh] min-w-0 flex-wrap items-baseline gap-x-1.5 overflow-hidden">
            <span className="min-w-0 max-w-full truncate">{name}</span>
            {id === undefined || id === null ? null : (
              <span
                // The name link carries it for screen readers.
                aria-hidden="true"
                className="text-[15px] font-medium whitespace-nowrap text-mut in-data-[gauge-view=compact]:text-[14px]"
              >
                {id}
              </span>
            )}
          </span>
          {icon === undefined ? null : (
            <span className="flex flex-none">{icon}</span>
          )}
          {state === undefined || state === null ? null : (
            <span className="flex-none rounded-full bg-soft2 px-2 py-0.5 text-[12.5px] font-semibold tracking-normal text-sec">
              {state}
            </span>
          )}
        </p>
        <p className="mt-0.5 truncate text-[14.5px] text-sec in-data-[gauge-view=compact]:hidden">
          {subline}
        </p>
      </div>
    </div>
  )
}

Head.displayName = "GaugeCard.Head"

export type FiguresProps = {
  /** APY figure (AnimatedNumber) or null for "No incentives". */
  apy: ReactNode | null
  /** Shows the down arrow while picked: APY drops as you add votes. */
  apyFalling?: boolean
  incentives: ReactNode
  /** Coin stack before the dollars. */
  coins?: ReactNode
}

export function Figures({
  apy,
  apyFalling = false,
  incentives,
  coins,
}: FiguresProps): ReactNode {
  if (apy === null) {
    return (
      <p className="mt-[18px] flex min-h-7 items-center text-[17px] font-medium text-mut in-data-[gauge-view=compact]:mt-0 in-data-[gauge-view=compact]:min-h-0 in-data-[gauge-view=compact]:w-[15.5rem] in-data-[gauge-view=compact]:max-sm:w-auto in-data-[gauge-view=compact]:justify-end in-data-[gauge-view=compact]:text-[15px]">
        No incentives
      </p>
    )
  }
  return (
    <div className="mt-[18px] flex min-h-7 items-center justify-between gap-3 in-data-[gauge-view=compact]:mt-0 in-data-[gauge-view=compact]:min-h-0 in-data-[gauge-view=compact]:gap-5">
      <p className="flex items-center text-[22px] font-[650] tracking-[-0.015em] in-data-[gauge-view=compact]:w-24 in-data-[gauge-view=compact]:max-sm:w-auto in-data-[gauge-view=compact]:justify-end in-data-[gauge-view=compact]:text-[15.5px] in-data-[gauge-view=compact]:tracking-normal">
        {apy}
        {apyFalling ? (
          <span
            aria-hidden="true"
            data-mbx-motion=""
            className="ml-0.5 inline-grid animate-[mbx-fade-in_200ms_ease-out] text-acc-ink"
          >
            <Glyph shape={shapes.arrowDown} size={15} strokeWidth={2.6} />
          </span>
        ) : null}
        <span className="ml-1.5 text-sm font-medium tracking-normal text-sec in-data-[gauge-view=compact]:ml-1 in-data-[gauge-view=compact]:text-[13px]">
          APY
        </span>
      </p>
      <p className="flex items-center gap-2 text-[17px] font-semibold in-data-[gauge-view=compact]:w-[8.25rem] in-data-[gauge-view=compact]:max-sm:w-auto in-data-[gauge-view=compact]:justify-end in-data-[gauge-view=compact]:text-[15px]">
        {coins}
        {incentives}
      </p>
    </div>
  )
}

Figures.displayName = "GaugeCard.Figures"

/**
 * Votes on the gauge with their unit ("1.20M veMEZO"). Compact rows only:
 * the comfortable card shows a boost gauge's votes in its band.
 */
export function Votes({ children }: { children: ReactNode }): ReactNode {
  return (
    <p className="hidden text-[15px] whitespace-nowrap text-ink2 in-data-[gauge-view=compact]:flex in-data-[gauge-view=compact]:w-[7.5rem] in-data-[gauge-view=compact]:justify-end in-data-[gauge-view=compact]:max-sm:w-auto">
      {children}
    </p>
  )
}

Votes.displayName = "GaugeCard.Votes"

export function Weight({ children }: { children: ReactNode }): ReactNode {
  return (
    <p className="mt-2.5 flex items-center gap-1.5 text-sm text-sec in-data-[gauge-view=compact]:hidden">
      <Glyph shape={shapes.lock} size={15} strokeWidth={2} />
      {children}
    </p>
  )
}

Weight.displayName = "GaugeCard.Weight"

export function Note({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex h-12 flex-none items-center bg-soft2 px-5 text-[14.5px] font-semibold text-sec in-data-[gauge-view=compact]:hidden">
      {children}
    </div>
  )
}

Note.displayName = "GaugeCard.Note"
