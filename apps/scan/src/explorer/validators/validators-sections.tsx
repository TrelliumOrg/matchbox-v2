import { shortAddress } from "@matchbox/domain/format"
import * as DataTable from "@matchbox/ui/data-table"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as UntrustedText from "@matchbox/ui/untrusted-text"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { Section } from "../../data/explorer"
import type { GaugeIdentity } from "../../data/scan/voting-views"
import type { UptimeFigures } from "../../data/uptime"
import type {
  BlocksDay,
  EpochVotes,
  ProposedFigures,
  ValidatorSort,
  ValidatorsPage,
  ValidatorTable,
  VotesHistory,
} from "../../data/validators"
import { Filling } from "../filling"
import { SectionState, sectionStateText } from "../parts"
import { SkippedNote } from "../skipped-note"
import {
  EpochBars,
  epochNote,
  Figure,
  GaugeBars,
  GaugeName,
  GaugePicture,
  MatchboxAction,
  Panel,
  PanelEmpty,
  PanelState,
  proOrigin,
  reserveFor,
  rowsReserve,
  Stats,
} from "../voting/parts"
import { searchFor } from "./parts"
import { dayEdges, SetStatus, textLink } from "./status"
import { FreshnessLine } from "./uptime-panel"

/**
 * The Validators list below its stat cards, a chunk of its own (the page
 * loads it lazily, server rendered all the same): vote share and votes by
 * epoch, every validator with its uptime over 24 hours (CometBFT commit
 * signatures from a community node, with the node and its freshness) and
 * its blocks on the latest day with counts, proposers without a gauge and
 * how validators earn.
 */

export function ValidatorsSections({
  page,
}: {
  page: ValidatorsPage
}): ReactNode {
  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <SharePanel votes={page.votes} epoch={page.epoch.number} />
        <HistoryPanel history={page.history} />
      </div>
      <section aria-labelledby="all-validators" className="mt-12">
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2
            id="all-validators"
            className="mr-auto text-[24px] font-[650] tracking-[-0.015em]"
          >
            All validators
          </h2>
          <SortToggle page={page} />
        </div>
        {page.table.status === "ok" ? (
          <>
            <Coverage blocks={page.table.data.blocks} />
            <ValidatorTableView table={page.table.data} page={page} />
            <Outside table={page.table.data} />
            <SkippedNote skipped={page.table.skipped} what="validators" />
          </>
        ) : (
          <SectionState section={page.table} />
        )}
      </section>
      <HowTheyEarn votes={page.votes} />
    </>
  )
}

function SharePanel({
  votes,
  epoch,
}: {
  votes: Section<EpochVotes | "not-yet" | null>
  epoch: number
}): ReactNode {
  const data = votes.status === "ok" ? votes.data : null
  return (
    <Panel
      label="Vote share by validator"
      aside={<span className="text-[14px] font-semibold">Epoch {epoch}</span>}
    >
      {votes.status !== "ok" ? (
        <PanelState section={votes} />
      ) : data === "not-yet" ? (
        <PanelEmpty>Not available yet</PanelEmpty>
      ) : data === null || data.leader === null ? (
        <PanelEmpty>No validator votes this epoch</PanelEmpty>
      ) : (
        <>
          <Figure
            value={data.leader.share}
            note={<GaugeName gauge={data.leader.gauge} />}
            reserve={rowsReserve(data.bars)}
          />
          {data.filling === null ? null : (
            <Filling asOf={data.filling.asOf} className="mt-1" />
          )}
          <Stats stats={data.stats} />
          <GaugeBars rows={data.bars} label="Vote share by validator" figure />
        </>
      )}
    </Panel>
  )
}

