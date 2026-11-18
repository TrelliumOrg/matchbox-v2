import { Glyph, shapes } from "@matchbox/ui/icons"
import { Link } from "@tanstack/react-router"
import { type ReactNode, Suspense } from "react"
import type { PoolDetail, PoolPage, Rate } from "../../data/pools"
import { SectionState } from "../parts"
import { Panel } from "../voting/parts"
import {
  ChainMark,
  ExternalLink,
  NotAvailable,
  PoolCoins,
  RateText,
  textLink,
} from "./parts"
import { MezoPoolPanels } from "./pool-figures"
import { VotesFact } from "./pool-gauge"

/**
 * One pool, moving toward the fuller design (`ak42S52PlW`): on Mezo at
 * `/pools/{address}`, on Ethereum and Base at `/pools/{chain}/{address}`.
 * The header names the chain and venue and links out to the venue and the
 * chain's explorer (a pool off Mezo never opens a Matchscan address
 * page), then liquidity, volume, MUSD's price here against our headline,
 * and the yearly rate split by source. A Mezo pool adds its last day's
 * fees, its gauge's veBTC votes and voter APY, volume and fees per day in
 * USD, votes per epoch and its reserves. On Mezo the pool's own figures
 * replace the snapshot's: liquidity from its reserves, volume from its
 * swaps, the fee rate from 7 days of its fees (marked est.) and the total
 * from the parts shown, so no figure appears twice from two sources. Left
 * out until their data exists: LPs and the largest LP, depth and the price
 * against the oracle, swaps per day on CL pools, LP APR by pool, swaps
 * and liquidity events on this page, LP positions (no event index on
 * Ethereum or Base), the CRV boosters, MEZO a week, and Watch.
 */

const backLink =
  "inline-flex items-center gap-1.5 rounded-sm text-[15px] font-semibold outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"

function Header({ detail }: { detail: PoolDetail }): ReactNode {
  const { row } = detail
  return (
    <header className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-4">
      <PoolCoins row={row} size={44} />
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-[40px] leading-tight font-[650] tracking-[-0.02em] max-xl:text-[32px]">
          {row.title}
        </h1>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] text-ink2">
          <span className="flex items-center gap-1.5">
            <ChainMark chain={row.chain} />
            {row.chainName}
          </span>
          <span>{row.venue}</span>
          {row.legacy ? <span className="text-sec">Legacy pool</span> : null}
          {row.explorer === null ? null : (
            <ExternalLink href={row.explorer.url}>
              {row.explorer.name}
            </ExternalLink>
          )}
          {row.chain === "mezo" && /^0x[0-9a-f]{40}$/.test(row.link.pool) ? (
            <Link
              to="/address/$address"
              params={{ address: row.link.pool }}
              className={textLink}
            >
              Pool address
            </Link>
          ) : null}
        </p>
      </div>
      <span className="flex-1" />
      <a
        href={row.venueUrl}
        rel="noopener noreferrer"
        className="inline-flex h-11 items-center gap-2 rounded-[22px] bg-soft px-5 text-[15px] font-semibold outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink"
      >
        {row.legacy ? `Open on ${row.venue}` : `Add liquidity on ${row.venue}`}
        <Glyph shape={shapes.arrowUpRight} size={16} strokeWidth={2} />
      </a>
    </header>
  )
}

function Fact({
  label,
  children,
  note,
}: {
  label: string
  children: ReactNode
  note?: ReactNode
}): ReactNode {
  return (
    <div className="min-w-0">
      <dt className="text-[14px] text-sec">{label}</dt>
      <dd className="mt-1 text-[23px] font-[650] tracking-[-0.01em] tabular-nums">
        {children}
      </dd>
      {note === undefined || note === null ? null : (
        <dd className="text-[14px] text-sec">{note}</dd>
      )}
    </div>
  )
}

function Muted({ children }: { children: ReactNode }): ReactNode {
  return <span className="text-[17px] font-normal text-sec">{children}</span>
}

function Facts({ detail }: { detail: PoolDetail }): ReactNode {
  const { row } = detail
  return (
    <dl className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-6 gap-y-5 border-y border-line py-6 max-lg:grid-cols-2">
      <Fact label="Liquidity" note={detail.share}>
        {row.liquidity ?? <Muted>Not available yet</Muted>}
      </Fact>
      <Fact
        label="Volume 24h"
        note={detail.volume7d === null ? null : `Volume 7d ${detail.volume7d}`}
      >
        {row.volume === null ? (
          <Muted>Not available yet</Muted>
        ) : row.volume.kind === "none" ? (
          <Muted>No swaps</Muted>
        ) : (
          row.volume.text
        )}
      </Fact>
      {row.assets.includes("musd") ? (
        <Fact
          label="MUSD price here"
          note={
            row.priceHere !== null && detail.headline !== null
              ? `Our price ${detail.headline}`
              : null
          }
        >
          {row.priceHere ?? <Muted>Not a price venue</Muted>}
        </Fact>
      ) : null}
      <Fact
        label="Yearly rate"
        note={detail.rate7d === null ? null : `${detail.rate7d} over 7 days`}
      >
        <RateText rate={row.rates.total} />
      </Fact>
      {detail.mezo?.volume?.fees == null ? null : (
        <Fact label="Fees 24h" note="Swap fees to the pool">
          {detail.mezo.volume.fees}
        </Fact>
      )}
      {detail.mezo?.gauge == null ? null : (
        <Suspense fallback={null}>
          <VotesFact gauge={detail.mezo.gauge} />
        </Suspense>
      )}
    </dl>
  )
}

