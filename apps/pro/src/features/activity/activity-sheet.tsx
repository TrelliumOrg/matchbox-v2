import { TokenIcon } from "@matchbox/token-icons"
import { Glyph, Icon } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import * as Sheet from "@matchbox/ui/sheet"
import type { ReactNode } from "react"
import { describeEvent } from "../../components/activity-row"
import type { ActivityEvent } from "../../data/view-models"
import {
  formatDayTime,
  formatTokenWithSymbol,
  formatUsd,
  groupThousands,
  shortAddress,
} from "../../lib/format"

/** The transaction sheet on Activity: status steps, tokens, where, Matchscan. */

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

/** Stays mounted on the last event while closed, so it slides out. */
export default function ActivitySheet({
  event,
  open,
  onClose,
}: {
  event: ActivityEvent
  open: boolean
  onClose: () => void
}): ReactNode {
  const parts = describeEvent(event, "summary")
  const detail = event.detail
  const tokens =
    detail.kind === "claim"
      ? detail.tokens
      : detail.kind === "lock" || detail.kind === "incentive"
        ? [detail.amount]
        : []
  const scan = `https://scan.matchbox.markets/tx/${event.tx}`
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
            className={`mt-1 text-[44px] leading-[1.1] font-[650] tracking-[-0.025em] tabular-nums ${parts.struck ? "text-mut line-through" : ""}`}
          >
            {detail.kind === "claim"
              ? `+${formatUsd(detail.usd, "cents")}`
              : parts.main}
          </p>
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
                {tokens.map((token) => (
                  <li
                    key={token.symbol}
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
                      {token.usd === null ? "" : formatUsd(token.usd, "cents")}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
          <dl className="mt-6 flex flex-col gap-3 rounded-[20px] bg-soft p-5 text-[15px] dark:bg-soft2">
            {detail.kind === "claim" ? (
              <>
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
          <PillButton.Root asChild intent="secondary" className="mt-7">
            <a href={scan}>
              View on Matchscan
              <Icon name="arrow-up-right" size={16} strokeWidth={2.2} />
            </a>
          </PillButton.Root>
        </Sheet.Body>
      </Sheet.Content>
    </Sheet.Root>
  )
}
