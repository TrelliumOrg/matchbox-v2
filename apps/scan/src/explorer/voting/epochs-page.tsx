import * as DataTable from "@matchbox/ui/data-table"
import { Glyph, shapes } from "@matchbox/ui/icons"
import { Link } from "@tanstack/react-router"
import { type ReactNode, Suspense } from "react"
import type { CurrentEpoch, EpochsPage, VotesCast } from "../../data/epochs"
import type { Section } from "../../data/explorer"
import type { EmissionsView } from "../../data/gauges"
import { deferred } from "../../shell/deferred"
import { PageTitle } from "../../shell/page"
import { Filling } from "../filling"
import { Pager, SectionHeading, SectionState } from "../parts"
import {
  EpochBars,
  Figure,
  GaugeTitle,
  MatchboxAction,
  Panel,
  PanelEmpty,
  PanelState,
  proOrigin,
  reserveFor,
  Stats,
} from "./parts"
import { WeekProgress } from "./week"

/** Voting APR: its panel's code off the first paint's budget. */
const EpochFigurePanel = deferred(() =>
  import("./paid-panel").then((module) => module.EpochFigurePanel),
)
/** Paid to voters: its chart's code off the first paint's budget. */
const PaidPanel = deferred(() =>
  import("./paid-panel").then((module) => module.PaidPanel),
)
/**
 * Epochs (`T4lYGIj9dz`): the current epoch with its week so far,
 * emissions, rewards to voters (USD at each epoch's closing daily prices),
 * votes cast, what veBTC is paid by source (voters' incentives and pool
 * fees, every lock's chain fees) and voting APR per epoch, and the epochs
 * with keyset paging. Left out:
 * the Emissions, Rewards and Votes sub-tabs (their panels sit on this
 * page), Watch.
 */

export function EpochsView({ page }: { page: EpochsPage }): ReactNode {
  return (
    <>
      <div className="flex items-end gap-3">
        <PageTitle>Epochs</PageTitle>
        <span
          role="img"
          aria-label="Starts Thursday 00:00 UTC"
          title="Starts Thursday 00:00 UTC"
          className="mb-3 text-sec max-xl:mb-1.5"
        >
          <Glyph shape={shapes.calendarDays} size={18} strokeWidth={1.75} />
        </span>
      </div>
      <Current current={page.current} />
      <div className="mt-4 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <Emissions emissions={page.emissions} />
        <Suspense fallback={null}>
          <PaidPanel paid={page.rewards} label="Rewards to voters per epoch" />
        </Suspense>
        <Votes votes={page.votes} />
        <Suspense fallback={null}>
          <PaidPanel paid={page.paid} label="Paid to veBTC by source" />
        </Suspense>
        <VotingApr page={page} />
      </div>
      <section aria-labelledby="recent-epochs" className="mt-12">
        <SectionHeading id="recent-epochs">
          {page.paged ? "Older epochs" : "Recent epochs"}
        </SectionHeading>
        {page.table.status !== "ok" ? (
          <SectionState section={page.table} />
        ) : (
          <>
            {page.table.data.filling === null ? null : (
              <Filling asOf={page.table.data.filling.asOf} className="mb-3" />
            )}
            <Pager
              position="top"
              label="Epoch pages"
              paged={page.paged}
              next={page.table.data.next}
              restarted={page.table.restarted}
              to="/epochs"
            />
            <DataTable.Root caption="Epochs" captionHidden reflow="lg">
              <DataTable.Header>
                <DataTable.Column>Epoch</DataTable.Column>
                <DataTable.Column>Dates</DataTable.Column>
                <DataTable.Column align="end">Emissions</DataTable.Column>
                <DataTable.Column align="end">Votes cast</DataTable.Column>
                <DataTable.Column align="end">Voters</DataTable.Column>
                <DataTable.Column>Incentives</DataTable.Column>
                <DataTable.Column>Fees to voters</DataTable.Column>
                <DataTable.Column>Top veBTC gauge</DataTable.Column>
              </DataTable.Header>
              <DataTable.Body>
                {page.table.data.rows.length === 0 ? (
                  <DataTable.Empty columns={8}>No epochs yet</DataTable.Empty>
                ) : (
                  page.table.data.rows.map((row) => (
                    <DataTable.Row key={row.number}>
                      <DataTable.Cell phone="title">
                        <Link
                          to="/epochs/$epoch"
                          params={{ epoch: String(row.number) }}
                          className="rounded-sm font-semibold whitespace-nowrap outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
                        >
                          Epoch {row.number}
                        </Link>
                        {row.current ? (
                          <span className="ml-2 text-[14px] text-sec">
                            Current
                          </span>
                        ) : null}
                        {row.complete ? null : (
                          <span className="ml-2 text-[14px] text-sec">
                            Still filling
                          </span>
                        )}
                      </DataTable.Cell>
                      <DataTable.Cell
                        phone="detail"
                        className="whitespace-nowrap"
                      >
                        {row.dates}
                      </DataTable.Cell>
                      <DataTable.Cell align="end" phone="value">
                        <span className="font-semibold whitespace-nowrap">
                          {row.emission ?? ""}
                        </span>
                      </DataTable.Cell>
                      <DataTable.Cell align="end" phone="meta">
                        {row.votes}
                        <span className="lg:hidden"> votes</span>
                      </DataTable.Cell>
                      <DataTable.Cell align="end">{row.voters}</DataTable.Cell>
                      <DataTable.Cell>
                        {row.incentives ?? "None"}
                      </DataTable.Cell>
                      <DataTable.Cell>
                        {row.fees ?? "None"}
                        {row.current && row.fees !== null ? (
                          <span className="text-[14px] text-sec"> so far</span>
                        ) : null}
                      </DataTable.Cell>
                      <DataTable.Cell>
                        {row.topGauge === null ? null : (
                          <GaugeTitle gauge={row.topGauge} size={22} />
                        )}
                      </DataTable.Cell>
                    </DataTable.Row>
                  ))
                )}
              </DataTable.Body>
            </DataTable.Root>
            <Pager
              position="bottom"
              label="Epoch pages"
              paged={page.paged}
              next={page.table.data.next}
              skipped={page.table.skipped}
              restarted={page.table.restarted}
              to="/epochs"
            />
          </>
        )}
      </section>
    </>
  )
}

