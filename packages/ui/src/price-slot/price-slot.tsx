import { MorphText, useReducedMotion } from "@matchbox/motion"
import { TokenIcon } from "@matchbox/token-icons"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Pop } from "../floating/floating"
import { Glyph, shapes } from "../icons"

/**
 * Price slot (Live tickers `ZxcFhQWGoD`): one 40px slot cycling MEZO, BTC and
 * the epoch every 4s with a 380ms slide up. Hover or focus pauses it; hover
 * or tap opens the popover with all three plus 24h change (and the block row
 * on phones). Reduced motion shows the epoch only. A missing price is skipped.
 * `compact` (phones) cycles the prices only; the epoch stays in the popover.
 */

export type Price = {
  /** Preformatted, for example "$0.184". Morphs digit by digit on change. */
  price: string
  /** Preformatted 24h change, for example "-2.4%"; null when unknown (hidden, never "0.0%"). */
  change: string | null
  trend: "up" | "down"
}

export type Epoch = {
  /** "Epoch 47" */
  label: string
  /** "3d 12h" */
  remaining: string
}

export type RootProps = {
  mezo: Price | null
  btc: Price | null
  epoch: Epoch
  /** The block row, for phones where the corner ticker has no room. */
  block?: ReactNode
  /** Phones: cycle MEZO and BTC only, so the slot fits beside the logo. */
  compact?: boolean
  /**
   * Classes for the epoch item in the slot (not the popover). Pro passes
   * `max-md:hidden` so the server's HTML already has the phone width:
   * `compact` comes from a media query only after hydration.
   */
  epochClassName?: string
  /** Cycle interval in ms. */
  interval?: number
  /** Classes for the button. */
  className?: string
  /**
   * Classes for the wrapper that is the flex item in a header. Phones pass
   * `min-w-0` (with `min-w-0` on the button) so the slot clips before the
   * header overflows: the button's own `min-w-0` cannot shrink the wrapper.
   */
  rootClassName?: string
}

type Item =
  | { kind: "price"; ticker: "MEZO" | "BTC"; value: Price }
  | { kind: "epoch"; value: Epoch }

function ClockCoin({ size }: { size: 22 | 28 }): ReactNode {
  return (
    <span
      className="grid flex-none place-items-center rounded-full bg-soft2 text-ink2"
      style={{ width: size, height: size }}
    >
      <Glyph shape={shapes.clock} size={size === 22 ? 14 : 17} />
    </span>
  )
}

/** No chevron (decided 9 Nov): hover and tap still open the popover. */
function SlotItem({ item }: { item: Item }): ReactNode {
  if (item.kind === "epoch") {
    return (
      <>
        <ClockCoin size={22} />
        <span className="font-medium text-sec">{item.value.label}</span>
        {item.value.remaining}
      </>
    )
  }
  return (
    <>
      <TokenIcon ticker={item.ticker} size={22} />
      <MorphText as="span">{item.value.price}</MorphText>
    </>
  )
}

export function Root({
  mezo,
  btc,
  epoch,
  block,
  compact = false,
  epochClassName = "",
  interval = 4000,
  className,
  rootClassName,
}: RootProps): ReactNode {
  const reduced = useReducedMotion()
  const items: Item[] = [
    ...(mezo === null
      ? []
      : [{ kind: "price", ticker: "MEZO", value: mezo } as const]),
    ...(btc === null
      ? []
      : [{ kind: "price", ticker: "BTC", value: btc } as const]),
    { kind: "epoch", value: epoch },
  ]
  const prices = items.filter((item) => item.kind === "price")
  const cycling = compact && prices.length > 0 ? prices : items
  const [cycle, setCycle] = useState<{
    active: number
    leaving: number | null
  }>({ active: 0, leaving: null })
  const { active, leaving } = cycle
  const [paused, setPaused] = useState(false)
  const [open, setOpen] = useState(false)
  const count = cycling.length
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (reduced || paused || open || count < 2) return
    timer.current = setInterval(() => {
      setCycle((current) => ({
        active: (current.active + 1) % count,
        leaving: current.active,
      }))
    }, interval)
    return () => {
      if (timer.current !== null) clearInterval(timer.current)
    }
  }, [reduced, paused, open, count, interval])

  const shown = reduced ? count - 1 : Math.min(active, count - 1)
  const summary = items
    .map((item) =>
      item.kind === "epoch"
        ? `${item.value.label} ${item.value.remaining}`
        : `${item.ticker} ${item.value.price}`,
    )
    .join(", ")

  return (
    <Pop
      open={open}
      onOpenChange={setOpen}
      align="end"
      className={rootClassName}
      onContentPointerLeave={(event) => {
        if (event.pointerType === "mouse") setOpen(false)
      }}
      trigger={(disclosure) => (
        <button
          type="button"
          aria-label={summary}
          {...disclosure}
          onPointerEnter={(event) => {
            setPaused(true)
            if (event.pointerType === "mouse") setOpen(true)
          }}
          onPointerLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
          className={`inline-flex h-10 flex-none cursor-pointer items-center rounded-[20px] px-2.5 text-[15px] font-semibold whitespace-nowrap text-ink tabular-nums outline-none hover:text-ink2 focus-visible:outline-2 focus-visible:outline-ink ${className ?? ""}`}
        >
          <span
            aria-hidden="true"
            className="relative grid h-10 items-center overflow-hidden"
          >
            {cycling.map((item, index) => {
              const isShown = index === shown
              const isLeaving = !reduced && index === leaving && !isShown
              return (
                <span
                  key={item.kind === "epoch" ? "epoch" : item.ticker}
                  data-mbx-motion=""
                  onAnimationEnd={() => {
                    if (isLeaving) {
                      setCycle((current) => ({ ...current, leaving: null }))
                    }
                  }}
                  className={`flex items-center gap-2.5 justify-self-end [grid-area:1/1] ${item.kind === "epoch" ? epochClassName : ""} ${
                    isShown
                      ? leaving === null
                        ? ""
                        : "animate-[mbx-slot-in_380ms_var(--ease-roll)_both]"
                      : isLeaving
                        ? "animate-[mbx-slot-out_380ms_var(--ease-roll)_both]"
                        : "invisible"
                  }`}
                >
                  <SlotItem item={item} />
                </span>
              )
            })}
          </span>
        </button>
      )}
      content={
        <>
          <ul className="tabular-nums">
            {items.map((item) => (
              <li
                key={item.kind === "epoch" ? "epoch" : item.ticker}
                className="flex h-[52px] items-center gap-3 px-3"
              >
                {item.kind === "epoch" ? (
                  <>
                    <ClockCoin size={28} />
                    <span className="flex-1 text-[15px] font-semibold">
                      {item.value.label}
                    </span>
                    <span className="text-sm font-semibold">
                      {item.value.remaining}
                    </span>
                  </>
                ) : (
                  <>
                    <TokenIcon ticker={item.ticker} size={28} />
                    <span className="flex-1 text-[15px] font-semibold">
                      {item.value.price}
                    </span>
                    {item.value.change === null ? null : (
                      <span
                        className={`text-sm font-semibold ${item.value.trend === "up" ? "text-pos" : "text-neg"}`}
                      >
                        {item.value.change}
                      </span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          {block === undefined ? null : (
            <>
              <div className="mx-3 my-1 h-px bg-line" />
              <div className="flex items-center justify-between px-3 pt-3 pb-2.5">
                {block}
              </div>
            </>
          )}
        </>
      }
    />
  )
}

Root.displayName = "PriceSlot"
