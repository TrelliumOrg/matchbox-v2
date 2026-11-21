import { TokenIcon } from "@matchbox/token-icons"
import { Glyph, Icon } from "@matchbox/ui/icons"
import * as Sheet from "@matchbox/ui/sheet"
import type { ReactNode } from "react"
import {
  claimUnpriced,
  claimUsd,
  describeEvent,
} from "../../components/activity-row"
import type { ActivityEvent, TokenAmount } from "../../data/view-models"
import {
  formatDate,
  formatDayTime,
  formatTokenWithSymbol,
  formatUsd,
  groupThousands,
  shortAddress,
} from "../../lib/format"
import { TxLinks } from "../../tx/tx-links"

/**
 * The transaction sheet on Activity: status steps, tokens, where, then
 * Matchscan and Mezo Explorer.
 */

const tokenNames: Record<string, string> = {
  BTC: "Bitcoin",
  MEZO: "Mezo",
  MUSD: "Mezo USD",
}

function Step({
  done,
  title,
  detail,
}: {
  done: boolean
  title: ReactNode
  detail: string
}): ReactNode {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0 [&:not(:last-child)]:before:absolute [&:not(:last-child)]:before:top-6 [&:not(:last-child)]:before:bottom-1 [&:not(:last-child)]:before:left-[11px] [&:not(:last-child)]:before:w-px [&:not(:last-child)]:before:bg-line">
      <span
        className={`grid size-6 flex-none place-items-center rounded-full ${done ? "bg-pos text-bg" : "bg-acc-soft text-acc-ink"}`}
      >
        <Icon name={done ? "check" : "clock"} size={14} strokeWidth={2.6} />
      </span>
      <div>
        <p className="text-[15.5px] font-semibold">{title}</p>
        <p className="text-[14.5px] text-sec tabular-nums">{detail}</p>
      </div>
    </li>
  )
}

/**
 * A token's USD in the sheet: for a claim valued when claimed, its value
 * then ("No price" without one); for one still settling, its estimate;
 * otherwise the row's own figure.
 */
export function tokenValue(
  detail: ActivityEvent["detail"],
  token: TokenAmount,
  index: number,
): string {
  if (detail.kind !== "claim") {
    return token.usd === null ? "" : formatUsd(token.usd, "cents")
  }
  const values = detail.whenClaimed?.tokens ?? detail.estimate?.tokens
  if (values === undefined) {
    return token.usd === null ? "" : formatUsd(token.usd, "cents")
  }
  const usd = claimedValue(values, token, index)?.usd ?? null
  return usd === null ? "No price" : formatUsd(usd, "cents")
}

/**
 * A claimed token's value, by address: they are in the claimed tokens'
 * order, so the one at its index when that is its address, else the one
 * with its address. Never by symbol: anyone can deploy a token named
 * MUSD.
 */
function claimedValue<Value extends { token: string }>(
  values: readonly Value[],
  token: TokenAmount,
  index: number,
): Value | undefined {
  const address = token.token?.toLowerCase() ?? null
  const at = values[index]
  if (address === null || at?.token === address) return at
  return values.find((each) => each.token === address) ?? at
}

/**
 * The claim as the sheet shows it at `nowSeconds`: an estimate whose day to
 * be final has passed (a stored row the fill has not reached) is dropped,
 * so the claim reads pending, never "final by" a past date.
 */
export function shownDetail(
  detail: ActivityEvent["detail"],
  nowSeconds: number,
): ActivityEvent["detail"] {
  if (detail.kind !== "claim" || detail.estimate === undefined) return detail
  // `finalOn` is 00:00 UTC of its day: passed once that day is over.
  if (detail.estimate.finalOn + 86_400 > nowSeconds) return detail
  const { estimate: _estimate, ...rest } = detail
  return rest
}

/** Under a claim's figure: final, an estimate until a day, or pending. */
function claimNote(
  detail: Extract<ActivityEvent["detail"], { kind: "claim" }>,
): string {
  if (detail.whenClaimed !== undefined) return "Value when claimed"
  if (detail.estimate !== undefined) {
    return `Estimate, final by ${formatDate(detail.estimate.finalOn)}`
  }
  return "Value when claimed pending"
}