function HistoryPanel({
  history,
}: {
  history: Section<VotesHistory | "not-yet" | null>
}): ReactNode {
  const data = history.status === "ok" ? history.data : null
  return (
    <Panel label="veBTC voting for validators by epoch">
      {history.status !== "ok" ? (
        <PanelState section={history} />
      ) : data === "not-yet" ? (
        <PanelEmpty>Not available yet</PanelEmpty>
      ) : data === null ? (
        <PanelEmpty>No validator votes yet</PanelEmpty>
      ) : (
        <>
          <Figure
            value={data.figure ?? "Not computed yet"}
            note={epochNote(data.bars)}
            reserve={reserveFor(data.bars)}
          />
          {data.filling === null ? null : (
            <Filling asOf={data.filling.asOf} className="mt-1" />
          )}
          <Stats stats={data.stats} />
          <EpochBars
            bars={data.bars}
            label="veBTC voting for validators by epoch"
          />
        </>
      )}
    </Panel>
  )
}

const sorts: { sort: ValidatorSort; label: string }[] = [
  { sort: "share", label: "Vote share" },
  { sort: "uptime", label: "Uptime" },
  { sort: "proposed", label: "Blocks proposed" },
]

function SortToggle({ page }: { page: ValidatorsPage }): ReactNode {
  return (
    <nav aria-label="Order" className="-mx-3.5 flex gap-1 md:mx-0">
      {sorts.map((each) => (
        <Link
          key={each.sort}
          to="/validators"
          search={searchFor(page.epoch, page.epoch.number, each.sort)}
          resetScroll={false}
          aria-current={each.sort === page.sort ? "true" : undefined}
          activeOptions={{ exact: true, includeSearch: true }}
          activeProps={{}}
          className="flex h-9 items-center rounded-[18px] px-3.5 text-[15px] font-semibold text-sec outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink [&[aria-current]]:bg-soft [&[aria-current]]:text-ink"
        >
          {each.label}
        </Link>
      ))}
    </nav>
  )
}

