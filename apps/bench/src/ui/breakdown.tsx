import * as SplitBar from "@matchbox/ui/split-bar"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import results from "../data/results"
import {
  activeKinds,
  agreementPercents,
  agreementSplit,
  agreementSummary,
  cellScore,
  cssPercent,
  effortLabel,
  effortShape,
  failureGroups,
  failureRows,
  failureSummary,
  focusEntries,
  gridScoreFor,
  kindScore,
  kindTint,
  modelColour,
  per100,
  percent,
  type RankedEntry,
  rejectionColour,
  rejectionRows,
  rejectionSummary,
  runsText,
  scoreDomain,
  scoreName,
  shortModel,
  visibleShares,
} from "../view/model"
import { Marker } from "./marker"
import { useSelection } from "./selection"

/**
 * The grid of scores by kind of question and the two cards under it. They
 * show the entries the reader picked (each model's best by default), so
 * they stay readable with a dozen entries.
 */

function EntryName({
  entry,
  compact = false,
  runs = false,
}: {
  entry: RankedEntry
  compact?: boolean
  /** Add the entry's own run count, where a figure depends on it. */
  runs?: boolean
}): ReactNode {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Marker
        shape={effortShape(entry.effort)}
        colour={modelColour(entry.model)}
        size={13}
      />
      <span className="min-w-0">
        <span className="block font-[650] text-ink">
          {shortModel(entry.modelLabel)}
        </span>
        <span
          className={`block text-[13px] font-normal text-sec ${compact ? "max-md:hidden" : ""}`}
        >
          {effortLabel(entry.effort)}
          {runs ? `, ${runsText([entry])}` : ""}
        </span>
      </span>
    </span>
  )
}

function Empty(): ReactNode {
  return (
    <p className="py-6 text-[15px] text-sec">
      No entry matches this choice. Pick another effort level or show more
      models.
    </p>
  )
}

/** Kinds with questions: a kind with none has no column. */
const kinds = activeKinds(results.kinds)

/**
 * The shading scale for each score the grid can show, from every entry's
 * kinds, so a colour never moves when the reader filters.
 */
const gridDomains = {
  score: scoreDomain(
    results.entries.flatMap((entry) => entry.byKind.map((item) => item.score)),
  ),
  "ignoring-length": scoreDomain(
    results.entries.flatMap((entry) =>
      entry.byKind.map((item) => item.scoreIgnoringLength),
    ),
  ),
} as const

