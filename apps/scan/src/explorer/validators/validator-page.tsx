import { shortAddress } from "@matchbox/domain/format"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as UntrustedText from "@matchbox/ui/untrusted-text"
import { Link } from "@tanstack/react-router"
import { type ReactNode, Suspense } from "react"
import type { Section } from "../../data/explorer"
import type {
  ValidatorBlocks,
  ValidatorHeader,
  ValidatorPage,
  ValidatorShare,
} from "../../data/validators"
import { deferred } from "../../shell/deferred"
import { sectionStateText } from "../section-text"
import { GaugePicture, MatchboxAction } from "../voting/parts"
import { dayEdges, reasons, SetStatus, textLink } from "./status"

/**
 * One validator (`MecoxYurzZ`), by proposer address: its set status and
 * gauge, the blocks it proposed on the latest day with counts (with its
 * share and running total), its uptime (signing, missed blocks and missed
 * proposals from CometBFT commits read from a community node, with the
 * node and its freshness), its vote share this epoch, and its gauge's
 * votes, incentives, voters and deposits (the gauge page's own readers).
 * A proposer with no validator gauge shows its blocks and uptime alone.
 * Not available yet, and said so in place: emissions earned and claimed,
 * unclaimed rewards and claims (not indexed per validator). Left out:
 * jailing (Mezo's PoA module has no jailing or slashing), uptime past 30
 * days and the 90-day and All ranges (daily counts are kept, but no route
 * serves them yet), Watch (watch lists wait for Matchbox ID) and the
 * design's sub-tabs (one page holds everything there is).
 */

/** A failed header's state, only loaded when one fails. */
const SectionState = deferred(() =>
  import("../parts").then((module) => module.SectionState),
)

/** Below the key figures: its own chunk, off the first paint's budget. */
const ValidatorSections = deferred(() =>
  import("./validator-sections").then((module) => module.ValidatorSections),
)

export function ValidatorView({ page }: { page: ValidatorPage }): ReactNode {
  const header = page.header.status === "ok" ? page.header.data : null
  return (
    <>
      <p className="mt-8 max-xl:mt-5">
        <Link
          to="/validators"
          className={`inline-flex items-center gap-1.5 text-[15px] font-semibold ${textLink}`}
        >
          <Glyph shape={shapes.chevronLeft} size={16} strokeWidth={2} />
          Validators
        </Link>
      </p>
      {header === null ? (
        <>
          <h1 className="mt-4 text-[34px] leading-tight font-[650] tracking-[-0.02em]">
            Validator{" "}
            <span className="font-mono text-[24px] text-sec">
              {shortAddress(page.address)}
            </span>
          </h1>
          <div className="mt-6">
            {page.header.status === "ok" ? null : (
              <Suspense fallback={null}>
                <SectionState section={page.header} />
              </Suspense>
            )}
          </div>
        </>
      ) : (
        <Header header={header} />
      )}
      <KeyFigures
        share={page.share}
        blocks={page.blocks}
        header={header}
        epoch={page.epoch.number}
      />
      {page.blocks.status === "ok" && page.blocks.data.day.available ? (
        <p className="mt-2 text-[14px] text-sec">{dayEdges}</p>
      ) : null}
      <Suspense fallback={null}>
        <ValidatorSections page={page} header={header} />
      </Suspense>
    </>
  )
}

function AddressLink({
  label,
  address,
}: {
  label: string
  address: string
}): ReactNode {
  return (
    <span className="whitespace-nowrap">
      {label}{" "}
      <Link
        to="/address/$address"
        params={{ address }}
        title={address}
        className={`font-mono text-ink ${textLink}`}
      >
        {shortAddress(address)}
      </Link>
    </span>
  )
}

