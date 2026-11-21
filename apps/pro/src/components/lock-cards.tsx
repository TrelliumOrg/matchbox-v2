import { whenIdle } from "@matchbox/motion"
import { TokenIcon } from "@matchbox/token-icons"
import * as AllocationMark from "@matchbox/ui/allocation-mark"
import { Btc, formatBtcFigure } from "@matchbox/ui/amount"
import { Tip } from "@matchbox/ui/floating"
import * as GaugeCard from "@matchbox/ui/gauge-card"
import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import * as LockCard from "@matchbox/ui/lock-card"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useEffect, useState } from "react"
import { fetchLive } from "../data/live-query"
import { gaugesQuery } from "../data/queries"
import type { GaugeSummary, Lock } from "../data/view-models"
import {
  formatCompact,
  formatDate,
  formatDuration,
  formatShare,
  formatToken,
  formatUsd,
  formatVoteAmount,
  weiToWhole,
} from "../lib/format"
import { gaugeName } from "../lib/gauge-name"
import { useViewer, useViewingOther } from "../lib/viewer"
import { useHead } from "../live/heads"
import { chainNow, useLive } from "../live/live-context"
import {
  type CardPill,
  type CardRow,
  cardPill,
  cardRows,
  unlockMeta,
} from "../locks/card-state"
import { type CardAction, cardActions } from "../locks/eligibility"
import { openClaim } from "../tx/open-claim"
import { openTx, type TxRequest, txIntent } from "../tx/tx-store"
import { allocationOf } from "./allocation-of"
import { Loading } from "./loading"

/**
 * The lock cards row on Overview (`sL4e8DNYO0`, direction A refined): one
 * card per lock, then the New lock tile. The front leads with voting power
 * in its unit, a meta row of icons (locked amount, USD, unlock), a veBTC
 * lock's own boost band, the epoch's rows and one pill whose action follows
 * the lock's state (`locks/card-state`). Any other click flips the card to
 * its actions, each opening its sheet: Add, Extend, Merge and Transfer, or
 * Withdraw once expired. Three columns on desktop, two at 834 with the tile
 * as a strip, a peeking horizontal row on phones.
 */

const escrowName = { vebtc: "veBTC", vemezo: "veMEZO" } as const
const coin = { vebtc: "BTC", vemezo: "MEZO" } as const

/** "500,000.00" or "0.8000": the locked amount, without its symbol. */
function lockedFigure(lock: Lock): string {
  return lock.kind === "vebtc"
    ? formatBtcFigure(lock.amount).text
    : formatToken(lock.amount, "MEZO")
}

function Headline({ lock }: { lock: Lock }): ReactNode {
  if (lock.kind === "vemezo") {
    return (
      <LockCard.Headline unit="veMEZO" muted={lock.expired}>
        {formatVoteAmount(lock.votingPowerWei, "veMEZO").replace(
          / veMEZO$/,
          "",
        )}
      </LockCard.Headline>
    )
  }
  const figure = formatBtcFigure(lock.votingPower)
  // Below 0.000001 the Btc component prints the floor with the exact value
  // in its tooltip, unit included.
  return figure.exact === null ? (
    <LockCard.Headline unit="veBTC" muted={lock.expired}>
      {figure.text}
    </LockCard.Headline>
  ) : (
    <LockCard.Headline muted={lock.expired}>
      <Btc value={lock.votingPower} unit="veBTC" />
    </LockCard.Headline>
  )
}

function Unlock({ lock }: { lock: Lock }): ReactNode {
  const meta = unlockMeta(lock)
  switch (meta.kind) {
    case "auto-max":
      return <LockCard.Prop icon={shapes.infinity} label="Auto max" />
    case "unlocks":
      return (
        <LockCard.Prop icon={shapes.calendarDays} label="Unlocks">
          {formatDate(meta.at)}
        </LockCard.Prop>
      )
    case "expired":
      return (
        <LockCard.Prop icon={shapes.lock} label="Expired">
          {meta.at === null ? null : formatDate(meta.at)}
        </LockCard.Prop>
      )
  }
}

/**
 * One bar for where the lock's votes are: each gauge's share of all of
 * them, by weight. `shareBps` itself is per voter and adds up to 200% for
 * a lock that votes through both of its voters.
 */
