import { shortAddress } from "@matchbox/domain/format"
import * as Age from "@matchbox/ui/age"
import * as DataTable from "@matchbox/ui/data-table"
import * as SubTabs from "@matchbox/ui/sub-tabs"
import { Link } from "@tanstack/react-router"
import { type ReactNode, Suspense } from "react"
import type { Escrow, LockOrder, LocksPage } from "../../data/locks"
import { deferred } from "../../shell/deferred"
import { PageTitle } from "../../shell/page"
import { escrowName, lockSubline } from "../address/shared"
import { Pager, SectionState } from "../parts"
import {
  MatchboxAction,
  Panel,
  PanelState,
  proOrigin,
  RangeToggle,
} from "./parts"
import type { PeriodView, Range } from "./range"

/**
 * Locks (`uNyejMCnPb`): veBTC and veMEZO as sub-tabs, the amount locked
 * and the net flow per day (escrow series), lock length, permanent against
 * timed, the unlock calendar and lock size (every lock read from the
 * chain once a day), and the locks by amount, unlock or creation with
 * keyset paging. Left out until their data exists: tab counts (no count
 * route), share of TVL, and each lock's voting power and gauge (not on
 * the lock list).
 */

/** The two daily series: the chart's code after first paint. */
const SeriesBody = deferred(() =>
  import("./series-panel").then((module) => module.SeriesBody),
)
/** The daily lock distribution panels: their code after first paint. */
/** The custom span's button and box, off the first paint's scripts. */
const CustomPeriod = deferred(() =>
  import("./custom-period").then((module) => module.CustomPeriod),
)

const LockDistributionPanels = deferred(() =>
  import("./paid-panel").then((module) => module.LockDistributionPanels),
)

type Search = {
  escrow?: "vemezo"
  order?: Exclude<LockOrder, "amount">
  range?: Exclude<Range, "30d">
  from?: string
  to?: string
}

/** The page's search: a custom span is kept as the days it settled on. */
function searchFor(
  escrow: Escrow,
  order: LockOrder,
  period: PeriodView,
): Search {
  return {
    ...(escrow === "vemezo" ? { escrow } : {}),
    ...(order === "amount" ? {} : { order }),
    ...(period.range === null
      ? { from: period.from, to: period.to }
      : period.range === "30d"
        ? {}
        : { range: period.range }),
  }
}

const orders: { order: LockOrder; label: string }[] = [
  { order: "amount", label: "Largest" },
  // Soonest unlock date first, which starts with locks already past it.
  { order: "unlock", label: "By unlock date" },
  { order: "created", label: "Newest" },
]

const assets = { vebtc: "BTC", vemezo: "MEZO" } as const