function Header({ header }: { header: ValidatorHeader }): ReactNode {
  return (
    <section
      aria-label="Validator"
      className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-4"
    >
      <GaugePicture picture={header.picture} size={72} />
      {/* A basis, so on a phone the action wraps below, not beside it. */}
      <div className="min-w-0 flex-1 basis-60">
        <h1 className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[36px] leading-tight font-[650] tracking-[-0.025em] max-md:text-[28px]">
          {header.name === null ? (
            <span className="font-mono">{shortAddress(header.address)}</span>
          ) : (
            <UntrustedText.Root value={header.name} limit={48} />
          )}
          {header.gauge === null ? (
            <span className="rounded-full bg-soft px-2.5 py-0.5 text-[13.5px] font-semibold tracking-normal text-ink2">
              No validator gauge
            </span>
          ) : (
            <SetStatus status={header.status} variant="chip" />
          )}
          {header.alive ? null : (
            <span className="rounded-full bg-soft2 px-2.5 py-0.5 text-[13px] font-semibold tracking-normal text-ink2">
              Gauge inactive
            </span>
          )}
        </h1>
        <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[15px] text-sec">
          <AddressLink
            label={header.gauge === null ? "Proposer" : "Operator"}
            address={header.address}
          />
          {header.beneficiary === null ? null : (
            <AddressLink label="Beneficiary" address={header.beneficiary} />
          )}
          {header.gauge === null ? null : (
            <span className="whitespace-nowrap">
              Gauge{" "}
              <Link
                to="/gauges/$gauge"
                params={{ gauge: header.gauge }}
                title={header.gauge}
                className={`font-mono text-ink ${textLink}`}
              >
                {shortAddress(header.gauge)}
              </Link>
            </span>
          )}
        </p>
      </div>
      {header.proUrl === null ? null : (
        <MatchboxAction href={header.proUrl}>Vote on Matchbox</MatchboxAction>
      )}
    </section>
  )
}

function Cell({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note: ReactNode
}): ReactNode {
  return (
    <div className="min-w-0 border-l border-line px-6 first:border-l-0 first:pl-0 max-md:border-l-0 max-md:px-0">
      <dt className="text-[14.5px] text-sec">{label}</dt>
      <dd className="mt-1.5 text-[28px] leading-tight font-[650] tracking-[-0.02em] tabular-nums [overflow-wrap:anywhere] max-md:text-[24px]">
        {value}
      </dd>
      <dd className="mt-1 text-[14.5px] text-sec">{note}</dd>
    </div>
  )
}

/** Blocks on the day: counted, not counted, or not available yet. */
function BlocksCell({
  blocks,
}: {
  blocks: Section<ValidatorBlocks>
}): ReactNode {
  if (blocks.status !== "ok") {
    return (
      <Cell
        label="Blocks proposed"
        value={sectionStateText[blocks.status]}
        note=""
      />
    )
  }
  const { day } = blocks.data
  const total =
    blocks.data.total === null ? null : `${blocks.data.total} all time`
  if (!day.available) {
    return (
      <Cell
        label="Blocks proposed per day"
        value="Not available yet"
        note={total === null ? day.reason : `${day.reason}. ${total}`}
      />
    )
  }
  const label = `Blocks proposed, about ${day.day}`
  if (blocks.data.blocks === null) {
    return (
      <Cell
        label={label}
        value="Not counted"
        note={total ?? "No count for this day"}
      />
    )
  }
  const share =
    blocks.data.share !== null
      ? `${blocks.data.share} of ${day.total}`
      : day.shareOf === null
        ? "Share not available yet"
        : "Share not complete"
  return (
    <Cell
      label={label}
      value={blocks.data.blocks}
      note={total === null ? share : `${share}; ${total}`}
    />
  )
}

function KeyFigures({
  share,
  blocks,
  header,
  epoch,
}: {
  share: Section<ValidatorShare | "not-yet" | null>
  blocks: Section<ValidatorBlocks>
  header: ValidatorHeader | null
  epoch: number
}): ReactNode {
  const label = `Vote share, Epoch ${epoch}`
  const noGauge = header !== null && header.gauge === null
  return (
    <dl
      aria-label="Key figures"
      className="mt-7 grid min-h-[132px] grid-cols-4 gap-y-5 rounded-[24px] bg-soft px-7 py-6 max-lg:grid-cols-2 max-md:grid-cols-1 max-md:p-5"
    >
      <BlocksCell blocks={blocks} />
      {noGauge ? (
        <Cell label={label} value="No gauge" note="Nothing to vote for" />
      ) : share.status !== "ok" ? (
        <Cell label={label} value={sectionStateText[share.status]} note="" />
      ) : share.data === "not-yet" ? (
        <Cell
          label={label}
          value="Not available yet"
          note={reasons.votesFilling}
        />
      ) : share.data === null ? (
        <Cell label={label} value="No votes" note="This epoch" />
      ) : (
        <Cell
          label={label}
          value={share.data.share}
          note={
            share.data.rank === null
              ? share.data.votes
              : `Rank ${share.data.rank}, ${share.data.votes}`
          }
        />
      )}
      <Cell
        label="Incentives for voters"
        value={
          noGauge
            ? "None"
            : (header?.incentives ?? sectionStateText.unavailable)
        }
        note="This epoch, at today's prices"
      />
      <Cell
        label="Unclaimed"
        value="Not available yet"
        note={reasons.unclaimed}
      />
    </dl>
  )
}
