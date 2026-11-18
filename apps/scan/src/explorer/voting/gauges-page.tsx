import { TokenIcon } from "@matchbox/token-icons"
import * as DataTable from "@matchbox/ui/data-table"
import * as SubTabs from "@matchbox/ui/sub-tabs"
import { Link } from "@tanstack/react-router"
import { type ReactNode, Suspense, useLayoutEffect, useRef } from "react"
import type {
  DirectoryView,
  GaugeSort,
  GaugesPage,
  GaugeType,
} from "../../data/gauges"
import { deferred } from "../../shell/deferred"
import { PageTitle } from "../../shell/page"
import { SectionState } from "../parts"
import {
  GaugeTitle,
  KindIcon,
  MatchboxAction,
  proOrigin,
  TabCount,
} from "./parts"

/** Where veBTC votes go, best APY and emissions: code after first paint. */
const GaugesPanels = deferred(() =>
  import("./gauges-panels").then((module) => module.GaugesPanels),
)
/** Paid to voters: its chart's code off the first paint's budget. */
const PaidPanel = deferred(() =>
  import("./paid-panel").then((module) => module.PaidPanel),
)
/**
 * Gauges (`ELrUTI5YDe`): paid to voters, where veBTC votes go, the best
 * APYs and MEZO
 * emissions by epoch for the whole epoch, then every gauge this epoch with
 * the gauge types as sub-tabs (with their counts) and the order in one row
 * over the table, so a tab sits next to what it filters. The order is
 * text, the current one in ink and bolder, not a filled pill beside the
 * tabs. The panels do not change with the tab. Paid to voters is in USD
 * at each epoch's closing daily prices.
 */

const typeTabs: { type: GaugeType; label: string }[] = [
  { type: "all", label: "All" },
  { type: "vebtc", label: "veBTC gauges" },
  { type: "mezo", label: "MEZO gauges" },
  { type: "validator", label: "Validators" },
  { type: "pool", label: "Pools" },
]

const listTitles: Record<GaugeType, string> = {
  all: "All gauges",
  vebtc: "veBTC gauges",
  mezo: "MEZO gauges",
  validator: "Validator gauges",
  pool: "Pool gauges",
}

const sorts: { sort: GaugeSort; label: string }[] = [
  { sort: "votes", label: "Votes" },
  { sort: "rewards", label: "Rewards" },
  { sort: "apy", label: "APY" },
  { sort: "voters", label: "Voters" },
]

function searchFor(
  type: GaugeType,
  sort: GaugeSort,
): { type?: Exclude<GaugeType, "all">; sort?: GaugeSort } {
  return {
    ...(type === "all" ? {} : { type }),
    ...(sort === "votes" ? {} : { sort }),
  }
}

