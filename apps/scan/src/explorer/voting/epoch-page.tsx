import { shortAddress } from "@matchbox/domain/format"
import * as Age from "@matchbox/ui/age"
import * as Breadcrumbs from "@matchbox/ui/breadcrumbs"
import * as DataTable from "@matchbox/ui/data-table"
import { Glyph, shapes } from "@matchbox/ui/icons"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { EpochDoc, EpochPage, SourceTable } from "../../data/epochs"
import type { GaugeKind } from "../../data/scan/voting-views"
import { Filling } from "../filling"
import { SectionHeading, SectionState } from "../parts"
import {
  Figure,
  GaugeName,
  GaugeTitle,
  KindIcon,
  MatchboxAction,
  Panel,
  PanelEmpty,
  proOrigin,
  Stats,
} from "./parts"
import { WeekProgress } from "./week"

/**
 * One epoch (`2Uik1bZ5w5`) from `/epochs/{start}`: emissions, votes,
 * incentives posted, and the top gauges of each gauge type. While the
 * jobs Worker has not computed the epoch, the page says so and shows no
 * figures. Left out until their data exists: where emissions go by gauge
 * type (no per-type emission split), votes through the week (no intraday
 * series), APY per gauge in a past epoch, the same point of the previous
 * epoch, USD values.
 */

/** Previous and next epoch, as on a block (shell/entity is a chunk of its own). */
const stepClass =
  "flex h-11 items-center gap-2 rounded-[22px] bg-soft px-4 text-[15px] font-semibold text-ink outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"

const textLink =
  "rounded-sm outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"

export function EpochView({ page }: { page: EpochPage }): ReactNode {
  return (
    <>
      <Breadcrumbs.Root className="mt-8 max-xl:mt-5">
        <Breadcrumbs.Item asChild>
          <Link to="/epochs">Epochs</Link>
        </Breadcrumbs.Item>
        <Breadcrumbs.Current>Epoch {page.number}</Breadcrumbs.Current>
      </Breadcrumbs.Root>
      <header className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[40px] leading-tight font-[650] tracking-[-0.02em] max-xl:text-[32px]">
            Epoch {page.number}
          </h1>
          <p className="mt-1 text-[16px] text-sec">
            {page.span.dates}
            {page.closesIn === null ? null : `, closes in ${page.closesIn}`}
          </p>
        </div>
        <nav aria-label="Previous and next" className="flex gap-2.5">
          {page.number > 0 ? (
            <Link
              to="/epochs/$epoch"
              params={{ epoch: String(page.number - 1) }}
              className={stepClass}
              aria-label={`Previous epoch, ${page.number - 1}`}
            >
              <Glyph shape={shapes.chevronLeft} size={16} strokeWidth={2} />
              Epoch {page.number - 1}
            </Link>
          ) : null}
          {page.current ? null : (
            <Link
              to="/epochs/$epoch"
              params={{ epoch: String(page.number + 1) }}
              className={stepClass}
              aria-label={`Next epoch, ${page.number + 1}`}
            >
              Epoch {page.number + 1}
              <Glyph shape={shapes.chevronRight} size={16} strokeWidth={2} />
            </Link>
          )}
        </nav>
        {page.current ? (
          <MatchboxAction href={`${proOrigin}/vote`}>
            Vote on Matchbox
          </MatchboxAction>
        ) : null}
      </header>
      {page.progress === null ? null : (
        <WeekProgress progress={page.progress} />
      )}
      <div className="mt-6">
        {page.doc.status !== "ok" ? (
          <SectionState section={page.doc} />
        ) : page.doc.data === null ? (
          <div className="rounded-[24px] bg-soft p-7">
            <Filling asOf={page.asOf} />
          </div>
        ) : (
          <Doc doc={page.doc.data} now={page.now} number={page.number} />
        )}
      </div>
    </>
  )
}

