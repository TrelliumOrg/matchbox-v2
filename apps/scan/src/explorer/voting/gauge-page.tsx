import { shortAddress } from "@matchbox/domain/format"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as UntrustedText from "@matchbox/ui/untrusted-text"
import { Link } from "@tanstack/react-router"
import { type ReactNode, Suspense } from "react"
import type { GaugeDetailPage, GaugeHeader } from "../../data/gauges"
import type { GaugeKind } from "../../data/scan/voting-views"
import { deferred } from "../../shell/deferred"
import { SectionState } from "../parts"
import { IncentivesCard, VotesCard, WhoCard } from "./gauge-cards"
import {
  GaugeName,
  GaugePicture,
  KindIcon,
  kindNames,
  MatchboxAction,
  Panel,
  Stats,
} from "./parts"

/**
 * A gauge (`kChmtpKRqP`): its identity and this epoch's figures from Pro's
 * profile, votes and incentives per epoch, who votes, its top voters and
 * incentive deposits; a pool gauge adds its pool's volume and liquidity
 * (`ak42S52PlW`). Left out until their data exists: APY history, voters
 * by lock size and voter addresses (a vote row names its lock, not its
 * owner), Watch, Add incentives.
 */

/** Top voters and deposits, below the fold: their code after first paint. */
const GaugeLists = deferred(() =>
  import("./gauge-lists").then((module) => module.GaugeLists),
)
/** Only pool gauges chart series: the chart loads with them alone. */
const PoolCards = deferred(() =>
  import("./pool-panels").then((module) => module.PoolCards),
)

const backLabels: Record<GaugeKind, string> = {
  vebtc: "veBTC gauges",
  mezo: "MEZO gauges",
  validator: "Validators",
  pool: "Pools",
}

const textLink =
  "rounded-sm outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"

export function GaugeView({ page }: { page: GaugeDetailPage }): ReactNode {
  const header = page.header.status === "ok" ? page.header.data : null
  const kind = header?.gauge.kind ?? null
  return (
    <>
      <p className="mt-8 max-xl:mt-5">
        <Link
          to="/gauges"
          search={kind === null ? {} : { type: kind }}
          className={`inline-flex items-center gap-1.5 text-[15px] font-semibold ${textLink}`}
        >
          <Glyph shape={shapes.chevronLeft} size={16} strokeWidth={2} />
          {kind === null ? "Gauges" : backLabels[kind]}
        </Link>
      </p>
      {header === null ? (
        <>
          <h1 className="mt-4 text-[34px] leading-tight font-[650] tracking-[-0.02em]">
            Gauge{" "}
            <span className="font-mono text-[24px] text-sec">
              {shortAddress(page.address)}
            </span>
          </h1>
          <div className="mt-6">
            {page.header.status === "ok" ? null : (
              <SectionState section={page.header} />
            )}
          </div>
        </>
      ) : (
        <Header header={header} />
      )}
      <div className="mt-6 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <VotesCard votes={page.votes} unit={header?.unit ?? null} />
        <IncentivesCard incentives={page.incentives} />
        {page.pool === null ? null : (
          <Suspense fallback={null}>
            <PoolCards
              pool={page.pool}
              period={page.period}
              gauge={page.address}
            />
          </Suspense>
        )}
        <AprHistory apr={page.apr} />
        <WhoCard who={page.who} epoch={page.epoch.number} />
        {page.pool === null || page.pool.facts.length === 0 ? null : (
          <Panel label="Pool">
            <Stats stats={page.pool.facts} />
          </Panel>
        )}
      </div>
      <Suspense fallback={null}>
        <GaugeLists
          epoch={page.epoch.number}
          voters={page.voters}
          deposits={page.deposits}
          now={page.now}
        />
      </Suspense>
    </>
  )
}

