import { Glyph, shapes } from "@matchbox/ui/icons"
import type { ReactNode } from "react"
import type { HistoryView } from "../../data/scan/borrow-views"
import type { AddressView } from "../../data/views"
import { AddressLink, TxLink } from "../parts"
import { Coin } from "./parts"

/** Loan history and market activity in words, and detail cards. */

// -- history ------------------------------------------------------------------

/** An address with no name to show, for links. */
export function plainAddress(address: string): AddressView {
  return { address, name: null, contract: false }
}

/** Loan history or market activity in words, newest first. */
export function HistoryList({
  rows,
  label,
  showAccount = false,
}: {
  rows: readonly HistoryView[]
  label: string
  showAccount?: boolean
}): ReactNode {
  if (rows.length === 0) {
    return <p className="py-10 text-center text-[15px] text-sec">No activity</p>
  }
  return (
    <ul aria-label={label} className="flex flex-col">
      {rows.map((row) => (
        <li
          key={row.key}
          className="grid grid-cols-[110px_40px_minmax(0,1fr)_auto] items-center gap-x-4 border-b border-line py-3.5 last:border-b-0 max-md:grid-cols-[40px_minmax(0,1fr)_auto]"
        >
          <span className="text-[15px] font-medium max-md:hidden">
            {row.day}
          </span>
          <span className="grid size-10 place-items-center rounded-full bg-soft">
            {row.coin === null ? (
              <Glyph shape={shapes.creditCard} size={18} strokeWidth={1.8} />
            ) : (
              <Coin ticker={row.coin} size={22} />
            )}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[16px] font-semibold tabular-nums">
              {row.title}
            </span>
            {row.subline === null && !showAccount ? null : (
              <span className="truncate text-[14.5px] text-sec tabular-nums">
                {row.subline}
                {showAccount && row.account !== null ? (
                  <>
                    {row.subline === null ? "" : ", "}
                    <AddressLink
                      view={plainAddress(row.account)}
                      className="text-sec"
                    />
                  </>
                ) : null}
              </span>
            )}
          </span>
          <span className="flex flex-col items-end text-right">
            <span className="text-[15px] md:hidden">{row.day}</span>
            <span className="max-md:hidden">
              <TxLink hash={row.txHash} />
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Detail rows of a soft card ("Position details"). */
export function DetailCard({
  title,
  children,
}: {
  title: string
  children: ReactNode
}): ReactNode {
  return (
    <section
      aria-label={title}
      className="rounded-[24px] bg-soft px-6 pt-5 pb-3 max-md:px-5"
    >
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <dl className="mt-2 flex flex-col">{children}</dl>
    </section>
  )
}

export function DetailRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}): ReactNode {
  return (
    <div className="flex min-h-[43px] items-center justify-between gap-4 border-b border-line py-2 last:border-b-0">
      <dt className="text-[15px] text-sec">{label}</dt>
      <dd className="min-w-0 text-right text-[15px] font-semibold tabular-nums [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  )
}
