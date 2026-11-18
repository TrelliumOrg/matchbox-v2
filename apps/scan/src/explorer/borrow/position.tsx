import { addressAvatar } from "@matchbox/domain/format"
import * as Avatar from "@matchbox/ui/avatar"
import * as Breadcrumbs from "@matchbox/ui/breadcrumbs"
import * as StatusChip from "@matchbox/ui/status-chip"
import type { ReactNode } from "react"
import type { HealthBand } from "../../data/scan/words"
import { TxLink } from "../parts"
import { bandTone, HealthBar } from "./parts"

/**
 * A borrow position's page parts (`SMPC0BE45O`, `gEpCzgLLt1`, phone
 * `eS8VkkjrW4`): breadcrumbs, the identity header with its state and the
 * action on Mezo, and the health card (one headline figure in the band's
 * colour, the LTV bar, four figures).
 */

export function PositionHeader({
  crumbs,
  current,
  address,
  title,
  state,
  sub,
  action,
}: {
  crumbs: ReactNode
  current: string
  /** The avatar's address. */
  address: string
  title: ReactNode
  /** "Active", "Closed": real state only. */
  state: { word: string; tone: "positive" | "neutral" } | null
  sub: ReactNode
  action: ReactNode
}): ReactNode {
  const avatar = addressAvatar(address)
  return (
    <>
      <Breadcrumbs.Root className="mt-8 max-xl:mt-5">
        {crumbs}
        <Breadcrumbs.Current mono>{current}</Breadcrumbs.Current>
      </Breadcrumbs.Root>
      <header className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-4">
        <Avatar.Root initials={avatar.initials} hue={avatar.hue} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-[30px] leading-tight font-medium tracking-[-0.02em] max-md:text-[22px]">
              {title}
            </h1>
            {state === null ? null : (
              <StatusChip.Root tone={state.tone} variant="chip">
                {state.word}
              </StatusChip.Root>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] text-sec">
            {sub}
          </div>
        </div>
        {action}
      </header>
    </>
  )
}

/** The position's newest transaction, for its header: "Last tx 0x…". */
export function LastTx({ hash }: { hash: string | null }): ReactNode {
  if (hash === null) return null
  return (
    <span className="flex items-center gap-2">
      Last tx
      <TxLink hash={hash} />
    </span>
  )
}

export function HealthCard({
  label,
  figure,
  band,
  detail,
  share,
  limit,
  limitLabel,
  barLabel,
  children,
}: {
  label: string
  figure: string
  band: HealthBand
  detail: string | null
  /** LTV as a 0 to 1 share; null hides the bar. */
  share: number | null
  limit: number | null
  limitLabel: string | null
  barLabel: string
  /** The four figures under the bar (`Stat`s). */
  children: ReactNode
}): ReactNode {
  return (
    <section
      aria-label={label}
      className="mt-8 rounded-[24px] bg-soft p-7 max-md:p-5"
    >
      <div className="flex items-center justify-between">
        <p className="text-[15px] text-ink2">{label}</p>
        <p className="text-[15px] font-semibold">Now</p>
      </div>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-4">
        <span
          className={`text-[56px] leading-none font-[650] tracking-[-0.02em] tabular-nums max-md:text-[44px] ${bandTone[band]}`}
        >
          {figure}
        </span>
        {detail === null ? null : (
          <span className="text-[16px] text-ink2">{detail}</span>
        )}
      </p>
      {share === null ? null : (
        <div className="mt-7">
          <HealthBar
            share={share}
            limit={limit}
            band={band}
            label={barLabel}
            size="large"
          />
          <div className="relative mt-2.5 h-5 font-mono text-[12.5px] text-sec">
            <span className="absolute left-0">0%</span>
            {limit === null || limitLabel === null ? null : (
              <span
                className="absolute -translate-x-1/2 font-sans text-[14px] font-semibold whitespace-nowrap text-neg max-md:hidden"
                style={{ left: `${Math.min(limit * 100, 88)}%` }}
              >
                {limitLabel}
              </span>
            )}
            <span className="absolute right-0">100%</span>
          </div>
        </div>
      )}
      <dl className="mt-6 grid grid-cols-4 gap-6 border-t border-line pt-6 max-lg:grid-cols-2 max-md:gap-4">
        {children}
      </dl>
    </section>
  )
}

/** A figure of the health card: label, 23/650 value, a quiet line. */
export function CardFigure({
  label,
  children,
  sub,
}: {
  label: string
  children: ReactNode
  sub?: string | null
}): ReactNode {
  return (
    <div className="min-w-0">
      <dt className="text-[15px] text-ink2">{label}</dt>
      <dd className="mt-1 text-[23px] font-[650] tabular-nums max-md:text-[19px]">
        {children}
      </dd>
      {sub === undefined || sub === null ? null : (
        <dd className="text-[14px] text-sec tabular-nums">{sub}</dd>
      )}
    </div>
  )
}
