import * as AllocationMark from "@matchbox/ui/allocation-mark"
import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import * as ListRow from "@matchbox/ui/list-row"
import * as PillButton from "@matchbox/ui/pill-button"
import { useRouter } from "@tanstack/react-router"
import { type ReactNode, useEffect, useRef, useState } from "react"
import type { ActivityEvent, ActivityPage } from "../data/view-models"
import {
  formatCompact,
  formatDate,
  formatDay,
  formatDayTime,
  formatSignedUsd,
  formatTime,
  formatTokenWithSymbol,
  formatVeBtc,
  formatWeekday,
} from "../lib/format"
import { gaugeName } from "../lib/gauge-name"
import { allocationOf } from "./allocation-of"
import { Coins } from "./coins"

/**
 * One activity event as a plain two-line row. "summary" rows (Overview,
 * Rewards) carry the date in the subline; "dated" rows sit under a date
 * heading and carry the time.
 */

export type RowContext = "summary" | "dated"

function lockLabel(lock: { tokenId: string }): string {
  return `#${lock.tokenId}`
}

type RowParts = {
  icon: GlyphShape
  pending: boolean
  title: string
  subline: string
  subTone: "default" | "attention"
  main: ReactNode
  mainTone: "default" | "positive"
  /** A figure that is not final yet: an estimate. */
  muted: boolean
  sub: ReactNode
  struck: boolean
}

function when(
  event: ActivityEvent,
  context: RowContext,
  prefix: string,
): string {
  if (context === "dated") return `${prefix}, ${formatTime(event.at)}`
  return `${prefix}, ${formatDay(event.at)}`
}

/** Valued when claimed, and no token had a price that day. */
export function claimUnpriced(
  when: { complete: boolean; tokens: { usd: string | null }[] } | undefined,
): boolean {
  return (
    when !== undefined &&
    !when.complete &&
    when.tokens.every((token) => token.usd === null)
  )
}

/**
 * A claim's figure: its value when claimed, else its estimate, else the
 * USD its row was written with.
 */
export function claimUsd(
  detail: Extract<ActivityEvent["detail"], { kind: "claim" }>,
): string {
  return detail.whenClaimed?.usd ?? detail.estimate?.usd ?? detail.usd
}