/** Stays mounted on the last event while closed, so it slides out. */
export default function ActivitySheet({
  event,
  open,
  onClose,
  nowSeconds = Math.floor(Date.now() / 1000),
}: {
  event: ActivityEvent
  open: boolean
  onClose: () => void
  /** Overrides the clock in tests. */
  nowSeconds?: number
}): ReactNode {
  const detail = shownDetail(event.detail, nowSeconds)
  const parts = describeEvent({ ...event, detail }, "summary")
  const tokens =
    detail.kind === "claim"
      ? detail.tokens
      : detail.kind === "lock" || detail.kind === "incentive"
        ? [detail.amount]
        : []
  return (
    <Sheet.Root open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <Sheet.Content>
        <Sheet.Header>
          <span className="sr-only">{parts.title}</span>
        </Sheet.Header>
        <Sheet.Body>
          <span className="grid size-16 place-items-center rounded-full bg-soft text-ink dark:bg-soft2">
            <Glyph shape={parts.icon} size={24} strokeWidth={1.8} />
          </span>
          <p className="mt-5 text-[15px] text-sec">{parts.title}</p>
          <p
            className={`mt-1 text-[44px] leading-[1.1] font-[650] tracking-[-0.025em] tabular-nums ${parts.struck ? "text-mut line-through" : parts.muted ? "text-sec" : ""}`}
          >
            {detail.kind === "claim"
              ? claimUnpriced(detail.whenClaimed)
                ? "No price"
                : `+${formatUsd(claimUsd(detail), "cents")}`
              : parts.main}
          </p>
          {detail.kind === "claim" ? (
            <p className="mt-1 text-[15px] text-sec">{claimNote(detail)}</p>
          ) : null}
          <p className="mt-2 text-[15px] text-sec">{formatDayTime(event.at)}</p>
          <h3 className="mt-9 text-[17px] font-semibold">Status</h3>
          <ol className="mt-4">
            <Step done title="Submitted" detail={formatDayTime(event.at)} />
            {event.status === "reverted" ? (
              <Step
                done={false}
                title="Reverted"
                detail={formatDayTime(event.at)}
              />
            ) : event.block === null ? (
              <Step
                done={false}
                title="Confirming"
                detail="Waiting for a block"
              />
            ) : (
              <>
                <Step
                  done
                  title={
                    <a
                      href={`https://scan.matchbox.markets/block/${event.block}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline underline-offset-[3px]"
                    >
                      Block {groupThousands(BigInt(event.block))}
                    </a>
                  }
                  detail={formatDayTime(event.at)}
                />
                <Step done title="Confirmed" detail={formatDayTime(event.at)} />
              </>
            )}
          </ol>
          {tokens.length === 0 ? null : (
            <>
              <h3 className="mt-9 text-[17px] font-semibold">Tokens</h3>
              <ul className="mt-3">
                {tokens.map((token, index) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, and one claim can name an address twice: the index tells them apart.
                    key={`${token.token ?? token.symbol}-${index}`}
                    className="flex items-center gap-4 py-2.5"
                  >
                    <TokenIcon ticker={token.symbol} size={44} />
                    <div className="flex-1">
                      <p className="text-base font-semibold">
                        {tokenNames[token.symbol] ?? token.symbol}
                      </p>
                      <p className="text-[14.5px] text-sec tabular-nums">
                        {formatTokenWithSymbol(token.amount, token.symbol)}
                      </p>
                    </div>
                    <p className="text-base font-semibold tabular-nums">
                      {tokenValue(detail, token, index)}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
          <dl className="mt-6 flex flex-col gap-3 rounded-[20px] bg-soft p-5 text-[15px] dark:bg-soft2">
            {detail.kind === "claim" ? (
              <>
                {detail.whenClaimed === undefined ? null : (
                  <div className="flex justify-between gap-4">
                    <dt className="text-sec">Priced at</dt>
                    <dd className="tabular-nums">
                      {formatDate(detail.whenClaimed.pricedAt)}, 00:00 UTC
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <dt className="text-sec">Locks</dt>
                  <dd>
                    {detail.locks.map((lock) => `#${lock.tokenId}`).join(", ")}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-sec">Gauges</dt>
                  <dd className="text-right">{detail.gauges.join(", ")}</dd>
                </div>
              </>
            ) : null}
            <div className="flex justify-between gap-4">
              <dt className="text-sec">Transaction</dt>
              <dd className="font-medium tabular-nums">
                {shortAddress(event.tx)}
              </dd>
            </div>
          </dl>
          <TxLinks hash={event.tx} className="mt-7" />
        </Sheet.Body>
      </Sheet.Content>
    </Sheet.Root>
  )
}