export function GaugesView({ page }: { page: GaugesPage }): ReactNode {
  const directory = page.directory.status === "ok" ? page.directory.data : null
  const list = useRef<HTMLElement | null>(null)
  const shownType = useRef(page.type)
  // A tab keeps the scroll position, but a shorter list can leave the
  // reader in the footer: past the list's top, go back to it.
  useLayoutEffect(() => {
    if (shownType.current === page.type) return
    shownType.current = page.type
    const section = list.current
    if (section === null) return
    const top = section.getBoundingClientRect().top + window.scrollY
    if (window.scrollY > top) window.scrollTo({ top })
  }, [page.type])
  return (
    <>
      <header className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <PageTitle>Gauges</PageTitle>
        <span className="flex-1" />
        {directory === null ? null : (
          <p className="flex flex-col items-end text-right text-[15px] max-md:items-start max-md:text-left">
            <span className="font-semibold">
              Epoch {directory.epoch.number}
            </span>
            <span className="text-acc-ink">
              {directory.epoch.closesIn === null
                ? "Closed"
                : `Closes in ${directory.epoch.closesIn}`}
            </span>
          </p>
        )}
        <MatchboxAction href={`${proOrigin}/vote`}>
          Vote on Matchbox
        </MatchboxAction>
      </header>
      <div className="mt-6 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <Suspense fallback={null}>
          <PaidPanel paid={page.paid} />
        </Suspense>
        <Suspense fallback={null}>
          <GaugesPanels directory={page.directory} emissions={page.emissions} />
        </Suspense>
      </div>
      <section ref={list} aria-labelledby="all-gauges" className="mt-12">
        <h2
          id="all-gauges"
          className="text-[24px] font-[650] tracking-[-0.015em]"
        >
          {listTitles[page.type]}
        </h2>
        <div className="mt-2 mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 lg:sticky lg:top-0 lg:z-10 lg:flex-nowrap lg:bg-bg lg:shadow-[inset_0_-1px_0_var(--line)]">
          <SubTabs.Root label="Gauge types" className="max-lg:w-full lg:flex-1">
            {typeTabs.map((tab) => (
              <SubTabs.Item key={tab.type}>
                <Link
                  to="/gauges"
                  search={searchFor(tab.type, page.sort)}
                  resetScroll={false}
                  aria-current={tab.type === page.type ? "page" : undefined}
                  activeOptions={{ exact: true, includeSearch: true }}
                  activeProps={{}}
                >
                  {tab.label}
                  <TabCount value={directory?.counts[tab.type] ?? null} />
                </Link>
              </SubTabs.Item>
            ))}
          </SubTabs.Root>
          <nav
            aria-label="Order"
            className="-mx-3.5 flex flex-none gap-1 lg:mx-0"
          >
            {sorts.map((each) => (
              <Link
                key={each.sort}
                to="/gauges"
                search={searchFor(page.type, each.sort)}
                resetScroll={false}
                aria-current={each.sort === page.sort ? "true" : undefined}
                activeOptions={{ exact: true, includeSearch: true }}
                activeProps={{}}
                className="grid h-9 items-center justify-items-center px-3.5 text-[15px] font-medium text-sec outline-none hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink [&[aria-current]]:font-semibold [&[aria-current]]:text-ink"
              >
                <span className="col-start-1 row-start-1">{each.label}</span>
                <span
                  aria-hidden="true"
                  className="invisible col-start-1 row-start-1 font-semibold"
                >
                  {each.label}
                </span>
              </Link>
            ))}
          </nav>
        </div>
        {page.directory.status === "ok" ? (
          <>
            <DirectoryPager
              page={page}
              directory={page.directory.data}
              position="top"
            />
            <GaugeTable
              directory={page.directory.data}
              caption={listTitles[page.type]}
            />
            <DirectoryPager
              page={page}
              directory={page.directory.data}
              position="bottom"
            />
          </>
        ) : (
          <SectionState section={page.directory} />
        )}
      </section>
    </>
  )
}

const pagerLink =
  "flex h-10 items-center rounded-[20px] bg-soft px-4 text-[15px] font-semibold text-ink outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink"

/**
 * One page of the directory at a time: where this page sits in the whole
 * order, and plain links to the next page and back to the top, so paging
 * works without script. The same pager sits above the table, so nobody
 * scrolls to the foot of the page to turn it, and below it. The bottom
 * one's links land on the table's heading (`#all-gauges`).
 */