export function sharesOfAll(votes: Lock["votes"]): Lock["votes"] {
  let total = 0n
  for (const vote of votes) total += BigInt(vote.weight)
  if (total === 0n) return votes
  return votes.map((vote) => ({
    ...vote,
    shareBps: Number((BigInt(vote.weight) * 10_000n) / total),
  }))
}

/** "SNF", "2 validators": what the lock voted for this epoch. */
function votedFor(lock: Lock): string {
  const [first, ...rest] = lock.votes
  if (first === undefined) return "Voted"
  if (rest.length === 0) return gaugeName(first.gauge)
  const voter = first.gauge.voter
  const same = rest.every((vote) => vote.gauge.voter === voter)
  const noun =
    same && voter === "validators"
      ? "validators"
      : same && voter === "pools"
        ? "pools"
        : "gauges"
  return `${lock.votes.length} ${noun}`
}

/** "Kiln Labs 70%", "veBTC #604 30%": each gauge voted for and its share. */
export function votedList(lock: Pick<Lock, "votes">): string[] {
  if (lock.votes.length === 0) return ["Voted"]
  return sharesOfAll(lock.votes).map(
    (vote) => `${gaugeName(vote.gauge)} ${formatShare(vote.shareBps)}`,
  )
}

function Row({
  row,
  lock,
  epoch,
  now,
}: {
  row: CardRow
  lock: Lock
  epoch: number
  now: number
}): ReactNode {
  switch (row.kind) {
    case "epoch":
      return (
        <LockCard.Line icon={shapes.vote} label={`Epoch ${epoch}`}>
          {lock.votes.length === 0 ? null : (
            <AllocationMark.Root
              allocations={allocationOf(sharesOfAll(lock.votes))}
              surface="var(--soft)"
              max={2}
              className="flex-none"
              {...(lock.votes.length > 2
                ? { barClassName: "max-md:hidden" }
                : {})}
            />
          )}
          {/* One line: a long gauge name truncates, the label never wraps.
              What is cut off, and what "3 gauges" stands for, opens on
              hover, focus or a tap: a `title` never shows on a phone. */}
          <Tip
            side="top"
            align="end"
            className="min-w-0"
            content={
              <span className="flex flex-col gap-0.5 tabular-nums">
                {votedList(lock).map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </span>
            }
            trigger={(tip) => (
              <span
                // biome-ignore lint/a11y/noNoninteractiveTabindex: a tap or Tab opens the full list
                tabIndex={0}
                data-vote-line=""
                className="min-w-0 truncate rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                {...tip}
              >
                {votedFor(lock)}
              </span>
            )}
          />
        </LockCard.Line>
      )
    case "projected":
      return (
        <LockCard.Line icon={shapes.arrowUpRight} label="Projected">
          {formatUsd(row.usd, "cents")}
        </LockCard.Line>
      )
    case "claimable":
      return (
        <LockCard.Line icon={shapes.gift} label="Claimable" tone={row.tone}>
          {formatUsd(row.usd, "cents")}
        </LockCard.Line>
      )
    case "not-voted":
      return (
        <LockCard.Line
          icon={shapes.circleAlert}
          label={`Not voted in Epoch ${epoch}`}
          tone="attention"
        >
          {formatDuration(row.endsAt - now)}
        </LockCard.Line>
      )
    case "if-voted":
      return (
        <LockCard.Line icon={shapes.arrowUpRight} label="If voted" tone="muted">
          About {formatUsd(row.usd, "cents")}
        </LockCard.Line>
      )
  }
}

function Pill({ pill, lock }: { pill: CardPill; lock: Lock }): ReactNode {
  const viewer = useViewer()
  switch (pill.kind) {
    case "claim":
      return (
        <LockCard.Action
          intent="primary"
          {...txIntent}
          onClick={() =>
            void openClaim(viewer, {
              relock: false,
              only: { kind: lock.kind, tokenId: lock.tokenId },
            })
          }
        >
          Claim {formatUsd(pill.usd, "cents")}
        </LockCard.Action>
      )
    case "withdraw":
      return (
        <LockCard.Action
          intent="primary"
          {...txIntent}
          onClick={() => openTx(viewer, { flow: "withdraw", lock })}
        >
          Withdraw {lockedFigure(lock)} {coin[lock.kind]}
        </LockCard.Action>
      )
    case "vote":
      return (
        <LockCard.Action intent="primary" asChild>
          <Link to="/vote/$type" params={{ type: pill.type }}>
            Vote
          </Link>
        </LockCard.Action>
      )
    case "manage":
      return <LockCard.Manage />
  }
}

/**
 * A veBTC lock's own boost gauge band, as on its gauge card. The directory
 * loads once the page is idle (Vote reuses it); the space is held meanwhile.
 */
function BoostBand({ lock }: { lock: Lock }): ReactNode {
  const [gauge, setGauge] = useState<GaugeSummary | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    const cancel = whenIdle(() => {
      fetchLive(gaugesQuery).then(
        (list) => {
          if (!live) return
          setGauge(
            list.gauges.find(
              (entry) =>
                entry.kind === "vebtc" && entry.tokenId === lock.tokenId,
            ) ?? null,
          )
        },
        () => {
          if (live) setGauge(null)
        },
      )
    })
    return () => {
      live = false
      cancel()
    }
  }, [lock.tokenId])
  if (gauge === null) return null
  if (gauge === undefined) {
    return (
      <Loading
        id="lock-card-band"
        label="Loading boost"
        sample={<Band votes={5_880_000n} optimal={6_970_000n} />}
      />
    )
  }
  if (gauge.optimalVotes === null) return null
  return (
    <Band
      votes={weiToWhole(gauge.votes)}
      optimal={weiToWhole(gauge.optimalVotes)}
    />
  )
}