export function LocksView({ page }: { page: LocksPage }): ReactNode {
  const asset = assets[page.escrow]
  const rangeSearch = {
    escrow: page.escrow === "vemezo" ? page.escrow : undefined,
    order: page.order === "amount" ? undefined : page.order,
  }
  return (
    <>
      <header className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <PageTitle>Locks</PageTitle>
        <span className="flex-1" />
        <MatchboxAction href={proOrigin}>Lock on Matchbox</MatchboxAction>
      </header>
      <SubTabs.Root label="Escrows" className="mt-5">
        {(["vebtc", "vemezo"] as const).map((escrow) => (
          <SubTabs.Item key={escrow}>
            <Link
              to="/locks"
              search={searchFor(escrow, page.order, page.period)}
              resetScroll={false}
              aria-current={escrow === page.escrow ? "page" : undefined}
              activeOptions={{ exact: true, includeSearch: true }}
              activeProps={{}}
            >
              {escrowName[escrow]}
            </Link>
          </SubTabs.Item>
        ))}
      </SubTabs.Root>
      <div className="mt-6 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <Panel
          label={`${asset} locked`}
          aside={
            <RangeToggle
              period={page.period}
              to="/locks"
              search={rangeSearch}
              label={`Period, ${asset} locked`}
            >
              <Suspense fallback={null}>
                <CustomPeriod period={page.period} search={rangeSearch} />
              </Suspense>
            </RangeToggle>
          }
        >
          {page.locked.status !== "ok" ? (
            <PanelState section={page.locked} />
          ) : (
            <Suspense fallback={null}>
              <SeriesBody
                name={`${asset} locked`}
                data={page.locked.data}
                stats={page.lockedStats}
                empty="Nothing locked yet"
              />
            </Suspense>
          )}
        </Panel>
        <Panel
          label={`Net ${asset} locked per day`}
          aside={
            <RangeToggle
              period={page.period}
              to="/locks"
              search={rangeSearch}
              label={`Period, net ${asset} locked per day`}
            >
              <Suspense fallback={null}>
                <CustomPeriod period={page.period} search={rangeSearch} />
              </Suspense>
            </RangeToggle>
          }
        >
          {page.net.status !== "ok" ? (
            <PanelState section={page.net} />
          ) : (
            <Suspense fallback={null}>
              <SeriesBody
                name={`Net ${asset} locked per day`}
                data={page.net.data}
                stats={page.netStats}
                empty="No locks yet"
              />
            </Suspense>
          )}
        </Panel>
        <Suspense fallback={null}>
          <LockDistributionPanels
            distribution={page.distribution}
            escrow={page.escrow}
          />
        </Suspense>
      </div>
      <section aria-labelledby="lock-list" className="mt-12">
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2
            id="lock-list"
            className="mr-auto text-[24px] font-[650] tracking-[-0.015em]"
          >
            {escrowName[page.escrow]} locks
          </h2>
          <nav aria-label="Order" className="-mx-3.5 flex gap-1 md:mx-0">
            {orders.map((each) => (
              <Link
                key={each.order}
                to="/locks"
                search={searchFor(page.escrow, each.order, page.period)}
                resetScroll={false}
                aria-current={each.order === page.order ? "true" : undefined}
                activeOptions={{ exact: true, includeSearch: true }}
                activeProps={{}}
                className="flex h-9 items-center rounded-[18px] px-3.5 text-[15px] font-semibold whitespace-nowrap text-sec outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink [&[aria-current]]:bg-soft [&[aria-current]]:text-ink"
              >
                {each.label}
              </Link>
            ))}
          </nav>
        </div>
        {page.list.status !== "ok" ? (
          <SectionState section={page.list} />
        ) : (
          <>
            {page.list.data.expired > 0 ? (
              <p role="status" className="mb-3 text-[14.5px] text-sec">
                Locks past their unlock date and not yet withdrawn come first
              </p>
            ) : null}
            <Pager
              position="top"
              label="Lock pages"
              paged={page.paged}
              next={page.list.data.next}
              restarted={page.list.restarted}
              to="/locks"
              extra={searchFor(page.escrow, page.order, page.period)}
            />
            <DataTable.Root
              caption={`${escrowName[page.escrow]} locks`}
              captionHidden
              reflow="md"
            >
              <DataTable.Header>
                <DataTable.Column>Lock</DataTable.Column>
                <DataTable.Column>Owner</DataTable.Column>
                <DataTable.Column align="end">Amount</DataTable.Column>
                <DataTable.Column>Unlocks</DataTable.Column>
                <DataTable.Column align="end">Created</DataTable.Column>
              </DataTable.Header>
              <DataTable.Body>
                {page.list.data.rows.length === 0 ? (
                  <DataTable.Empty columns={5}>No locks</DataTable.Empty>
                ) : (
                  page.list.data.rows.map((lock) => (
                    <DataTable.Row key={lock.id}>
                      <DataTable.Cell phone="title">
                        <Link
                          to="/locks/$escrow/$id"
                          params={{ escrow: page.escrow, id: lock.id }}
                          className="rounded-sm font-semibold whitespace-nowrap outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
                        >
                          {escrowName[page.escrow]} #{lock.id}
                        </Link>
                      </DataTable.Cell>
                      <DataTable.Cell phone="meta">
                        {lock.owner === null ? null : (
                          <Link
                            to="/address/$address"
                            params={{ address: lock.owner }}
                            className="rounded-sm font-mono text-[14.5px] outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
                          >
                            {shortAddress(lock.owner)}
                          </Link>
                        )}
                      </DataTable.Cell>
                      <DataTable.Cell align="end" phone="value">
                        <span className="font-semibold whitespace-nowrap">
                          {lock.amount}
                        </span>
                      </DataTable.Cell>
                      <DataTable.Cell phone="detail">
                        {lockSubline(lock)}
                      </DataTable.Cell>
                      <DataTable.Cell align="end" className="text-sec">
                        {lock.createdAt === null ? null : (
                          <Age.Root timestamp={lock.createdAt} now={page.now} />
                        )}
                      </DataTable.Cell>
                    </DataTable.Row>
                  ))
                )}
              </DataTable.Body>
            </DataTable.Root>
            <Pager
              position="bottom"
              label="Lock pages"
              paged={page.paged}
              next={page.list.data.next}
              skipped={page.list.skipped}
              restarted={page.list.restarted}
              to="/locks"
              extra={searchFor(page.escrow, page.order, page.period)}
            />
          </>
        )}
      </section>
    </>
  )
}