function OffMezo({ detail }: { detail: PoolDetail }): ReactNode {
  const { row } = detail
  if (row.chain === "mezo") return null
  return (
    <p className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[20px] bg-soft px-5 py-4 text-[15px]">
      <ChainMark chain={row.chain} size={20} />
      <span className="flex-1">
        Pool on {row.chainName}. Swaps and liquidity positions are not indexed
        here
      </span>
      {row.explorer === null ? (
        <ExternalLink href={row.venueUrl}>{row.venue}</ExternalLink>
      ) : (
        <ExternalLink href={row.explorer.url}>{row.explorer.name}</ExternalLink>
      )}
    </p>
  )
}

function RateLine({
  label,
  rate,
  note,
}: {
  label: string
  rate: Rate
  note?: string
}): ReactNode {
  return (
    <li className="flex items-baseline gap-3 border-b border-line py-3 last:border-b-0">
      <span className="font-semibold">{label}</span>
      {note === undefined ? null : (
        <span className="text-[14px] text-sec">{note}</span>
      )}
      <span className="flex-1" />
      <span className="tabular-nums">
        <RateText rate={rate} />
      </span>
    </li>
  )
}

function Rates({ detail }: { detail: PoolDetail }): ReactNode {
  const { rates, aboveLine } = detail.row
  return (
    <Panel label="Yearly rate">
      <p className="mt-2 text-[34px] leading-tight font-[650] tracking-[-0.02em] tabular-nums max-md:text-[28px]">
        <RateText rate={rates.total} />
      </p>
      {aboveLine === false ? (
        <p className="mt-1 text-[14.5px] text-sec">
          Not shown for a pool under $25,000
        </p>
      ) : null}
      <ul className="mt-4">
        <RateLine label="Fees" rate={rates.fees} />
        <RateLine label="Protocol rewards" rate={rates.rewards} />
        <RateLine label="Merkl" rate={rates.merkl} />
        <RateLine label="Matchbox MEZO" rate={rates.gauge} />
      </ul>
      <p className="mt-3 text-[14px] text-sec">est.: our estimate</p>
    </Panel>
  )
}

function Gauge({ detail }: { detail: PoolDetail }): ReactNode {
  const gauge = detail.row.gauge
  return (
    <Panel label="Matchbox gauge paying this pool">
      {gauge === null ? (
        <p className="flex min-h-[140px] items-center justify-center text-[15px] text-sec">
          No Matchbox gauge
        </p>
      ) : (
        <div className="mt-4 rounded-[18px] bg-raised p-5">
          <p className="text-[17px] font-semibold">
            {gauge.name ?? "MEZO gauge"}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <dt className="text-[14px] text-sec">MEZO a week</dt>
              <dd className="mt-0.5 font-semibold">
                <NotAvailable />
              </dd>
            </div>
            <div>
              <dt className="text-[14px] text-sec">Yearly rate</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">
                <RateText rate={detail.row.rates.gauge} />
              </dd>
            </div>
          </dl>
          <p className="mt-4 flex flex-wrap gap-4 text-[15px]">
            <Link
              to="/gauges/$gauge"
              params={{ gauge: gauge.address }}
              className={textLink}
            >
              Gauge page
            </Link>
            <ExternalLink href="https://pro.matchbox.markets/vote">
              Vote on Matchbox
            </ExternalLink>
          </p>
        </div>
      )}
    </Panel>
  )
}

function Sources({ detail }: { detail: PoolDetail }): ReactNode {
  return (
    <Panel label="Where the figures come from">
      {detail.sources.length === 0 ? (
        <p className="flex min-h-[140px] items-center justify-center text-[15px] text-sec">
          Not available yet
        </p>
      ) : (
        <dl className="mt-3">
          {detail.sources.map((each) => (
            <div
              key={each.figure}
              className="flex gap-4 border-b border-line py-3 last:border-b-0"
            >
              <dt className="w-40 flex-none font-semibold">{each.figure}</dt>
              <dd className="min-w-0 text-ink2">{each.source}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-3 text-[14px] text-sec">
        {detail.row.day === null
          ? "No daily figures yet"
          : `Figures for ${detail.row.day}, read through the day`}
      </p>
    </Panel>
  )
}

export function PoolView({ page }: { page: PoolPage }): ReactNode {
  const pool = page.pool
  return (
    <>
      <p className="mt-8 max-xl:mt-5">
        <Link to="/pools" className={backLink}>
          <Glyph shape={shapes.chevronLeft} size={16} strokeWidth={2} />
          Pools
        </Link>
      </p>
      {pool.status !== "ok" ? (
        pool.status === "missing" ? null : (
          <>
            <h1 className="mt-4 text-[34px] leading-tight font-[650] tracking-[-0.02em]">
              Pool
            </h1>
            <div className="mt-6">
              <SectionState section={pool} />
            </div>
          </>
        )
      ) : (
        <>
          <Header detail={pool.data} />
          <Facts detail={pool.data} />
          <OffMezo detail={pool.data} />
          <div className="mt-6 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
            {pool.data.mezo === null ? null : (
              <MezoPoolPanels
                pool={pool.data.row.link.pool}
                figures={pool.data.mezo}
              />
            )}
            <Rates detail={pool.data} />
            <Gauge detail={pool.data} />
            <Sources detail={pool.data} />
          </div>
        </>
      )}
    </>
  )
}