export function describeEvent(
  event: ActivityEvent,
  context: RowContext,
): RowParts {
  const detail = event.detail
  const confirming = event.status === "confirming"
  const reverted = event.status === "reverted"
  const base = {
    pending: confirming,
    subTone: confirming ? ("attention" as const) : ("default" as const),
    mainTone: "default" as const,
    muted: false,
    struck: false,
  }
  switch (detail.kind) {
    case "vote": {
      // Votes carry the escrow's unit, never "votes" (C4).
      const votes =
        detail.lock.kind === "vemezo"
          ? `${formatCompact(detail.votes.split(".")[0] ?? "0")} veMEZO`
          : formatVeBtc(detail.votes)
      return {
        ...base,
        icon: confirming ? shapes.clock : shapes.vote,
        title: `${confirming ? "Vote" : "Voted"} with ${lockLabel(detail.lock)}`,
        subline: confirming
          ? "Confirming"
          : context === "summary"
            ? `Epoch ${event.epoch}, ${formatWeekday(event.at)}`
            : `Epoch ${event.epoch}, ${formatTime(event.at)}`,
        main: votes,
        sub: (
          <AllocationMark.Root
            allocations={allocationOf(detail.allocation)}
            {...(detail.allocation.length > 4
              ? { barClassName: "max-sm:hidden" }
              : {})}
          />
        ),
      }
    }
    case "claim": {
      // The value when claimed once known; "No price" when no token had
      // one that day, never $0. While its day settles, an estimate, muted
      // and said so: Earned leaves it out.
      const unpriced = claimUnpriced(detail.whenClaimed)
      const estimated =
        detail.whenClaimed === undefined && detail.estimate !== undefined
      const when =
        context === "summary" ? formatDay(event.at) : formatTime(event.at)
      return {
        ...base,
        icon: shapes.gift,
        title: "Claimed rewards",
        subline: confirming
          ? "Confirming"
          : `Epoch ${event.epoch}, ${when}${estimated ? ", estimate" : ""}`,
        main: unpriced
          ? "No price"
          : formatSignedUsd(claimUsd(detail), "cents"),
        mainTone: unpriced || estimated ? "default" : "positive",
        muted: estimated,
        sub: <Coins tokens={detail.tokens} label="Claimed tokens" />,
      }
    }
    case "lock": {
      const verb = {
        create: "Locked",
        increase: "Added to",
        extend: "Extended",
        merge: "Merged into",
        withdraw: "Withdrew",
      }[detail.action]
      const kind = detail.lock.kind === "vebtc" ? "veBTC" : "veMEZO"
      return {
        ...base,
        icon: detail.action === "extend" ? shapes.clock : shapes.plus,
        title: `${verb} ${lockLabel(detail.lock)}`,
        subline:
          context === "summary"
            ? formatDay(event.at)
            : when(event, context, kind),
        main: `${detail.action === "withdraw" ? "-" : "+"}${formatTokenWithSymbol(
          detail.amount.amount,
          detail.amount.symbol,
        )}`,
        sub:
          // 0 is how the chain writes "no unlock date": an auto-max lock.
          detail.unlocksAt === null
            ? null
            : detail.unlocksAt === 0
              ? "Auto max"
              : `Unlocks ${formatDate(detail.unlocksAt)}`,
      }
    }
    case "own":
      // Sent from this browser, not indexed yet: the step's own label.
      return {
        ...base,
        icon: reverted ? shapes.x : confirming ? shapes.clock : shapes.check,
        title: detail.label,
        subline: reverted
          ? `Reverted, ${formatTime(event.at)}`
          : confirming
            ? "Confirming"
            : context === "summary"
              ? formatDayTime(event.at)
              : `Epoch ${event.epoch}, ${formatTime(event.at)}`,
        main: null,
        sub: reverted ? "Not sent" : null,
      }
    case "incentive":
      return {
        ...base,
        icon: reverted ? shapes.x : shapes.plus,
        title: `Incentive to ${gaugeName(detail.gauge)}`,
        subline: reverted
          ? `Reverted, ${formatTime(event.at)}`
          : context === "summary"
            ? formatDayTime(event.at)
            : `Epoch ${event.epoch}, ${formatTime(event.at)}`,
        main: formatTokenWithSymbol(detail.amount.amount, detail.amount.symbol),
        sub: reverted ? "Not sent" : null,
        struck: reverted,
      }
  }
}

export function ActivityRow({
  event,
  context,
  onOpen,
  flip,
}: {
  event: ActivityEvent
  context: RowContext
  /** Opens the transaction sheet; the row becomes a button. */
  onOpen?: () => void
  /** Key for a list that animates (useFlip). */
  flip?: string
}): ReactNode {
  const parts = describeEvent(event, context)
  const title =
    onOpen === undefined ? (
      parts.title
    ) : (
      <button
        type="button"
        onClick={onOpen}
        className="cursor-pointer rounded-sm text-left outline-none before:absolute before:inset-0 before:rounded-[20px] before:content-[''] focus-visible:before:outline-2 focus-visible:before:outline-ink"
      >
        {parts.title}
      </button>
    )
  return (
    <ListRow.Root
      data-flip={flip}
      className={
        onOpen === undefined
          ? ""
          : "relative -mx-3 rounded-[20px] px-3 hover:bg-soft"
      }
    >
      <ListRow.Icon tone={parts.pending ? "pending" : "default"}>
        <Glyph shape={parts.icon} size={20} strokeWidth={1.8} />
      </ListRow.Icon>
      {/* The title keeps room for a few words however wide the value
          runs: a vote's mark once pushed it out entirely on a phone. */}
      <ListRow.Text className="min-w-24">
        <ListRow.Title>{title}</ListRow.Title>
        <ListRow.Subline tone={parts.subTone}>{parts.subline}</ListRow.Subline>
      </ListRow.Text>
      <ListRow.Value className="min-w-0 flex-initial">
        <ListRow.Main
          tone={parts.mainTone}
          className={`max-w-full truncate ${
            parts.struck
              ? "font-medium text-mut line-through"
              : parts.muted
                ? "text-sec"
                : ""
          }`}
        >
          {parts.main}
        </ListRow.Main>
        {parts.sub === null ? null : (
          <ListRow.Sub className="relative z-10 flex justify-end">
            {parts.sub}
          </ListRow.Sub>
        )}
      </ListRow.Value>
    </ListRow.Root>
  )
}