function Header({ header }: { header: GaugeHeader }): ReactNode {
  const { gauge } = header
  return (
    <section
      aria-label="Gauge"
      className="mt-4 rounded-[24px] bg-soft p-7 max-md:p-5"
    >
      <div className="flex flex-wrap items-start gap-x-6 gap-y-5">
        <GaugePicture picture={gauge.picture} size={88} priority />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[15px] text-sec">
            <KindIcon kind={gauge.kind} size={16} />
            {gauge.kind === null ? "Gauge" : kindNames[gauge.kind]}
            {header.expired ? (
              <span className="rounded-full bg-soft2 px-2.5 py-0.5 text-[13px] font-semibold text-ink2">
                Expired
              </span>
            ) : header.alive ? null : (
              <span className="rounded-full bg-soft2 px-2.5 py-0.5 text-[13px] font-semibold text-ink2">
                Inactive
              </span>
            )}
          </p>
          <h1 className="mt-1 text-[34px] leading-tight font-[650] tracking-[-0.02em] max-md:text-[28px]">
            <GaugeName gauge={gauge} limit={48} />
            {gauge.tokenId === null ? null : (
              <span className="ml-2 font-[500] text-sec">#{gauge.tokenId}</span>
            )}
          </h1>
          {header.tagline === null ? null : (
            <p className="mt-1 text-[16px] text-ink2">
              <UntrustedText.Root value={header.tagline} limit={80} />
            </p>
          )}
          <p className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[15px] text-sec">
            {header.locked === null ? null : (
              <span className="inline-flex items-center gap-1.5">
                <Glyph shape={shapes.lock} size={15} strokeWidth={1.75} />
                {header.locked}
              </span>
            )}
            {header.owner === null ? null : (
              <span>
                Owner{" "}
                <Link
                  to="/address/$address"
                  params={{ address: header.owner }}
                  className={`font-mono text-ink ${textLink}`}
                >
                  {shortAddress(header.owner)}
                </Link>
              </span>
            )}
            {header.tags.map((tag) => (
              <span key={tag}>
                <UntrustedText.Root value={tag} limit={24} />
              </span>
            ))}
          </p>
          {header.description === null ? null : (
            <p className="mt-3 max-w-[640px] text-[15px] text-ink2">
              <UntrustedText.Root value={header.description} limit={280} />
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-3 max-md:w-full max-md:items-stretch">
          <MatchboxAction href={header.proUrl}>Vote on Matchbox</MatchboxAction>
          {header.links.length === 0 ? null : (
            <ul className="flex gap-2 max-md:justify-start">
              {header.links.map((link) => (
                <li key={link.url}>
                  <a
                    href={link.url}
                    rel="noopener noreferrer nofollow"
                    target="_blank"
                    className="inline-flex h-9 items-center gap-1.5 rounded-[18px] bg-raised px-3.5 text-[14px] font-semibold text-ink outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink"
                  >
                    {link.label}
                    <Glyph
                      shape={shapes.arrowUpRight}
                      size={14}
                      strokeWidth={2}
                    />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <dl className="mt-6 grid grid-cols-4 gap-4 rounded-[18px] bg-raised p-5 max-md:grid-cols-2">
        {header.stats.map((stat) => (
          <div key={stat.label} className="min-w-0">
            <dt className="truncate text-[14px] text-sec">{stat.label}</dt>
            <dd className="mt-1 text-[23px] font-[650] tabular-nums">
              {stat.value}
            </dd>
            {stat.note === undefined ? null : (
              <dd className="mt-0.5 truncate text-[14px] text-sec tabular-nums">
                {stat.note}
              </dd>
            )}
          </div>
        ))}
      </dl>
      {header.band === null ? null : (
        <p
          role="img"
          aria-label={`${header.band.votes} ${header.band.of}, ${header.band.note}`}
          className="relative mt-4 flex h-12 items-center justify-between overflow-hidden rounded-[16px] bg-soft2 px-5 text-[14.5px]"
        >
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 bg-band-acc"
            style={{ width: `${header.band.bps / 100}%` }}
          />
          <span className="relative">
            <span className="font-semibold tabular-nums">
              {header.band.votes}
            </span>{" "}
            {header.band.of}
          </span>
          <span className="relative font-semibold">{header.band.note}</span>
        </p>
      )}
    </section>
  )
}

/** The gauge's APR per epoch, as the market cron computed each. */
function AprHistory({ apr }: { apr: GaugeDetailPage["apr"] }): ReactNode {
  return (
    <Suspense fallback={null}>
      <EpochFigurePanel
        label="APY history"
        section={apr}
        empty="No priced incentives yet"
      />
    </Suspense>
  )
}

/** Its code off the first paint's budget. */
const EpochFigurePanel = deferred(() =>
  import("./paid-panel").then((module) => module.EpochFigurePanel),
)
