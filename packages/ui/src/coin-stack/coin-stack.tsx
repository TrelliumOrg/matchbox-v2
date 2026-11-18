import { TokenIcon } from "@matchbox/token-icons"
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"
import { Pop } from "../floating/floating"
import { Glyph, shapes } from "../icons"

/**
 * Coin stack: 28 (headline totals) or 18 (list rows), 5px overlap, a 2px ring
 * in the surface colour. On hover the coins fan apart slightly, then the
 * breakdown popover opens. A USD total never gets a text breakdown.
 */

export type Coin = {
  ticker: string
  src?: string | null
}

export type BreakdownRow = Coin & {
  /** Preformatted amount, for example "0.000672 BTC". */
  amount: string
  /** Preformatted USD, for example "$71.04". */
  usd?: string
}

export type RootProps = {
  coins: readonly Coin[]
  size?: 18 | 28
  /** CSS colour of the surface under the stack, for the ring. */
  surface?: string
  /** Chevron after the stack (headline totals). */
  chevron?: boolean
  /** Rows for the hover popover. Without them the stack is a static image. */
  breakdown?: readonly BreakdownRow[]
  /** Accessible name for the trigger, for example "Claimable breakdown". */
  label?: string
  /** Hide from assistive tech (when a label next to it says the same). */
  decorative?: boolean
  className?: string
}

const closeDelay = 120

function Stack({
  coins,
  size,
  surface,
  fan,
}: {
  coins: readonly Coin[]
  size: number
  surface: string
  fan: boolean
}): ReactNode {
  return (
    <span
      className="inline-flex items-center"
      style={{ "--ring-surface": surface } as CSSProperties}
    >
      {coins.map((coin, index) => (
        <span
          key={coin.ticker}
          data-mbx-motion=""
          className="block flex-none rounded-full shadow-[0_0_0_2px_var(--ring-surface)] transition-transform duration-200 ease-roll [&+&]:-ml-[5px]"
          style={{
            transform: fan ? `translateX(${index * 3}px)` : undefined,
            zIndex: coins.length - index,
          }}
        >
          <TokenIcon ticker={coin.ticker} src={coin.src ?? null} size={size} />
        </span>
      ))}
    </span>
  )
}

export function Root({
  coins,
  size = 18,
  surface = "var(--bg)",
  chevron = false,
  breakdown,
  label,
  decorative = false,
  className,
}: RootProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    },
    [],
  )

  if (breakdown === undefined || breakdown.length === 0) {
    return (
      <span
        role="img"
        aria-hidden={decorative || undefined}
        aria-label={
          decorative
            ? undefined
            : (label ?? coins.map((coin) => coin.ticker).join(", "))
        }
        className={`inline-flex items-center gap-1 ${className ?? ""}`}
      >
        <Stack coins={coins} size={size} surface={surface} fan={false} />
      </span>
    )
  }

  function show(): void {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    setHover(true)
    setOpen(true)
  }

  function hide(): void {
    setHover(false)
    closeTimer.current = setTimeout(() => setOpen(false), closeDelay)
  }

  return (
    <Pop
      open={open}
      onOpenChange={setOpen}
      align="start"
      onContentPointerEnter={show}
      onContentPointerLeave={hide}
      className={className}
      trigger={(disclosure) => (
        <button
          type="button"
          aria-label={label ?? "Token breakdown"}
          {...disclosure}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") show()
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") hide()
          }}
          className="inline-flex cursor-pointer items-center gap-1 rounded-full text-sec outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <Stack
            coins={coins}
            size={size}
            surface={surface}
            fan={hover || open}
          />
          {chevron ? (
            <Glyph
              shape={shapes.chevronDown}
              size={16}
              strokeWidth={2.2}
              className="ml-1"
            />
          ) : null}
        </button>
      )}
      content={
        <ul>
          {breakdown.map((row) => (
            <li
              key={row.ticker}
              className="flex h-[52px] items-center gap-3 px-3"
            >
              <TokenIcon ticker={row.ticker} src={row.src ?? null} size={28} />
              <span className="flex-1 text-[15px] font-semibold tabular-nums">
                {row.amount}
              </span>
              {row.usd === undefined ? null : (
                <span className="text-sm text-sec tabular-nums">{row.usd}</span>
              )}
            </li>
          ))}
        </ul>
      }
    />
  )
}

Root.displayName = "CoinStack"
