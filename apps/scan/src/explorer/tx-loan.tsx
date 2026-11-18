import type { ReactNode } from "react"
import type { Section } from "../data/explorer"
import type { TxLoanView } from "../data/scan/tx-loan"
import { PositionLink } from "./loan-link"
import { SectionState, TxLink } from "./parts"

/**
 * A loan transaction's panels (`h3WlmUZS7N`): "What changed" (each figure
 * after the transaction, with what it was before) and the position card
 * (the position now, as its own page has it, and its events around this
 * transaction). A figure that needs the live position (an Enclave's
 * collateral ratio, its price at the minimum) says it is not available
 * yet, never an estimate. Its own chunk, off the first paint's budget.
 */

export function WhatChanged({
  loan,
}: {
  loan: Section<TxLoanView>
}): ReactNode {
  return (
    <section
      aria-labelledby="what-changed"
      className="mt-8 rounded-[24px] bg-soft p-6 max-md:p-5"
    >
      <h2 id="what-changed" className="text-[20px] font-[650]">
        What changed
      </h2>
      {loan.status !== "ok" ? (
        <SectionState section={loan} />
      ) : (
        <dl className="mt-4 grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:auto-cols-fr xl:grid-flow-col">
          {loan.data.changes.map((change) => (
            <div
              key={change.label}
              className="min-w-0 xl:border-l xl:border-line xl:pl-6 xl:first:border-l-0 xl:first:pl-0"
            >
              <dt className="text-[14.5px] text-sec">{change.label}</dt>
              <dd className="mt-1 text-[24px] leading-tight font-[650] tabular-nums [overflow-wrap:anywhere] max-md:text-[20px]">
                {change.value}
              </dd>
              {change.note === null ? null : (
                <dd className="mt-1 text-[14.5px] text-sec">{change.note}</dd>
              )}
            </div>
          ))}
          {loan.data.notYet.map((label) => (
            <div
              key={label}
              className="min-w-0 xl:border-l xl:border-line xl:pl-6"
            >
              <dt className="text-[14.5px] text-sec">{label}</dt>
              <dd className="mt-1 text-[17px] leading-tight font-semibold text-sec">
                Not available yet
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

export function PositionCard({ loan }: { loan: TxLoanView }): ReactNode {
  const { position } = loan
  return (
    <section
      aria-labelledby="loan-position"
      className="rounded-[24px] bg-soft p-6 max-md:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="loan-position" className="text-[17px] font-[650]">
          <PositionLink link={position.link}>{position.title}</PositionLink>
        </h2>
        <span className="text-[14.5px] text-sec">{position.status}</span>
      </div>
      {position.rows.length === 0 ? null : (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          {position.rows.map((row) => (
            <div key={row.label} className="min-w-0">
              <dt className="text-[14px] text-sec">{row.label}</dt>
              <dd className="mt-0.5 text-[15.5px] font-semibold tabular-nums [overflow-wrap:anywhere]">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <h3 className="mt-5 border-t border-line pt-4 text-[14.5px] font-semibold">
        Position history
      </h3>
      <ul aria-label="Position history" className="mt-2 flex flex-col">
        {position.history.map((row) => (
          <li
            key={row.key}
            aria-current={row.current ? "true" : undefined}
            className={`grid grid-cols-[72px_minmax(0,1fr)_auto] items-baseline gap-x-3 max-sm:grid-cols-[72px_minmax(0,1fr)] rounded-[12px] px-2 py-2.5 ${row.current ? "bg-bg" : ""}`}
          >
            <span className="text-[14px] text-sec">{row.day}</span>
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold">
                {row.title}
              </span>
              <span className="block truncate text-[13.5px] text-sec">
                {row.current ? "This transaction" : (row.subline ?? "")}
              </span>
            </span>
            <span className="text-right text-[13.5px] max-sm:hidden">
              {row.current ? null : <TxLink hash={row.txHash} />}
            </span>
          </li>
        ))}
      </ul>
      {position.more || position.history.length > 0 ? (
        <p className="mt-3 text-center">
          <PositionLink
            link={position.link}
            className="rounded-sm text-[14.5px] font-semibold underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ink"
          >
            Full position history
          </PositionLink>
        </p>
      ) : null}
    </section>
  )
}
