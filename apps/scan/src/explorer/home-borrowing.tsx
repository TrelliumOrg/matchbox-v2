import { addressAvatar, shortAddress } from "@matchbox/domain/format"
import * as Avatar from "@matchbox/ui/avatar"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { Section } from "../data/explorer"
import type { LatestBorrowRow } from "../data/scan/latest-borrowing"
import { PositionLink } from "./loan-link"
import { SectionHeading, SectionState } from "./parts"

/**
 * Home's "Latest borrowing" (`cP_-xnZA8I`): one list of every venue's
 * newest borrow events, each with its position, what the event left it
 * holding and owing, its status and the action (a Morpho event, which
 * carries no position state, says so once). On a phone each row stacks.
 * Its own chunk, off the first paint's budget.
 */

const linkClass =
  "rounded-sm font-semibold text-ink underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ink"

const header =
  "grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,1.3fr)_88px] items-center gap-x-5"

function Figure({ value }: { value: string | null }): ReactNode {
  return value === null ? (
    <span className="text-sec">Not in the event</span>
  ) : (
    <span className="font-semibold tabular-nums">{value}</span>
  )
}

function Row({ row }: { row: LatestBorrowRow }): ReactNode {
  const avatar =
    row.account === null ? null : addressAvatar(row.account.toLowerCase())
  return (
    <li
      className={`${header} border-b border-line py-3 max-lg:grid-cols-[minmax(0,1fr)_auto] max-lg:gap-y-1`}
    >
      <div className="flex min-w-0 items-center gap-3">
        {avatar === null ? null : (
          <Avatar.Root initials={avatar.initials} hue={avatar.hue} size={36} />
        )}
        <div className="min-w-0">
          <p className="truncate font-mono text-[14.5px]">
            {row.link === null || row.account === null ? (
              (row.account ?? "")
            ) : (
              <PositionLink link={row.link}>
                {shortAddress(row.account)}
              </PositionLink>
            )}
          </p>
          <p className="truncate text-[14px] text-sec">{row.venue}</p>
        </div>
      </div>
      {row.collateral === null && row.debt === null && row.status === null ? (
        // A Morpho event carries no position state: said once.
        <p className="col-span-3 text-[15px] max-lg:col-span-1 max-lg:col-start-1 max-lg:text-[14px]">
          <Figure value={null} />
        </p>
      ) : (
        <>
          <p className="text-[15px] max-lg:col-start-1 max-lg:text-[14px]">
            <span className="text-sec lg:hidden">Collateral </span>
            <Figure value={row.collateral} />
          </p>
          <p className="text-[15px] max-lg:col-start-1 max-lg:text-[14px]">
            <span className="text-sec lg:hidden">Debt </span>
            <Figure value={row.debt} />
          </p>
          <p className="text-[14.5px] text-sec max-lg:col-start-2 max-lg:row-start-1 max-lg:text-right">
            {row.status ?? ""}
          </p>
        </>
      )}
      <p className="min-w-0 text-[15px] max-lg:col-start-1">
        {row.action}
        {row.detail === null ? null : (
          <span className="text-sec"> {row.detail}</span>
        )}
      </p>
      <p className="text-right text-[14.5px] text-sec tabular-nums max-lg:col-start-2 max-lg:row-start-2">
        <Link
          to="/tx/$hash"
          params={{ hash: row.txHash }}
          className="rounded-sm outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink"
        >
          {row.day}
        </Link>
      </p>
    </li>
  )
}

export function LatestBorrowing({
  rows,
}: {
  rows: Section<LatestBorrowRow[]>
}): ReactNode {
  return (
    <section aria-labelledby="latest-borrowing" className="mt-14">
      <SectionHeading
        id="latest-borrowing"
        aside={
          <Link to="/borrow" className={linkClass}>
            Borrow
          </Link>
        }
      >
        Latest borrowing
      </SectionHeading>
      {rows.status !== "ok" ? (
        <SectionState section={rows} />
      ) : rows.data.length === 0 ? (
        <p className="py-6 text-sec">No borrowing yet</p>
      ) : (
        <>
          <p
            aria-hidden="true"
            className={`${header} border-b border-line pb-2 text-[14px] text-sec max-lg:hidden`}
          >
            <span>Position</span>
            <span>Collateral</span>
            <span>Debt</span>
            <span>Status</span>
            <span>Last action</span>
            <span className="text-right">Date</span>
          </p>
          <ul aria-label="Latest borrowing" className="flex flex-col">
            {rows.data.map((row) => (
              <Row key={row.key} row={row} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