export function KindsGrid(): ReactNode {
  const { selection } = useSelection()
  const entries = focusEntries(results.entries, selection)
  const shown = gridScoreFor(selection.rankBy)
  const domain =
    shown === "ignoring-length"
      ? gridDomains["ignoring-length"]
      : gridDomains.score
  const budget = results.run.limits.stuartBudgetMs
  return (
    <div className="mt-[18px] rounded-[24px] border border-line">
      {entries.length === 0 ? (
        <div className="px-6">
          <Empty />
        </div>
      ) : (
        <section
          className="overflow-x-auto rounded-[24px] px-4 pt-2.5 pb-4 outline-none focus-visible:outline-2 focus-visible:outline-ink md:px-[26px]"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be reachable by keyboard
          tabIndex={0}
          aria-label="Score by kind of question"
        >
          <table className="w-full min-w-[860px] table-fixed border-separate border-spacing-x-2 border-spacing-y-[7px]">
            <caption className="sr-only">
              {scoreName(shown, budget)}, share of questions passed, by kind of
              question
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-[1] w-[132px] bg-bg text-left md:w-[190px]"
                >
                  <span className="sr-only">Entry</span>
                </th>
                {kinds.map((kind) => (
                  <th
                    key={kind.id}
                    scope="col"
                    className="px-0.5 pt-3 pb-1 text-center align-bottom text-[13px] leading-tight font-normal text-sec"
                  >
                    {kind.label}
                    <span className="mt-0.5 block font-mono text-[11px] text-sec">
                      {kind.questions}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <th
                    scope="row"
                    className="sticky left-0 z-[1] bg-bg pr-2 text-left text-[15px] font-normal"
                  >
                    <EntryName entry={entry} />
                  </th>
                  {kinds.map((kind) => {
                    const score = kindScore(entry, kind.id, shown)
                    return (
                      <td
                        key={kind.id}
                        className="h-11 rounded-xl text-center text-[15px] font-semibold text-ink"
                        style={{
                          background:
                            score === undefined
                              ? "var(--soft)"
                              : kindTint(score, domain),
                        }}
                      >
                        {score === undefined ? (
                          <span className="text-[13px] font-normal text-sec">
                            none
                          </span>
                        ) : (
                          cellScore(score)
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-3 text-[13.5px] text-sec md:px-[26px]">
        <span className="inline-flex items-center gap-2">
          <span className="font-mono text-[12px]">
            {percent(domain.from, 0)}
          </span>
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-24 rounded-full"
            style={{
              background: `linear-gradient(to right, ${kindTint(domain.from, domain)}, ${kindTint(domain.to, domain)})`,
            }}
          />
          <span className="font-mono text-[12px]">{percent(domain.to, 0)}</span>
        </span>
        <span>
          {scoreName(shown, budget)}. Shading runs from{" "}
          {percent(domain.from, 0)} (lightest) to {percent(domain.to, 0)}{" "}
          (darkest), the range of every entry's kinds, not from zero.
          {selection.rankBy === shown
            ? ""
            : ` The data has no ${scoreName(selection.rankBy, budget)} figure by kind, so the grid shows ${scoreName(shown, budget)}.`}
        </span>
      </div>
    </div>
  )
}

const row =
  "grid grid-cols-[minmax(0,104px)_1fr_48px] items-center gap-x-3 py-3 text-[15.5px] md:grid-cols-[190px_1fr_72px] md:gap-x-[22px]"

/** From every entry, so a colour never moves when the reader filters. */
const groups = failureGroups(results.entries, results.failureTypes)

export function FailureCard(): ReactNode {
  const { selection } = useSelection()
  const rows = failureRows(
    focusEntries(results.entries, selection),
    groups,
    results.run.questions,
  )
  const most = Math.max(0.0001, ...rows.map((item) => item.per100))
  const shownGroups = groups.filter((group) =>
    rows.some((item) =>
      item.segments.some((segment) => segment.group.key === group.key),
    ),
  )
  return (
    <section
      aria-labelledby="fail-title"
      className="min-w-0 rounded-[24px] border border-line px-5 py-6 md:px-[26px]"
    >
      <h3 id="fail-title" className="text-[18px] font-[650] text-ink">
        How they fail
      </h3>
      <p className="mt-1 text-[14px] text-sec">
        Failed checks per 100 answers, by type. One answer can fail several
        checks. Shorter is better.
      </p>
      {rows.length === 0 ? <Empty /> : null}
      <ul className="mt-3.5">
        {rows.map((item) => (
          <li key={item.entry.id} className={row}>
            <EntryName entry={item.entry} compact />
            {item.total === 0 ? (
              <span className="text-[14px] text-sec">No failed checks</span>
            ) : (
              <SplitBar.Root
                height={12}
                width={cssPercent(item.per100 / most)}
                label={`${item.entry.modelLabel}, ${effortLabel(item.entry.effort)}: ${failureSummary(item)}`}
                className="min-w-[6px]"
                segments={visibleShares(
                  item.segments.map((segment) => segment.count),
                ).map((value, index) => ({
                  id: item.segments[index]?.group.key ?? String(index),
                  value,
                  color: item.segments[index]?.group.colour ?? "var(--sec)",
                }))}
              />
            )}
            <span className="text-right text-ink">
              {per100(item.total, item.answers)}
            </span>
          </li>
        ))}
      </ul>
      <ul className="mt-3.5 flex flex-wrap gap-x-5 gap-y-2 text-[13.5px] text-sec">
        {shownGroups.map((group) => (
          <li key={group.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 flex-none rounded-full"
              style={{ background: group.colour }}
            />
            {group.key === "other"
              ? `Other: ${group.types.map((type) => type.label.toLowerCase().replace(/\b(stuart|mezo)\b/g, (name) => name.charAt(0).toUpperCase() + name.slice(1))).join(", ")}`
              : group.label}
          </li>
        ))}
      </ul>
    </section>
  )
}

const agreementParts = [
  { key: "always", label: "Right every run", colour: "var(--pos)" },
  { key: "sometimes", label: "Right in some", colour: "var(--bench-some)" },
  { key: "never", label: "Never right", colour: "var(--neg)" },
] as const

export function AgreementCard(): ReactNode {
  const { selection } = useSelection()
  const { shown: entries, left } = agreementSplit(
    focusEntries(results.entries, selection),
  )
  return (
    <section
      aria-labelledby="agree-title"
      className="min-w-0 rounded-[24px] border border-line px-5 py-6 md:px-[26px]"
    >
      <h3 id="agree-title" className="text-[18px] font-[650] text-ink">
        Agreement between runs
      </h3>
      <p className="mt-1 text-[14px] text-sec">
        Questions an entry got right in every one of its runs, in some, or in
        none.
      </p>
      {entries.length === 0 && left.length === 0 ? <Empty /> : null}
      <ul className="mt-3.5">
        {entries.map((entry) => {
          const shares = agreementPercents(entry)
          const raw = agreementParts.map(
            (part) => entry.agreement?.[part.key] ?? 0,
          )
          return (
            <li key={entry.id} className={row}>
              <EntryName entry={entry} compact runs />
              <SplitBar.Root
                height={12}
                label={`${entry.modelLabel}, ${effortLabel(entry.effort)}, ${runsText([entry])}: ${agreementSummary(entry)}`}
                segments={visibleShares(raw).map((value, index) => ({
                  id: agreementParts[index]?.key ?? String(index),
                  value,
                  color: agreementParts[index]?.colour ?? "var(--sec)",
                }))}
              />
              <span className="text-right text-ink">
                {shares === null ? "" : `${shares.always}%`}
              </span>
            </li>
          )
        })}
      </ul>
      {left.length === 0 ? null : (
        <p className="mt-2 text-[14px] text-sec" data-agreement-left="">
          Left out until they have two runs or more:{" "}
          {left
            .map(
              (entry) =>
                `${shortModel(entry.modelLabel)}, ${effortLabel(entry.effort)}`,
            )
            .join(". ")}
          .
        </p>
      )}
      <ul className="mt-3.5 flex flex-wrap gap-x-5 gap-y-2 text-[13.5px] text-sec">
        {agreementParts.map((part) => (
          <li key={part.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 rounded-full"
              style={{ background: part.colour }}
            />
            {part.label}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Answers Stuart did not show: the share of each entry's answers where
 * Stuart's answer check replaced the model's sentence with its own text,
 * by reason. Large for some models, so the Method page explains the rules.
 */
export function RejectionCard(): ReactNode {
  const { selection } = useSelection()
  const rows = rejectionRows(
    focusEntries(results.entries, selection),
    results.rejectionTypes,
  )
  const most = Math.max(0.0001, ...rows.map((item) => item.share))
  const shownReasons = results.rejectionTypes.filter((type) =>
    rows.some((each) =>
      each.segments.some((segment) => segment.reason === type.id),
    ),
  )
  return (
    <section
      aria-labelledby="reject-title"
      className="mt-6 min-w-0 rounded-[24px] border border-line px-5 py-6 md:px-[26px]"
    >
      <h3 id="reject-title" className="text-[18px] font-[650] text-ink">
        Answers Stuart did not show
      </h3>
      <p className="mt-1 max-w-[760px] text-[14px] text-sec">
        Share of each entry's answers where the model's own words were not
        credited, by reason: Stuart set the sentence aside and showed its own
        text instead. Each one fails Inside Stuart.{" "}
        <Link
          to="/method"
          hash="not-shown"
          className="font-semibold text-ink underline decoration-mut underline-offset-4 hover:decoration-ink"
        >
          The rules
        </Link>
      </p>
      {rows.length === 0 ? <Empty /> : null}
      <ul className="mt-3.5">
        {rows.map((item) => (
          <li key={item.entry.id} className={row}>
            <EntryName entry={item.entry} compact />
            {item.total === 0 ? (
              <span className="text-[14px] text-sec">Every sentence shown</span>
            ) : (
              <SplitBar.Root
                height={12}
                width={cssPercent(item.share / most)}
                label={`${item.entry.modelLabel}, ${effortLabel(item.entry.effort)}: ${rejectionSummary(item)}`}
                className="min-w-[6px]"
                segments={visibleShares(
                  item.segments.map((segment) => segment.share),
                ).map((value, index) => ({
                  id: item.segments[index]?.reason ?? String(index),
                  value,
                  color: item.segments[index]?.colour ?? "var(--sec)",
                }))}
              />
            )}
            <span className="text-right text-ink">{percent(item.share)}</span>
          </li>
        ))}
      </ul>
      <ul className="mt-3.5 flex flex-wrap gap-x-5 gap-y-2 text-[13.5px] text-sec">
        {shownReasons.map((type) => (
          <li key={type.id} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 flex-none rounded-full"
              style={{
                background: rejectionColour(type.id, results.rejectionTypes),
              }}
            />
            {type.label}
          </li>
        ))}
      </ul>
    </section>
  )
}
