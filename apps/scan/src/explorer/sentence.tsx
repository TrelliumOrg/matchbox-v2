import { shortAddress, shortHash } from "@matchbox/domain/format"
import * as Age from "@matchbox/ui/age"
import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import * as UntrustedText from "@matchbox/ui/untrusted-text"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { ActivityView, SentencePart } from "../data/scan/activity-view"

/**
 * Activity in plain words (Matchscan: "Activity in plain words"): a
 * sentence from `@matchbox/domain/activity`, resolved on the server, with
 * its lock, gauge, address and epoch linked. Names are chain or label
 * supplied, so they render as untrusted text.
 */

const link =
  "rounded-sm font-semibold underline decoration-line underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink"

const escrowName = { vebtc: "veBTC", vemezo: "veMEZO" } as const

function Part({ part }: { part: SentencePart }): ReactNode {
  switch (part.kind) {
    case "text":
      return part.text
    case "figure":
      return <span className="font-semibold tabular-nums">{part.text}</span>
    case "address":
      return (
        <Link
          to="/address/$address"
          params={{ address: part.address }}
          className={link}
        >
          {part.name === null ? (
            <span className="font-mono">{shortAddress(part.address)}</span>
          ) : (
            <UntrustedText.Root value={part.name} limit={40} />
          )}
        </Link>
      )
    case "gauge":
      return (
        <Link
          to="/gauges/$gauge"
          params={{ gauge: part.address }}
          className={link}
        >
          {part.name === null ? (
            <span className="font-mono">{shortAddress(part.address)}</span>
          ) : (
            <UntrustedText.Root value={part.name} limit={40} />
          )}
        </Link>
      )
    case "lock":
      return part.escrow === null ? (
        <span className="font-semibold">lock #{part.id}</span>
      ) : (
        <Link
          to="/locks/$escrow/$id"
          params={{ escrow: part.escrow, id: part.id }}
          className={link}
        >
          {escrowName[part.escrow]} #{part.id}
        </Link>
      )
    case "epoch":
      return (
        <Link
          to="/epochs/$epoch"
          params={{ epoch: String(part.number) }}
          className={link}
        >
          Epoch {part.number}
        </Link>
      )
    case "method":
      return (
        <span className="font-mono">
          <UntrustedText.Root value={part.name} limit={48} />
        </span>
      )
    default:
      return null
  }
}

export function Sentence({
  parts,
  className,
}: {
  parts: readonly SentencePart[]
  className?: string
}): ReactNode {
  return (
    <span className={className}>
      {parts.map((part, index) => (
        // Parts are positional: the sentence never reorders.
        // biome-ignore lint/suspicious/noArrayIndexKey: position is the key
        <Part key={index} part={part} />
      ))}
    </span>
  )
}

const actionIcons: Readonly<Record<string, GlyphShape>> = {
  LOCK_CREATED: shapes.lock,
  LOCK_AMOUNT_INCREASED: shapes.lock,
  LOCK_EXTENDED: shapes.calendarDays,
  LOCK_PERMANENT: shapes.infinity,
  LOCK_PERMANENT_UNLOCKED: shapes.calendarDays,
  LOCK_MERGED: shapes.lock,
  LOCK_WITHDRAWN: shapes.lock,
  BOOST_VOTE: shapes.squareCheck,
  BOOST_ABSTAIN: shapes.squareCheck,
  BOOST_POKE: shapes.squareCheck,
  VOTE_BRIBE_CLAIMED: shapes.coins,
  VOTE_FEE_CLAIMED: shapes.coins,
  INCENTIVE_ADDED: shapes.coins,
  SWAP: shapes.arrowRight,
  LP_ADDED: shapes.plus,
  LP_REMOVED: shapes.minus,
  LP_STAKED: shapes.droplets,
  LP_UNSTAKED: shapes.droplets,
  REWARD_DISTRIBUTED: shapes.coins,
  REBASE_CLAIMED: shapes.coins,
  MERKLE_CLAIMED: shapes.coins,
  SAVINGS_DEPOSIT: shapes.landmark,
  SAVINGS_WITHDRAW: shapes.landmark,
  SAVINGS_YIELD_CLAIMED: shapes.coins,
  LOCK_TRANSFERRED: shapes.lock,
  LOCK_BOOST_UPDATED: shapes.lock,
}

/**
 * An activity list: one sentence per row, time and transaction aside. The
 * list-row layout (48px icon, text, value) in plain markup, so the
 * transaction page does not load the list-row module for it.
 */
/** A row shown for one or more identical rows of one transaction. */
export type ActivityGroup = { row: ActivityView; count: number }

/**
 * Rows of one transaction that read exactly the same, one after another,
 * as one row with how many (a contract that refreshes votes five times in
 * one call writes five identical rows when the indexer records no lock).
 * Rows that differ in any word stay apart, so nothing is hidden.
 */
export function groupRepeats(rows: readonly ActivityView[]): ActivityGroup[] {
  const groups: ActivityGroup[] = []
  for (const row of rows) {
    const last = groups.at(-1)
    if (
      last !== undefined &&
      last.row.txHash === row.txHash &&
      last.row.action === row.action &&
      last.row.text === row.text
    ) {
      last.count += 1
    } else {
      groups.push({ row, count: 1 })
    }
  }
  return groups
}

export function ActivityList({
  rows,
  now,
}: {
  rows: readonly ActivityView[]
  now: number
}): ReactNode {
  return (
    <ul aria-label="Activity" className="flex flex-col">
      {groupRepeats(rows).map(({ row, count }) => (
        // On a phone the age and transaction go on a line under the
        // sentence, so the sentence keeps the row's width.
        <li
          key={row.id}
          className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 py-3.5 max-sm:grid-cols-[auto_minmax(0,1fr)] max-sm:gap-x-3"
        >
          <span className="grid size-12 flex-none place-items-center overflow-hidden rounded-full bg-soft text-ink max-sm:row-span-2 max-sm:size-10 max-sm:self-start">
            <Glyph
              shape={actionIcons[row.action] ?? shapes.arrowRight}
              size={18}
              strokeWidth={1.8}
            />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base text-ink">
              <Sentence parts={row.parts} />
              {count > 1 ? (
                <span className="text-sec">, {count} times</span>
              ) : null}
            </p>
            <p className="mt-0.5 text-[14.5px] text-sec tabular-nums">
              Block {row.block.toLocaleString("en-US")}
            </p>
          </div>
          <div className="flex flex-none flex-col items-end text-right tabular-nums max-sm:col-start-2 max-sm:mt-1 max-sm:flex-row max-sm:items-baseline max-sm:gap-3 max-sm:text-left">
            <span className="text-base font-semibold text-ink max-sm:text-[14.5px]">
              <Age.Root timestamp={row.timestamp} now={now} />
            </span>
            <Link
              to="/tx/$hash"
              params={{ hash: row.txHash }}
              className="mt-0.5 rounded-sm font-mono text-[14px] text-sec outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink max-sm:mt-0"
            >
              {shortHash(row.txHash)}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  )
}