// ---------------------------------------------------------------------------
// Paging below a list of these rows (Activity, Rewards). Here and not in a
// module of its own: that would be a new chunk, and every route's entry
// lists its chunks.
// ---------------------------------------------------------------------------

/**
 * Epoch 0's start, `EPOCH_ZERO_START` of @matchbox/domain (a test holds
 * them equal). Not imported, so this chunk needs no domain chunk.
 */
export const epochZeroStart = 1_765_411_200

/**
 * The epochs a list of events covers, as its footer says: "Epoch 32 to 49",
 * "Epoch 49", "Before Epoch 0 to Epoch 12". A claim counts in the epoch it
 * pays, as its row says. Empty without events.
 */
export function epochSpan(events: readonly ActivityEvent[]): string {
  let from: number | null = null
  let to: number | null = null
  let early = false
  for (const event of events) {
    if (event.at < epochZeroStart) {
      early = true
      continue
    }
    if (from === null || event.epoch < from) from = event.epoch
    if (to === null || event.epoch > to) to = event.epoch
  }
  if (to === null || from === null) return early ? "Before Epoch 0" : ""
  if (early) return `Before Epoch 0 to Epoch ${to}`
  return from === to ? `Epoch ${to}` : `Epoch ${from} to ${to}`
}

/**
 * Where older epochs are still being stored, what the footer says. It
 * names the oldest epoch on the list, which is usually stored only in
 * part: storing stops at a count of transactions, not at an epoch's edge. Like `epochSpan`, it never
 * numbers what came before Epoch 0.
 */
export function pendingLine(events: readonly ActivityEvent[]): string {
  let from: number | null = null
  for (const event of events) {
    if (event.at < epochZeroStart)
      return "Earlier activity is still being added"
    if (from === null || event.epoch < from) from = event.epoch
  }
  if (from === null) return "Earlier activity is still being added"
  return `Epoch ${from} and earlier are still being added`
}

export type EarlierState = "idle" | "loading" | "failed"

/**
 * The first page followed by the pages loaded after it. The first page is
 * live: new rows arrive at its top and push older ones down into what a
 * later page already holds, so a row is kept once, where it first appears.
 */
export function mergeEvents(
  first: readonly ActivityEvent[],
  later: readonly ActivityEvent[],
): ActivityEvent[] {
  const seen = new Set(first.map((event) => event.id))
  const merged = [...first]
  for (const event of later) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    merged.push(event)
  }
  return merged
}

type Later = {
  key: string
  events: ActivityEvent[]
  /** The next page's cursor; undefined before the first, null after the last. */
  cursor: string | null | undefined
  /** The last page came back with older epochs not stored yet. */
  pending: boolean
  /** Rows the last page added; null before any. */
  added: number | null
}

export type EarlierPages = {
  /** The events of the pages loaded so far, after the first view's. */
  events: ActivityEvent[]
  more: boolean
  pending: boolean
  /** Rows the last page added, for screen readers; null before any. */
  added: number | null
  state: EarlierState
  loadMore: () => void
}

/**
 * Pages after a wallet's first view, kept for `key` only (a wallet and a
 * filter), so another wallet or filter starts over: a page that arrives
 * after its key was left is dropped. `first.cursor` is the first page's
 * `nextCursor`, or undefined to start from the top. A failed page leaves
 * what is loaded as it is and can be asked for again.
 */
export function useEarlierPages(
  key: string,
  first: { cursor: string | null | undefined; pending?: boolean | undefined },
  load: ((cursor: string | undefined) => Promise<ActivityPage>) | undefined,
): EarlierPages {
  const [stored, setStored] = useState<Later | null>(null)
  const later: Later =
    stored !== null && stored.key === key
      ? stored
      : {
          key,
          events: [],
          cursor: first.cursor,
          pending: first.pending === true,
          added: null,
        }
  const [state, setState] = useState<{ key: string; value: EarlierState }>({
    key,
    value: "idle",
  })
  const current = state.key === key ? state.value : "idle"
  // The key on screen now, for loads that finish after it changed.
  const shown = useRef(key)
  useEffect(() => {
    shown.current = key
  }, [key])

  async function more(): Promise<void> {
    if (load === undefined || later.cursor === null || current === "loading") {
      return
    }
    setState({ key, value: "loading" })
    try {
      const page = await load(later.cursor)
      if (shown.current !== key) {
        // Left before it arrived: free the button for a return.
        setState((s) => (s.key === key ? { key, value: "idle" } : s))
        return
      }
      const events = mergeEvents(later.events, page.events)
      setStored({
        key,
        events,
        cursor: page.nextCursor,
        pending: page.pending === true,
        added: events.length - later.events.length,
      })
      setState({ key, value: "idle" })
    } catch {
      if (shown.current !== key) {
        setState((s) => (s.key === key ? { key, value: "idle" } : s))
        return
      }
      setState({ key, value: "failed" })
    }
  }

  return {
    events: later.events,
    more: load !== undefined && later.cursor !== null,
    pending: later.cursor === null && later.pending,
    added: later.added,
    state: current,
    loadMore: () => void more(),
  }
}

