import { TokenIcon } from "@matchbox/token-icons"
import * as Field from "@matchbox/ui/field"
import { type ReactNode, useEffect, useState } from "react"
import type { LockKind } from "../../data/view-models"
import { formatToken, formatUsd } from "../../lib/format"
import { toDecimal } from "../amounts"

/** Shared pieces of the transaction forms. */

/** One chain read for a form, rerun when `key` changes. null until it lands. */
export function useChainRead<T>(
  key: string,
  read: () => Promise<T>,
): { data: T | null; failed: boolean } {
  const [state, setState] = useState<{
    key: string
    data: T | null
    failed: boolean
  }>({ key, data: null, failed: false })
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key names the read
  useEffect(() => {
    let live = true
    read().then(
      (data) => {
        if (live) setState({ key, data, failed: false })
      },
      () => {
        if (live) setState({ key, data: null, failed: true })
      },
    )
    return () => {
      live = false
    }
  }, [key])
  return state.key === key
    ? { data: state.data, failed: state.failed }
    : { data: null, failed: false }
}

const tabClass: Record<LockKind | "expired", string> = {
  vebtc: "bg-acc text-on-acc",
  vemezo: "bg-mezo text-on-mezo",
  expired: "bg-tab-off text-on-tab-off",
}

/** A small lock card: the coloured tab and a few rows (sheets `EmAMfb9C92`). */
export function LockPreview({
  kind,
  title,
  amount,
  aside,
  sub,
  rows = [],
  compact = false,
}: {
  kind: LockKind | "expired"
  title: string
  amount: ReactNode
  aside?: ReactNode
  /** Under the amount, for example its USD value. */
  sub?: ReactNode
  rows?: { label: string; value: ReactNode }[]
  compact?: boolean
}): ReactNode {
  const symbol = kind === "vebtc" ? "BTC" : "MEZO"
  return (
    <article className="overflow-hidden rounded-[20px] bg-soft tabular-nums dark:bg-soft2">
      <div
        className={`flex items-center justify-between px-4 font-[650] ${compact ? "h-[42px] text-[14.5px]" : "h-[46px] text-[15px]"} ${tabClass[kind]}`}
      >
        <span>{title}</span>
        <span className="block rounded-full shadow-[0_0_0_2px_var(--coinRing)]">
          <TokenIcon ticker={symbol} size={20} />
        </span>
      </div>
      <div className={compact ? "px-4 py-3" : "px-4 py-3.5"}>
        <div className="flex items-baseline justify-between gap-3">
          <p
            className={`font-[650] ${compact ? "text-[16px]" : "text-[18px]"}`}
          >
            {amount}
          </p>
          {aside === undefined ? null : (
            <p className="text-[14px] text-sec">{aside}</p>
          )}
        </div>
        {sub === undefined ? null : (
          <p className="text-[14.5px] text-sec">{sub}</p>
        )}
        {rows.length === 0 ? null : (
          <dl className="mt-2.5 flex flex-col gap-1.5 text-[14.5px]">
            {rows.map((row) => (
              <div key={row.label} className="flex justify-between gap-3">
                <dt className="text-sec">{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </article>
  )
}

/** Places a typed amount may carry: BTC to the satoshi, others to cents. */
export function inputPlaces(symbol: string): number {
  return symbol === "BTC" ? 8 : 2
}

/** Cuts a decimal string to `places` without rounding up past a balance. */
export function truncate(value: string, places: number): string {
  const [int = "0", fraction = ""] = value.split(".")
  const kept = fraction.slice(0, places).replace(/0+$/, "")
  return kept === "" ? int : `${int}.${kept}`
}

/** The amount box with balance and Max (Components frame field). */
export function AmountField({
  label,
  symbol,
  value,
  onValueChange,
  balance,
  decimals,
  usd,
  error,
}: {
  label: string
  symbol: string
  value: string
  onValueChange: (value: string) => void
  /** Base units; null while it loads. */
  balance: bigint | null
  decimals: number
  usd: string | null
  error: string | null
}): ReactNode {
  return (
    <Field.Root invalid={error !== null}>
      <Field.Box>
        <div className="min-w-0 flex-1">
          <Field.Label>{label}</Field.Label>
          <Field.Input
            value={value}
            onValueChange={onValueChange}
            decimals={inputPlaces(symbol)}
          />
          {usd === null ? null : (
            <p className="text-[14px] text-sec tabular-nums">
              {formatUsd(usd, "cents")}
            </p>
          )}
        </div>
        <span className="ml-auto flex h-[46px] flex-none items-center gap-[9px] rounded-[23px] bg-soft pr-4 pl-[7px] text-base font-[650]">
          <TokenIcon ticker={symbol} size={32} />
          {symbol}
        </span>
      </Field.Box>
      <Field.Balance>
        <span>
          Balance{" "}
          {balance === null
            ? "…"
            : `${formatToken(toDecimal(balance, decimals), symbol)} ${symbol}`}
        </span>
        {balance === null ? null : (
          <Field.Max
            onClick={() =>
              onValueChange(
                truncate(toDecimal(balance, decimals), inputPlaces(symbol)),
              )
            }
          />
        )}
      </Field.Balance>
      <Field.Error>{error}</Field.Error>
    </Field.Root>
  )
}