function Doc({
  doc,
  now,
  number,
}: {
  doc: EpochDoc
  now: number
  number: number
}): ReactNode {
  return (
    <>
      {doc.filling === null ? null : (
        <Filling asOf={doc.filling.asOf} className="mb-4" />
      )}
      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <Panel label="Emissions">
          {doc.emissions.figure === null ? (
            <PanelEmpty>Not processed yet</PanelEmpty>
          ) : (
            <>
              <Figure
                value={doc.emissions.figure}
                {...(doc.emissions.note === null
                  ? {}
                  : { note: doc.emissions.note })}
              />
              <Stats stats={doc.emissions.stats} />
            </>
          )}
        </Panel>
        <Panel label="Votes cast">
          <Figure value={doc.votes.figure} note="votes" />
          <Stats stats={doc.votes.stats} />
        </Panel>
        <Panel
          label="Incentives posted"
          className="col-span-2 max-lg:col-span-1"
        >
          {doc.incentives.figure === null ? (
            <PanelEmpty>No incentives</PanelEmpty>
          ) : (
            <>
              <Figure value={doc.incentives.figure} />
              <Stats stats={doc.incentives.stats} />
              <ul aria-label="Latest deposits" className="mt-5 flex flex-col">
                {doc.incentives.deposits.map((deposit) => (
                  <li
                    key={deposit.key}
                    className="flex items-center gap-4 border-t border-line py-3 text-[15px]"
                  >
                    <span className="min-w-0 flex-1">
                      <Link
                        to="/address/$address"
                        params={{ address: deposit.depositor }}
                        className={`font-mono ${textLink}`}
                      >
                        {shortAddress(deposit.depositor)}
                      </Link>{" "}
                      added{" "}
                      <span className="font-semibold">{deposit.amount}</span>
                      {deposit.fees ? " in fees" : ""} to{" "}
                      <Link
                        to="/gauges/$gauge"
                        params={{ gauge: deposit.gauge.address }}
                        className={`font-semibold ${textLink}`}
                      >
                        <GaugeName gauge={deposit.gauge} />
                      </Link>
                    </span>
                    {deposit.usd === null ? null : (
                      <span className="flex-none font-semibold tabular-nums">
                        {deposit.usd}
                      </span>
                    )}
                    <Link
                      to="/tx/$hash"
                      params={{ hash: deposit.txHash }}
                      className={`flex-none text-sec ${textLink}`}
                    >
                      <Age.Root
                        timestamp={deposit.timestamp}
                        now={now}
                        tip={false}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>
      {doc.sources.map((table) => (
        <Source key={table.source} table={table} number={number} />
      ))}
    </>
  )
}

const topNames: Record<GaugeKind, string> = {
  vebtc: "Top veBTC gauges",
  mezo: "Top MEZO gauges",
  validator: "Top validators",
  pool: "Top pools",
}

function Source({
  table,
  number,
}: {
  table: SourceTable
  number: number
}): ReactNode {
  const id = `top-${table.source.toLowerCase()}`
  const name = table.kind === null ? table.source : topNames[table.kind]
  return (
    <section aria-labelledby={id} className="mt-12">
      <SectionHeading id={id} aside={table.total ?? undefined}>
        <span className="inline-flex items-center gap-2.5">
          <KindIcon kind={table.kind} size={20} />
          {name}
        </span>
      </SectionHeading>
      <DataTable.Root
        caption={`${name}, Epoch ${number}`}
        captionHidden
        reflow="lg"
      >
        <DataTable.Header>
          <DataTable.Column>Gauge</DataTable.Column>
          <DataTable.Column align="end">Votes</DataTable.Column>
          <DataTable.Column>Share</DataTable.Column>
          <DataTable.Column align="end">Voters</DataTable.Column>
          <DataTable.Column>Incentives</DataTable.Column>
        </DataTable.Header>
        <DataTable.Body>
          {table.rows.length === 0 ? (
            <DataTable.Empty columns={5}>No votes</DataTable.Empty>
          ) : (
            table.rows.map((row) => (
              <DataTable.Row key={row.gauge.address}>
                <DataTable.Cell phone="title">
                  <GaugeTitle
                    gauge={row.gauge}
                    size={32}
                    subline={row.killed ? "Killed" : undefined}
                  />
                </DataTable.Cell>
                <DataTable.Cell align="end" phone="value">
                  <span className="font-semibold whitespace-nowrap">
                    <span className="max-lg:hidden">{row.votes}</span>
                    <span className="lg:hidden">{row.votesShort}</span>
                  </span>
                </DataTable.Cell>
                <DataTable.Cell phone="detail">
                  {row.share === null ? null : (
                    <span className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-24 overflow-hidden rounded-full bg-soft2 max-lg:hidden"
                      >
                        <span
                          className="block h-full bg-acc"
                          style={{ width: `${Math.min(100, row.bps / 100)}%` }}
                        />
                      </span>
                      {row.share}
                    </span>
                  )}
                </DataTable.Cell>
                <DataTable.Cell align="end" phone="meta">
                  {row.voters}
                  <span className="lg:hidden"> voters</span>
                </DataTable.Cell>
                <DataTable.Cell>{row.incentives ?? "None"}</DataTable.Cell>
              </DataTable.Row>
            ))
          )}
        </DataTable.Body>
      </DataTable.Root>
    </section>
  )
}