function rowsAdded(count: number): string {
  return count === 1 ? "1 row added" : `${count} rows added`
}

/**
 * Below a wallet's history: the epochs shown, and the control that loads
 * the ones before them. `more` while an older page exists; `pending` when
 * the last page is reached and older epochs are on their way (the API
 * says so only while they are). When the last page takes the button
 * away, focus moves to the range line, which also tells screen readers
 * how many rows arrived (`added`).
 */
export function EarlierFooter({
  events,
  more,
  pending,
  added = null,
  state,
  onMore,
}: {
  events: readonly ActivityEvent[]
  more: boolean
  pending: boolean
  added?: number | null
  state: EarlierState
  onMore: () => void
}): ReactNode {
  const span = epochSpan(events)
  const range = useRef<HTMLParagraphElement>(null)
  const hadMore = useRef(more)
  useEffect(() => {
    // The button was focused and is gone: keep focus in the list's footer.
    const lost =
      document.activeElement === null ||
      document.activeElement === document.body
    if (hadMore.current && !more && lost) range.current?.focus()
    hadMore.current = more
  }, [more])
  if (span === "" && !more && !pending) return null
  return (
    <footer className="mt-8 flex flex-col items-center gap-3 text-center">
      <p
        ref={range}
        tabIndex={-1}
        aria-live="polite"
        className="rounded-sm text-[15px] text-sec tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-ink"
      >
        <span data-epoch-span>{span}</span>
        {added === null ? null : (
          <span className="sr-only">. {rowsAdded(added)}</span>
        )}
      </p>
      {pending ? (
        <div className="flex flex-col gap-1">
          <p className="text-[15px] text-sec">{pendingLine(events)}</p>
          <p className="text-[13px] text-mut">Check back in a few days</p>
        </div>
      ) : null}
      {more ? (
        <PillButton.Root
          intent="secondary"
          pending={state === "loading"}
          onClick={onMore}
        >
          {state === "failed" ? "Try again" : "Show earlier epochs"}
        </PillButton.Root>
      ) : null}
      {state === "failed" ? (
        <p role="alert" className="text-[15px] text-sec">
          Not loaded
        </p>
      ) : null}
    </footer>
  )
}

// ---------------------------------------------------------------------------
// Download CSV's refusals (data/history-export.server.ts): a refused or
// failed download comes back to the page as `?download=<reason>`, shown
// beside the link on Activity and Rewards.
// ---------------------------------------------------------------------------

const downloadNotices: Record<string, string> = {
  busy: "Too many downloads. Try again in a minute.",
  "busy-day": "Too many downloads today. Try again tomorrow.",
  none: "No history to download for this wallet yet.",
  failed: "Download failed. Try again.",
}

/** The message for a page's `download` query, or null. */
export function downloadNotice(search: string): string | null {
  const reason = new URLSearchParams(search).get("download")
  // Own keys only: `?download=__proto__` would read the prototype.
  if (reason === null || !Object.hasOwn(downloadNotices, reason)) return null
  return downloadNotices[reason] ?? null
}

/**
 * Why the last download did not happen, read out when it shows. Read from
 * the router at render: the reason only ever arrives with a page load.
 * Outside a router (unit tests) there is none.
 */
export function DownloadNotice({
  className = "",
}: {
  className?: string
}): ReactNode {
  const router = useRouter({ warn: false }) as
    | ReturnType<typeof useRouter>
    | undefined
  const search = router?.state.location.searchStr ?? ""
  const notice = downloadNotice(search)
  if (notice === null) return null
  return (
    <p role="alert" className={`text-[15px] text-neg ${className}`}>
      {notice}
    </p>
  )
}