function DirectoryPager({
  page,
  directory,
  position,
}: {
  page: GaugesPage
  directory: DirectoryView
  position: "top" | "bottom"
}): ReactNode {
  if (directory.total === 0) return null
  // A single page needs no pager under its table.
  if (position === "bottom" && directory.from === 1 && directory.next === null)
    return null
  const last = directory.from + directory.rows.length - 1
  const search = searchFor(page.type, page.sort)
  return (
    <nav
      aria-label={position === "top" ? "Gauge pages" : "Pages, end of list"}
      className={
        position === "top"
          ? "mb-3 flex min-h-10 flex-wrap items-center gap-3"
          : "mt-2 flex min-h-16 flex-wrap items-center gap-3 border-t border-line pt-5"
      }
    >
      <p className="mr-auto text-[15px] text-sec tabular-nums">
        {directory.restarted ? "That page is gone, so from the top: " : ""}
        {directory.from === 1 && directory.next === null
          ? `All ${directory.total} gauges`
          : `Gauges ${directory.from} to ${last} of ${directory.total}`}
      </p>
      {directory.from > 1 ? (
        <Link
          to="/gauges"
          search={search}
          hash="all-gauges"
          // Not "the current page": the router's match ignores the search.
          activeOptions={{ exact: true, includeSearch: true }}
          activeProps={{}}
          className={pagerLink}
        >
          From the top
        </Link>
      ) : null}
      {directory.next === null ? null : (
        <Link
          to="/gauges"
          search={{ ...search, after: directory.next }}
          hash="all-gauges"
          className={pagerLink}
        >
          Next {directory.nextCount}
        </Link>
      )}
    </nav>
  )
}

function GaugeTable({
  directory,
  caption,
}: {
  directory: DirectoryView
  caption: string
}): ReactNode {
  return (
    <DataTable.Root caption={caption} captionHidden reflow="lg">
      <DataTable.Header>
        <DataTable.Column>Gauge</DataTable.Column>
        <DataTable.Column>Type</DataTable.Column>
        <DataTable.Column align="end">Votes</DataTable.Column>
        <DataTable.Column align="end">Voters</DataTable.Column>
        <DataTable.Column align="end">Rewards</DataTable.Column>
        <DataTable.Column align="end">APY</DataTable.Column>
        <DataTable.Column align="end">
          <span className="sr-only">Vote</span>
        </DataTable.Column>
      </DataTable.Header>
      <DataTable.Body>
        {directory.rows.length === 0 ? (
          <DataTable.Empty columns={7}>No gauges</DataTable.Empty>
        ) : (
          directory.rows.map((row) => (
            <DataTable.Row
              key={row.gauge.address}
              className={row.expired ? "text-sec" : undefined}
            >
              <DataTable.Cell phone="title" className="max-w-[22rem]">
                <GaugeTitle
                  gauge={row.gauge}
                  subline={row.expired ? "Expired" : row.tagline}
                />
              </DataTable.Cell>
              <DataTable.Cell>
                <KindIcon kind={row.gauge.kind} />
              </DataTable.Cell>
              <DataTable.Cell align="end" phone="value">
                <span className="flex flex-col items-end">
                  <span className="font-semibold whitespace-nowrap">
                    <span className="max-lg:hidden">{row.votes}</span>
                    <span className="lg:hidden">{row.votesShort}</span>
                  </span>
                  {row.votesNote === null ? null : (
                    <span className="text-[14px] text-sec max-lg:hidden">
                      {row.votesNote}
                    </span>
                  )}
                </span>
              </DataTable.Cell>
              <DataTable.Cell align="end">{row.voters}</DataTable.Cell>
              <DataTable.Cell align="end" phone="meta">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="flex max-lg:hidden">
                    {row.rewardTickers.slice(0, 3).map((ticker, index) => (
                      <TokenIcon
                        key={ticker}
                        ticker={ticker}
                        size={18}
                        className={index === 0 ? "" : "-ml-1.5 ring-2 ring-bg"}
                      />
                    ))}
                  </span>
                  {row.rewards}
                </span>
              </DataTable.Cell>
              <DataTable.Cell
                align="end"
                phone="detail"
                className="max-lg:text-left"
              >
                {row.apy === null ? null : (
                  <>
                    <span className="lg:hidden">APY </span>
                    {row.apy}
                  </>
                )}
              </DataTable.Cell>
              <DataTable.Cell align="end">
                <a
                  href={row.proUrl}
                  className="inline-flex h-9 items-center rounded-[18px] bg-soft px-3.5 text-[14.5px] font-semibold whitespace-nowrap text-ink outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink"
                >
                  Vote on Matchbox
                </a>
              </DataTable.Cell>
            </DataTable.Row>
          ))
        )}
      </DataTable.Body>
    </DataTable.Root>
  )
}