function Band({
  votes,
  optimal,
}: {
  votes: bigint
  optimal: bigint
}): ReactNode {
  return (
    <div className="mt-3.5 overflow-hidden rounded-[12px]">
      <GaugeCard.Band
        votes={Number(votes)}
        optimal={Number(optimal)}
        count={formatCompact(votes)}
        of={`of ${formatCompact(optimal)} veMEZO`}
        toGo={`${formatCompact(optimal > votes ? optimal - votes : 0n)} veMEZO to go`}
        over={`${formatCompact(votes > optimal ? votes - optimal : 0n)} veMEZO over`}
      />
    </div>
  )
}

const actionIcon: Record<CardAction["action"], GlyphShape> = {
  add: shapes.plus,
  extend: shapes.timer,
  merge: shapes.lock,
  transfer: shapes.arrowUpRight,
  withdraw: shapes.arrowDown,
}

function actionRequest(
  action: CardAction["action"],
  lock: Lock,
  locks: readonly Lock[],
): TxRequest {
  switch (action) {
    case "add":
      return { flow: "add", lock }
    case "extend":
      return { flow: "extend", lock }
    case "merge":
      return { flow: "merge", lock, locks: [...locks] }
    case "transfer":
      return { flow: "transfer", lock }
    case "withdraw":
      return { flow: "withdraw", lock }
  }
}

function TabLabel({ lock }: { lock: Lock }): ReactNode {
  return (
    <span>
      <span className="sr-only">{escrowName[lock.kind]} </span>#{lock.tokenId}
    </span>
  )
}

/**
 * Locks whose split for the next epoch is saved on Vote (they voted this
 * one; this browser only). The saving code loads only when a lock voted.
 */
function useSavedNext(
  address: string | null,
  locks: readonly Lock[],
  epoch: number,
): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    if (address === null || !locks.some((lock) => lock.votedThisEpoch)) return
    let live = true
    let stop: (() => void) | null = null
    void import("../features/vote/saved-ballots").then((saved) => {
      if (!live) return
      const read = () =>
        setIds(
          new Set(
            locks
              .filter(
                (lock) =>
                  saved.savedStatus(
                    saved.loadSavedAny(address, lock),
                    lock,
                    epoch,
                  ) === "pending",
              )
              .map((lock) => `${lock.kind}:${lock.tokenId}`),
          ),
        )
      read()
      stop = saved.subscribeSaved(read)
    })
    return () => {
      live = false
      stop?.()
    }
  }, [address, locks, epoch])
  return ids
}