function ValidatorTableView({
  table,
  page,
}: {
  table: ValidatorTable
  page: ValidatorsPage
}): ReactNode {
  const { blocks } = table
  const blocksHeading = blocks.available
    ? `Blocks, about ${blocks.day}`
    : "Blocks per day"
  return (
    <>
      <BlocksState blocks={blocks} />
      <UptimeState uptime={table.uptime} />
      <DataTable.Root caption="All validators" captionHidden reflow="lg">
        <DataTable.Header>
          <DataTable.Column>Validator</DataTable.Column>
          <DataTable.Column>Status</DataTable.Column>
          <DataTable.Column align="end">Uptime, 24h</DataTable.Column>
          <DataTable.Column>
            Vote share, Epoch {page.epoch.number}
          </DataTable.Column>
          <DataTable.Column align="end">Voters</DataTable.Column>
          <DataTable.Column align="end">For voters</DataTable.Column>
          <DataTable.Column align="end">{blocksHeading}</DataTable.Column>
          <DataTable.Column align="end">
            <span className="sr-only">Vote</span>
          </DataTable.Column>
        </DataTable.Header>
        <DataTable.Body>
          {table.rows.length === 0 ? (
            <DataTable.Empty columns={8}>No validators</DataTable.Empty>
          ) : (
            table.rows.map((row) => (
              <DataTable.Row
                key={row.gauge.address}
                className={row.status === "left" ? "text-sec" : undefined}
              >
                <DataTable.Cell phone="title" className="max-w-[20rem]">
                  <ValidatorTitle gauge={row.gauge} operator={row.operator} />
                </DataTable.Cell>
                <DataTable.Cell phone="detail">
                  <SetStatus status={row.status} />
                </DataTable.Cell>
                <DataTable.Cell align="end">
                  <UptimeFigure figures={row.uptime} uptime={table.uptime} />
                </DataTable.Cell>
                <DataTable.Cell phone="value">
                  {row.voteShare === null ? (
                    <span className="text-sec">
                      {table.votes === "ok"
                        ? "No votes"
                        : table.votes === "not-yet"
                          ? "Not available yet"
                          : sectionStateText[table.votes]}
                    </span>
                  ) : (
                    <Link
                      to="/gauges/$gauge"
                      params={{ gauge: row.gauge.address }}
                      title={row.votes ?? undefined}
                      className={`flex items-center gap-3 ${textLink}`}
                    >
                      <span
                        aria-hidden="true"
                        className="h-2 w-24 flex-none overflow-hidden rounded-full bg-soft2 max-lg:hidden"
                      >
                        <span
                          className="block h-full rounded-full bg-acc"
                          style={{ width: `${Math.max(2, row.bps / 100)}%` }}
                        />
                      </span>
                      <span className="font-semibold tabular-nums">
                        {row.voteShare}
                      </span>
                    </Link>
                  )}
                </DataTable.Cell>
                <DataTable.Cell align="end">{row.voters}</DataTable.Cell>
                <DataTable.Cell align="end" phone="meta">
                  {row.voteShare === null
                    ? null
                    : (row.incentives ?? (
                        <span className="text-sec">None</span>
                      ))}
                </DataTable.Cell>
                <DataTable.Cell align="end">
                  <BlocksFigure row={row} blocks={blocks} />
                </DataTable.Cell>
                <DataTable.Cell align="end">
                  <a
                    href={row.proUrl}
                    className="inline-flex h-9 items-center gap-1.5 rounded-[18px] bg-soft px-3.5 text-[14.5px] font-semibold whitespace-nowrap text-ink outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink"
                  >
                    Vote on Matchbox
                    <Glyph
                      shape={shapes.arrowUpRight}
                      size={14}
                      strokeWidth={2}
                    />
                  </a>
                </DataTable.Cell>
              </DataTable.Row>
            ))
          )}
          {blocks.available && blocks.unattributed !== null ? (
            <DataTable.Row>
              <DataTable.Cell phone="title">
                <span className="font-semibold">Unattributed</span>
                <span className="block text-[14px] text-sec">
                  Blocks no listed validator was counted for
                </span>
              </DataTable.Cell>
              <DataTable.Cell />
              <DataTable.Cell />
              <DataTable.Cell />
              <DataTable.Cell />
              <DataTable.Cell />
              <DataTable.Cell align="end" phone="value">
                <span className="flex flex-col items-end">
                  <span className="tabular-nums">
                    {blocks.unattributed.blocks}
                  </span>
                  <span className="text-[14px] text-sec tabular-nums">
                    {blocks.unattributed.share}
                  </span>
                </span>
              </DataTable.Cell>
              <DataTable.Cell />
            </DataTable.Row>
          ) : null}
        </DataTable.Body>
      </DataTable.Root>
      <p className="mt-4 text-[14.5px] text-sec">
        Status is the PoA set from ValidatorPool. Uptime is the share of blocks
        a validator signed in the last 24 hours, from CometBFT commit
        signatures. Emissions and unclaimed rewards per validator are not
        available yet.
        {blocks.available ? ` ${dayEdges}` : null}
      </p>
    </>
  )
}

/**
 * Under the heading: which validators the list holds (those the jobs
 * Worker has seen) and, until shares are of every block, what they are of.
 */
function Coverage({ blocks }: { blocks: BlocksDay }): ReactNode {
  const shares = !blocks.available
    ? null
    : blocks.shareOf === "all_blocks"
      ? "Shares are of every block on the day, and Unattributed counts the blocks of validators not listed."
      : blocks.shareOf === "known"
        ? "Shares are of these validators' blocks only, not of every block, until the day's total block count reaches this page."
        : "Shares need the day's total block count, which is not available yet."
  return (
    <p className="-mt-2 mb-4 text-[14.5px] text-sec">
      Validators Matchscan has seen: the proposers in one daily read of 50
      recent blocks, plus labelled ones.{shares === null ? null : ` ${shares}`}
    </p>
  )
}

/**
 * Above the table: the day's counts not available yet (with the API's
 * reason), or shares not complete (naming who has no count).
 */