function Current({ current }: { current: Section<CurrentEpoch> }): ReactNode {
  if (current.status !== "ok") {
    return (
      <div className="mt-6">
        <SectionState section={current} />
      </div>
    )
  }
  const epoch = current.data
  return (
    <section
      aria-labelledby="current-epoch"
      className="mt-6 rounded-[24px] bg-soft p-7 max-md:p-5"
    >
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] text-ink2">Current epoch</p>
          <h2
            id="current-epoch"
            className="mt-1 text-[40px] leading-tight font-[650] tracking-[-0.02em] max-md:text-[32px]"
          >
            <Link
              to="/epochs/$epoch"
              params={{ epoch: String(epoch.span.number) }}
              className="rounded-sm outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
            >
              Epoch {epoch.span.number}
            </Link>
          </h2>
          <p className="mt-1 text-[15px] text-sec">{epoch.span.dates}</p>
        </div>
        <p className="flex flex-col items-end text-right">
          <span className="text-[15px] text-sec">Closes in</span>
          <span className="text-[28px] font-[650] tabular-nums">
            {epoch.closesIn}
          </span>
        </p>
        <MatchboxAction href={`${proOrigin}/vote`}>
          Vote on Matchbox
        </MatchboxAction>
      </div>
      <WeekProgress progress={epoch.progress} />
      {epoch.filling === null ? null : (
        <Filling asOf={epoch.filling.asOf} className="mt-5" />
      )}
      {epoch.computed ? (
        <div className="mt-5 border-t border-line pt-1">
          <Stats stats={epoch.stats} />
        </div>
      ) : null}
    </section>
  )
}

function Emissions({
  emissions,
}: {
  emissions: Section<EmissionsView | null>
}): ReactNode {
  const data = emissions.status === "ok" ? emissions.data : null
  return (
    <Panel
      label="Emissions per epoch"
      className="col-span-2 max-lg:col-span-1"
      aside={
        data === null ? null : (
          <span className="text-[14px] font-semibold">
            Since Epoch {data.since}
          </span>
        )
      }
    >
      {emissions.status !== "ok" ? (
        <PanelState section={emissions} />
      ) : data === null ? (
        <PanelEmpty>No emissions yet</PanelEmpty>
      ) : (
        <>
          <Figure
            value={data.figure}
            note={data.note}
            reserve={reserveFor(data.bars)}
          />
          {data.filling === null ? null : (
            <Filling asOf={data.filling.asOf} className="mt-1" />
          )}
          <Stats stats={data.stats} />
          <EpochBars bars={data.bars} label="Emissions per epoch" />
        </>
      )}
    </Panel>
  )
}

function Votes({ votes }: { votes: Section<VotesCast | null> }): ReactNode {
  const data = votes.status === "ok" ? votes.data : null
  return (
    <Panel label="Votes cast per epoch">
      {votes.status !== "ok" ? (
        <PanelState section={votes} />
      ) : data === null ? (
        <PanelEmpty>No votes yet</PanelEmpty>
      ) : (
        <>
          <Figure
            value={data.figure}
            note={`votes, Epoch ${data.latest}`}
            reserve={reserveFor(data.bars)}
          />
          <Stats stats={data.stats} />
          <EpochBars bars={data.bars} label="Votes cast per epoch" />
        </>
      )}
    </Panel>
  )
}

/** Voting APR per epoch, as the market cron computed each epoch's. */
function VotingApr({ page }: { page: EpochsPage }): ReactNode {
  return (
    <Suspense fallback={null}>
      <EpochFigurePanel
        label="veBTC voting APR per epoch"
        section={page.apr}
        empty="No priced rewards yet"
      />
    </Suspense>
  )
}
