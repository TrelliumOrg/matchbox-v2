import { AnimatedNumber, duration, useReducedMotion } from "@matchbox/motion"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import { Tip } from "../floating/floating"

/**
 * Block ticker (Live tickers `ZxcFhQWGoD`): a 12px ring (orange arc on a soft2
 * track) filling over the 3.8s block time, then the number in DM Mono 12.5.
 * On each block only the changed digits roll and the number shows in ink for
 * 450ms. After 30s with no block: dashed ring, muted number.
 *
 * The ring fills with two clipped half arcs that rotate, so the animation is
 * transform only.
 */

export type RootProps = {
  block: number
  /** When this block arrived, in ms since the epoch. */
  receivedAt: number
  /** Matchscan link for the block. */
  href?: string
  blockTime?: number
  staleAfter?: number
  /** "corner" fixes it bottom right of the window (Pro desktop). */
  placement?: "inline" | "corner"
  className?: string
}

function seconds(ms: number): number {
  return Math.max(0, Math.floor(ms / 1000))
}

export function Ring({
  block,
  blockTime,
  stale,
}: {
  block: number
  blockTime: number
  stale: boolean
}): ReactNode {
  const reduced = useReducedMotion()
  const id = useId().replace(/:/g, "")
  const half = `${blockTime / 2}ms`
  const arc = "M6 1A5 5 0 0 0 6 11"
  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden="true"
      className="flex-none"
    >
      <defs>
        <clipPath id={`mbx-ring-r-${id}`}>
          <rect x="6" y="0" width="6" height="12" />
        </clipPath>
        <clipPath id={`mbx-ring-l-${id}`}>
          <rect x="0" y="0" width="6" height="12" />
        </clipPath>
      </defs>
      <circle
        cx="6"
        cy="6"
        r="5"
        fill="none"
        stroke="var(--soft2)"
        strokeWidth="1.6"
        strokeDasharray={stale ? "2 2.2" : undefined}
      />
      {stale ? null : reduced ? (
        <circle
          cx="6"
          cy="6"
          r="5"
          fill="none"
          stroke="var(--acc)"
          strokeWidth="1.6"
        />
      ) : (
        <g key={block} fill="none" stroke="var(--acc)" strokeWidth="1.6">
          <g clipPath={`url(#mbx-ring-r-${id})`}>
            <path
              d={arc}
              data-mbx-motion=""
              className="[transform-box:view-box] [transform-origin:6px_6px]"
              style={{ animation: `mbx-ring-a ${half} linear forwards` }}
            />
          </g>
          <g clipPath={`url(#mbx-ring-l-${id})`}>
            <path
              d={arc}
              data-mbx-motion=""
              className="[transform-box:view-box] [transform-origin:6px_6px]"
              style={{ animation: `mbx-ring-b ${half} linear ${half} both` }}
            />
          </g>
        </g>
      )}
    </svg>
  )
}

Ring.displayName = "BlockTicker.Ring"

export function Root({
  block,
  receivedAt,
  href,
  blockTime = duration.block,
  staleAfter = 30_000,
  placement = "inline",
  className,
}: RootProps): ReactNode {
  const [now, setNow] = useState(() => receivedAt)
  const [tipOpen, setTipOpen] = useState(false)
  const [fresh, setFresh] = useState(false)
  const [stale, setStale] = useState(false)
  const firstBlock = useRef(block)

  useEffect(() => {
    if (block === firstBlock.current) return
    setFresh(true)
    const timer = setTimeout(() => setFresh(false), duration.inkHold)
    return () => clearTimeout(timer)
  }, [block])

  useEffect(() => {
    setStale(false)
    const wait = receivedAt + staleAfter - Date.now()
    const timer = setTimeout(() => setStale(true), Math.max(0, wait))
    return () => clearTimeout(timer)
  }, [receivedAt, staleAfter])

  useEffect(() => {
    if (!tipOpen && !stale) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [tipOpen, stale])

  const age = seconds(now - receivedAt)
  const tone = stale ? "text-mut" : fresh ? "text-ink" : "text-sec"
  const content = (
    <>
      <Ring block={block} blockTime={blockTime} stale={stale} />
      <AnimatedNumber value={block} trend={1} format={{ useGrouping: true }} />
    </>
  )
  const classes = `inline-flex items-center gap-2 font-mono text-[12.5px] leading-none tabular-nums outline-none focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${tone} ${
    // In the corner, rows scroll under it: a backing keeps both legible.
    placement === "corner"
      ? "rounded-full bg-bg/85 px-2.5 py-1.5 backdrop-blur-sm"
      : ""
  } ${className ?? ""}`
  const label = stale ? `No new block for ${age}s` : `Latest block ${block}`

  return (
    <Tip
      open={tipOpen}
      onOpenChange={setTipOpen}
      side="top"
      align="end"
      className={placement === "corner" ? "fixed right-4 bottom-3.5 z-30" : ""}
      trigger={(tip) =>
        href === undefined ? (
          <span
            role="img"
            aria-label={label}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need the tooltip
            tabIndex={0}
            className={classes}
            {...tip}
          >
            {content}
          </span>
        ) : (
          <a
            href={href}
            aria-label={`${label}, view on Matchscan`}
            className={classes}
            {...tip}
          >
            {content}
          </a>
        )
      }
      content={
        stale ? (
          <>
            <span className="block font-semibold">No new block for {age}s</span>
            <span className="block opacity-85">Retrying</span>
          </>
        ) : (
          <>
            <span className="block font-semibold">
              Latest block, {age}s ago
            </span>
            {href === undefined ? null : (
              <span className="block underline opacity-85">
                View on Matchscan
              </span>
            )}
          </>
        )
      }
    />
  )
}

Root.displayName = "BlockTicker"