function BlocksState({ blocks }: { blocks: BlocksDay }): ReactNode {
  if (!blocks.available) {
    return (
      <p role="status" className="mb-3 text-[14.5px] text-sec">
        <span className="font-semibold text-ink2">
          Blocks per day: Not available yet.
        </span>{" "}
        {blocks.reason}.
      </p>
    )
  }
  if (blocks.shareOf === null) {
    return (
      <p role="status" className="mb-3 text-[14.5px] text-sec">
        <span className="font-semibold text-ink2">
          Shares: Not available yet.
        </span>{" "}
        The chain's block count for about {blocks.day} has not been read.
      </p>
    )
  }
  if (blocks.complete || blocks.missing.length === 0) return null
  return (
    <p role="status" className="mb-3 text-[14.5px] text-sec">
      <span className="font-semibold text-ink2">Shares not complete.</span> No
      count on about {blocks.day} for {blocks.missing.join(", ")}
      {blocks.shareOf === "all_blocks"
        ? ", so their share is not known."
        : ", so the day's total is not known."}
    </p>
  )
}

/**
 * Above the table: where the uptime figures come from and how fresh they
 * are, or why they are paused (then the cells say Paused, never a stale
 * figure as current).
 */
function UptimeState({
  uptime,
}: {
  uptime: ValidatorTable["uptime"]
}): ReactNode {
  if (typeof uptime === "string") {
    return (
      <p role="status" className="mb-3 text-[14.5px] text-sec">
        <span className="font-semibold text-ink2">Uptime:</span>{" "}
        {sectionStateText[uptime]}
      </p>
    )
  }
  return (
    <div className="mb-3">
      <FreshnessLine freshness={uptime} />
    </div>
  )
}

/** A row's uptime over 24 hours, blocks missed under it. */
function UptimeFigure({
  figures,
  uptime,
}: {
  figures: UptimeFigures | null
  uptime: ValidatorTable["uptime"]
}): ReactNode {
  if (typeof uptime === "string") return null
  if (!uptime.live) {
    return uptime.asOf === null ? null : (
      <span className="text-sec">Paused</span>
    )
  }
  if (figures === null || figures.uptime === null) {
    return <span className="text-sec">Not counted</span>
  }
  return (
    <span className="flex flex-col items-end">
      <span
        className={`tabular-nums ${figures.bps !== null && figures.bps < 9_900 ? "font-semibold text-neg" : ""}`}
      >
        {figures.uptime}
      </span>
      <span className="text-[14px] text-sec tabular-nums">
        {figures.missedCount === 0 ? "None missed" : `${figures.missed} missed`}
      </span>
    </span>
  )
}

/** A row's blocks on the day, its share under it; else its total. */
function BlocksFigure({
  row,
  blocks,
}: {
  row: ProposedFigures
  blocks: BlocksDay
}): ReactNode {
  if (row.blocks === null) {
    // No count for the day: the running total, where the first read has one.
    if (row.total === null) return null
    return (
      <span className="flex flex-col items-end text-sec">
        <span>{blocks.available ? "Not counted" : "Not available yet"}</span>
        <span className="text-[14px] tabular-nums">{row.total} all time</span>
      </span>
    )
  }
  return (
    <span className="flex flex-col items-end">
      <span className="tabular-nums">{row.blocks}</span>
      <span className="text-[14px] text-sec tabular-nums">
        {row.share ??
          (blocks.available && blocks.shareOf === null
            ? "Share not available yet"
            : "Share not complete")}
      </span>
    </span>
  )
}