function LockFace({
  lock,
  locks,
  epoch,
  epochEndsAt,
  now,
  savedNext,
}: {
  lock: Lock
  locks: readonly Lock[]
  epoch: number
  epochEndsAt: number
  now: number
  /** Changes for the next epoch are saved on Vote. */
  savedNext: boolean
}): ReactNode {
  const viewer = useViewer()
  // Someone else's lock: no action pill and no actions side to flip to.
  const other = useViewingOther()
  const symbol = coin[lock.kind]
  const pill = cardPill(lock)
  const labels: Record<CardAction["action"], string> = {
    add: `Add ${symbol}`,
    extend: "Extend",
    merge: "Merge",
    transfer: "Transfer",
    withdraw: "Withdraw",
  }
  return (
    <>
      <LockCard.Front>
        <LockCard.Tab
          aside={
            <>
              {lock.expired ? <LockCard.Chip>Expired</LockCard.Chip> : null}
              {pill.kind === "manage" || other ? null : <LockCard.Flip />}
            </>
          }
        >
          <TabLabel lock={lock} />
        </LockCard.Tab>
        <LockCard.Body>
          <Headline lock={lock} />
          <LockCard.Meta>
            <LockCard.Prop
              label={`Locked ${symbol}`}
              mark={<TokenIcon ticker={symbol} size={16} />}
            >
              {lockedFigure(lock)}
            </LockCard.Prop>
            <span>{formatUsd(lock.usd, "whole")}</span>
            <Unlock lock={lock} />
          </LockCard.Meta>
          {lock.kind === "vebtc" &&
          !lock.expired &&
          (lock.boost ?? null) !== null ? (
            <BoostBand lock={lock} />
          ) : null}
          <LockCard.Lines>
            {cardRows(lock, epochEndsAt).map((row) => (
              <Row
                key={row.kind}
                row={row}
                lock={lock}
                epoch={epoch}
                now={now}
              />
            ))}
            {savedNext ? (
              <LockCard.Line
                icon={shapes.check}
                label={`Changes saved for Epoch ${epoch + 1}`}
              >
                {null}
              </LockCard.Line>
            ) : null}
          </LockCard.Lines>
          {other ? null : (
            <div className="mt-auto pt-4">
              <Pill pill={pill} lock={lock} />
            </div>
          )}
        </LockCard.Body>
      </LockCard.Front>
      <LockCard.Back>
        <LockCard.Tab
          aside={
            lock.expired ? <LockCard.Chip>Expired</LockCard.Chip> : undefined
          }
        >
          <TabLabel lock={lock} />
        </LockCard.Tab>
        <LockCard.Menu>
          {cardActions(lock).map((item) => (
            <LockCard.MenuItem
              key={item.action}
              icon={<Glyph shape={actionIcon[item.action]} size={17} />}
              {...(item.note === null ? {} : { value: item.note })}
              {...txIntent}
              onClick={() =>
                openTx(viewer, actionRequest(item.action, lock, locks))
              }
            >
              {labels[item.action]}
            </LockCard.MenuItem>
          ))}
        </LockCard.Menu>
      </LockCard.Back>
    </>
  )
}

export function LockCards({ locks }: { locks: readonly Lock[] }): ReactNode {
  const { market, store } = useLive()
  const head = useHead(store)
  const viewer = useViewer()
  const other = useViewingOther()
  const now = chainNow(market, head.number)
  const savedNext = useSavedNext(
    viewer.kind === "signed-out" ? null : viewer.address,
    locks,
    market.epoch.number,
  )
  return (
    <section
      aria-label="Locks"
      className="-mx-5 mt-9 flex snap-x snap-mandatory scroll-px-5 gap-4 overflow-x-auto px-5 pb-1 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-3"
    >
      {locks.map((lock) => (
        <LockCard.Root
          key={`${lock.kind}-${lock.tokenId}`}
          kind={lock.expired ? "expired" : lock.kind}
          token={coin[lock.kind]}
          className="w-[300px] flex-none snap-start md:w-auto"
        >
          <LockFace
            lock={lock}
            locks={locks}
            epoch={market.epoch.number}
            epochEndsAt={market.epoch.endsAt}
            now={now}
            savedNext={savedNext.has(`${lock.kind}:${lock.tokenId}`)}
          />
        </LockCard.Root>
      ))}
      {other ? null : (
        <LockCard.NewTile
          {...txIntent}
          onClick={() => openTx(viewer, { flow: "new-lock", kind: "vemezo" })}
          className={`w-[300px] flex-none snap-start md:w-auto ${
            locks.length > 0
              ? "md:max-lg:col-span-2 md:max-lg:min-h-[76px] md:max-lg:flex-row md:max-lg:justify-start md:max-lg:px-5 md:max-lg:[&>:last-child]:ml-auto"
              : ""
          }`}
        />
      )}
    </section>
  )
}
