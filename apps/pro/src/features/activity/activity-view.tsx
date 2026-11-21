import { whenIdle } from "@matchbox/motion"
import * as FilterTabs from "@matchbox/ui/filter-tabs"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as ListRow from "@matchbox/ui/list-row"
import * as PillButton from "@matchbox/ui/pill-button"
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react"
import {
  ActivityRow,
  DownloadNotice,
  EarlierFooter,
  mergeEvents,
  useEarlierPages,
} from "../../components/activity-row"
import type {
  ActivityEvent,
  ActivityFilter,
  ActivityPage,
} from "../../data/view-models"
import { formatDayLong } from "../../lib/format"
import { gaugeName } from "../../lib/gauge-name"
import { useViewer, useViewingOther } from "../../lib/viewer"
import { PageTitle, underlineLink } from "../../shell/page"
import { EmptyState } from "../../shell/states"
import { openTx, txIntent } from "../../tx/tx-store"
import { activityFilters } from "./filters"

/** Activity (`-dmOkkEPD4`) and Activity, none (`r13Ve8l5Ls`). */

function loadSheet() {
  return import("./activity-sheet")
}

// Loads once the page is idle, so the sheet slides in on the click instead
// of after its code arrives.
const ActivitySheet = lazy(loadSheet)

function dayKey(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10)
}

export function groupByDay(
  events: readonly ActivityEvent[],
  today: number,
): { heading: string; events: ActivityEvent[] }[] {
  const groups: { key: string; heading: string; events: ActivityEvent[] }[] = []
  for (const event of events) {
    const key = dayKey(event.at)
    const last = groups[groups.length - 1]
    if (last !== undefined && last.key === key) {
      last.events.push(event)
    } else {
      groups.push({
        key,
        heading: key === dayKey(today) ? "Today" : formatDayLong(event.at),
        events: [event],
      })
    }
  }
  return groups
}

export { mergeEvents }

function matches(event: ActivityEvent, needle: string): boolean {
  if (needle === "") return true
  const detail = event.detail
  const haystack = [event.tx, `epoch ${event.epoch}`]
  if (detail.kind === "vote" || detail.kind === "lock")
    haystack.push(`#${detail.lock.tokenId}`)
  if (detail.kind === "vote")
    haystack.push(...detail.allocation.map((entry) => gaugeName(entry.gauge)))
  if (detail.kind === "claim")
    haystack.push(
      ...detail.gauges,
      ...detail.locks.map((lock) => `#${lock.tokenId}`),
    )
  if (detail.kind === "incentive") haystack.push(gaugeName(detail.gauge))
  if (detail.kind === "own") haystack.push(detail.label)
  return haystack.some((value) => value.toLowerCase().includes(needle))
}

export function ActivityView({
  data,
  filter,
  today,
  onFilter,
  loadMore,
  own = [],
}: {
  data: ActivityPage
  filter: ActivityFilter
  today: number
  onFilter: (filter: ActivityFilter) => void
  /** Reads the page after `cursor`. Without it the list is one page. */
  loadMore?: (cursor: string) => Promise<ActivityPage>
  /**
   * This browser's own transactions the indexer does not list yet, newest
   * first. They lead the list, under All.
   */
  own?: readonly ActivityEvent[]
}): ReactNode {
  const viewer = useViewer()
  const other = useViewingOther()
  useEffect(() => whenIdle(() => void loadSheet()), [])
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<ActivityEvent | null>(null)
  // The sheet keeps the last event so it can slide out.
  const [sheet, setSheet] = useState<ActivityEvent | null>(null)
  if (open !== null && open !== sheet) setSheet(open)
  const mine = filter === "all" ? own : []
  const none = data.counts.all === 0 && mine.length === 0
  // Filtering and search animate (data-flip-list): rows fade in and out,
  // the rest slide.
  // Pages after the first, for this wallet and filter only.
  const earlier = useEarlierPages(
    `${data.address}:${filter}`,
    { cursor: data.nextCursor, pending: data.pending },
    loadMore === undefined
      ? undefined
      : (cursor) =>
          cursor === undefined ? Promise.resolve(data) : loadMore(cursor),
  )
  const loaded = mergeEvents(data.events, earlier.events)
  const events = [...mine, ...loaded].filter((event) =>
    matches(event, query.trim().toLowerCase()),
  )

  return (
    <>
      <PageTitle>Activity</PageTitle>
      {none ? null : (
        <label className="mt-6 flex h-12 items-center gap-2.5 rounded-[24px] bg-soft px-5 text-[15px] text-sec focus-within:outline-2 focus-within:outline-ink">
          <Glyph shape={shapes.search} size={18} />
          <span className="sr-only">Search activity</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by lock, gauge or transaction"
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-sec"
          />
        </label>
      )}
      <FilterTabs.Root
        label="Activity filter"
        value={filter}
        onValueChange={(value) => {
          const next = activityFilters.find((entry) => entry.value === value)
          if (next !== undefined) onFilter(next.value)
        }}
        className="mt-5 -ml-0.5"
      >
        {activityFilters
          .filter((entry) => !none || entry.value !== "incentives")
          .map((entry) => (
            <FilterTabs.Item
              key={entry.value}
              value={entry.value}
              {...(none ? { count: data.counts[entry.value] } : {})}
            >
              {entry.label}
            </FilterTabs.Item>
          ))}
      </FilterTabs.Root>
      {none ? null : (
        <>
          <p className="mt-4 text-[15px]">
            {/* No `download`: a refusal comes back as a page with a
                message, which `download` would save as the file. */}
            <a href={`/${data.address}/activity.csv`} className={underlineLink}>
              Download CSV
            </a>
          </p>
          <DownloadNotice className="mt-1" />
        </>
      )}
      {none ? (
        <EmptyState
          icon={shapes.list}
          title="No activity"
          action={
            other ? undefined : (
              <PillButton.Root
                {...txIntent}
                onClick={() =>
                  openTx(viewer, { flow: "new-lock", kind: "vemezo" })
                }
              >
                <Glyph shape={shapes.plus} size={18} strokeWidth={2.4} />
                New lock
              </PillButton.Root>
            )
          }
        />
      ) : events.length === 0 ? (
        <p className="mt-6 text-[15px] text-sec">No matches</p>
      ) : (
        <div data-flip-list="deep" className="mt-2">
          {groupByDay(events, today).map((group) => (
            <section key={group.heading} aria-label={group.heading}>
              <ListRow.Heading
                data-flip={`day-${group.heading}`}
                className="mt-8 first:mt-7"
              >
                {group.heading}
              </ListRow.Heading>
              <ListRow.List className="mt-1.5">
                {group.events.map((event) => (
                  <ActivityRow
                    key={event.id}
                    event={event}
                    context="dated"
                    flip={event.id}
                    // An own row has no indexed detail to open yet.
                    {...(event.detail.kind === "own"
                      ? {}
                      : { onOpen: () => setOpen(event) })}
                  />
                ))}
              </ListRow.List>
            </section>
          ))}
        </div>
      )}
      {none ? null : (
        <EarlierFooter
          events={loaded}
          more={earlier.more}
          pending={earlier.pending}
          added={earlier.added}
          state={earlier.state}
          onMore={earlier.loadMore}
        />
      )}
      {sheet === null ? null : (
        <Suspense fallback={null}>
          <ActivitySheet
            event={sheet}
            open={open !== null}
            onClose={() => setOpen(null)}
          />
        </Suspense>
      )}
    </>
  )
}