/** Proposers without a validator gauge, shown as they are, never guessed. */
function Outside({ table }: { table: ValidatorTable }): ReactNode {
  const { outside, blocks } = table
  if (outside.length === 0) return null
  return (
    <section aria-labelledby="outside-set" className="mt-8">
      <h3 id="outside-set" className="text-[17px] font-semibold">
        Proposers without a validator gauge
      </h3>
      <p className="mt-1 text-[14.5px] text-sec">
        {blocks.available
          ? `Blocks on about ${blocks.day}, matched by operator address`
          : "Matched by operator address"}
      </p>
      <ul className="mt-3 flex flex-col">
        {outside.map((each) => (
          <li
            key={each.address}
            className="flex min-h-12 items-center gap-4 border-b border-line py-2"
          >
            <Link
              to="/validators/$address"
              params={{ address: each.address }}
              className={`min-w-0 flex-1 truncate ${textLink}`}
            >
              {each.name === null ? (
                <span className="font-mono text-[14.5px]">
                  {shortAddress(each.address)}
                </span>
              ) : (
                <>
                  <UntrustedText.Root value={each.name} limit={40} />{" "}
                  <span className="font-mono text-[14px] text-sec">
                    {shortAddress(each.address)}
                  </span>
                </>
              )}
            </Link>
            <UptimeFigure figures={each.uptime} uptime={table.uptime} />
            <BlocksFigure row={each} blocks={blocks} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function HowTheyEarn({
  votes,
}: {
  votes: Section<EpochVotes | "not-yet" | null>
}): ReactNode {
  const read = votes.status === "ok" ? votes.data : null
  const data = read === "not-yet" ? null : read
  // Not computed yet: never "None".
  const unknown = read === "not-yet" ? "Not available yet" : null
  const step = (label: string, value: string, note: string) => (
    <div className="min-w-0">
      <dt className="text-[14px] text-sec">{label}</dt>
      <dd className="mt-1 text-[19px] font-[650] tabular-nums">{value}</dd>
      <dd className="mt-0.5 text-[14px] text-sec">{note}</dd>
    </div>
  )
  return (
    <section
      aria-labelledby="how-they-earn"
      className="mt-12 rounded-[24px] bg-soft p-7 max-md:p-5"
    >
      <h2
        id="how-they-earn"
        className="text-[22px] font-[650] tracking-[-0.015em]"
      >
        How validators earn
      </h2>
      <dl className="mt-5 grid grid-cols-4 gap-6 max-lg:grid-cols-2 max-md:grid-cols-1">
        {step(
          "veBTC votes",
          data?.figure ?? unknown ?? sectionStateText.unavailable,
          data === null ? "" : `${data.gauges} gauges`,
        )}
        {step(
          "Emissions by gauge",
          "Not available yet",
          "Not reported per gauge",
        )}
        {step("Validator claims", "To the beneficiary", "Named on each gauge")}
        {step(
          "Voter incentives",
          data?.incentivesUsd ?? data?.incentives[0] ?? unknown ?? "None",
          data === null ? "" : `${data.incentivized} validators`,
        )}
      </dl>
      <div className="mt-6">
        <MatchboxAction href={`${proOrigin}/vote`}>
          Vote on Matchbox
        </MatchboxAction>
      </div>
    </section>
  )
}

/**
 * Picture, name and short operator. The name opens the validator's page,
 * or its gauge's once it left the set (no operator to key a page on).
 */
export function ValidatorTitle({
  gauge,
  operator,
}: {
  gauge: GaugeIdentity
  operator: string | null
}): ReactNode {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <GaugePicture picture={gauge.picture} size={40} />
      <span className="flex min-w-0 flex-col">
        {operator === null ? (
          <Link
            to="/gauges/$gauge"
            params={{ gauge: gauge.address }}
            className={`truncate font-semibold ${textLink}`}
          >
            <GaugeName gauge={gauge} />
          </Link>
        ) : (
          <Link
            to="/validators/$address"
            params={{ address: operator }}
            className={`truncate font-semibold ${textLink}`}
          >
            <GaugeName gauge={gauge} />
          </Link>
        )}
        <span className="truncate font-mono text-[14px] text-sec">
          {operator === null ? "No operator" : shortAddress(operator)}
        </span>
      </span>
    </span>
  )
}
