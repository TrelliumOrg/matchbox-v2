import mezoCoin from "@matchbox/token-icons/icons/mezo.svg?raw"
import musdCoin from "@matchbox/token-icons/icons/musd.svg?raw"
import * as HashChip from "@matchbox/ui/hash-chip"
import { Link } from "@tanstack/react-router"
import { type ReactNode, Suspense } from "react"
import type { Section } from "../../data/explorer"
import type { EmissionsView } from "../../data/gauges"
import type { TokenTab } from "../../data/scan/token-list"
import type { TokenPage } from "../../data/token-pages"
import type { TokenTabData } from "../../data/token-tabs"
import { deferred } from "../../shell/deferred"
import { mezoBorrowUrl } from "../borrow/parts"
import { Filling } from "../filling"
import {
  EpochBars,
  Figure,
  MatchboxAction,
  Panel,
  PanelEmpty,
  PanelState,
  proOrigin,
  RangeToggle,
  reserveFor,
  Stats,
} from "../voting/parts"
import { SeriesBody } from "../voting/series-panel"
import { TokenTabBar } from "./token-tabs"

/**
 * A token's page: MUSD (`iuXYHNtoLX`) and MEZO (`ZaITnY1T_X`). The
 * identity header with the action where one exists (borrowing on Mezo,
 * locking on Matchbox), the header figures (MEZO's market cap is its
 * supply at its daily price), then the tabs: Overview's captioned panels
 * on one period toggle, and Holders, Transfers and Contract from the
 * Blockscout proxy (token-tabs). Left out until their data exists: the
 * Loans, Savings vault, Locks and Emissions tabs, the transfers count,
 * Watch, the created date, MUSD's fees and peg band, MEZO's fully diluted
 * value and not-yet-emitted part (no maximum supply source) and volume,
 * emissions per gauge type, and large transfers or locks. Where MUSD
 * sits, MEZO's supply split and where emissions go are shares of now.
 */

/** Price, supply by chain, pools and the bridge: off the first paint. */
/** The custom span's button and box, off the first paint's scripts. */
const CustomPeriod = deferred(() =>
  import("../voting/custom-period").then((module) => module.CustomPeriod),
)

/**
 * A split now (MEZO's supply and emissions): drawn in the server's HTML,
 * its code off the first paint's scripts (MUSD's load later anyway).
 */
const SplitView = deferred(() =>
  import("./split-panel").then((module) => module.SplitView),
)

const CrossChainSections = deferred(() =>
  import("./cross-chain").then((module) => module.CrossChainSections),
)

/** MUSD's panels read after first paint, with their code. */
const MusdLaterPanels = deferred(() =>
  import("./musd-later").then((module) => module.MusdLaterPanels),
)

/** Holders, Transfers and Contract: loaded only when a tab is open. */
const TokenTabContent = deferred(() =>
  import("./token-tab-content").then((module) => module.TokenTabContent),
)

const actions = {
  musd: { href: mezoBorrowUrl, label: "Borrow on Mezo" },
  mezo: { href: proOrigin, label: "Lock on Matchbox" },
} as const

/** The bundled coins (Mezo's official art), inlined: see Coin. */
const coins = { mezo: mezoCoin, musd: musdCoin } as const

/**
 * The header's coin, drawn inline rather than as an image: it paints with
 * the HTML, with no request of its own, and is never a largest paint that
 * waits on the network.
 */
function Coin({ page }: { page: TokenPage }): ReactNode {
  return (
    <span
      role="img"
      aria-label={page.token.ticker}
      className="block size-16 flex-none [&>svg]:size-full"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: our own bundled SVG file, not user input
      dangerouslySetInnerHTML={{ __html: coins[page.slug] }}
    />
  )
}

function Header({ page }: { page: TokenPage }): ReactNode {
  const action = actions[page.slug]
  return (
    <header className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-4 max-xl:mt-6">
      <Coin page={page} />
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="flex flex-wrap items-baseline gap-x-3 text-[40px] leading-tight font-[650] tracking-[-0.02em] max-xl:text-[32px]">
          {page.token.symbol}
          {page.token.name === null ? null : (
            <span className="text-[20px] font-normal tracking-normal text-sec">
              {page.token.name}
            </span>
          )}
        </h1>
        <HashChip.Root value={page.token.address} className="text-sec">
          <HashChip.Value asChild>
            <Link
              to="/address/$address"
              params={{ address: page.token.address }}
            />
          </HashChip.Value>
          <HashChip.Copy />
        </HashChip.Root>
      </div>
      <span className="flex-1" />
      <MatchboxAction href={action.href}>{action.label}</MatchboxAction>
    </header>
  )
}

function Facts({ page }: { page: TokenPage }): ReactNode {
  if (page.facts.length === 0) return null
  return (
    <dl className="mt-8 grid grid-cols-6 gap-x-6 gap-y-5 border-b border-line pb-8 max-xl:grid-cols-3 max-md:grid-cols-2">
      {page.facts.map((fact) => (
        <div key={fact.label} className="min-w-0">
          <dt className="text-[14px] text-sec">{fact.label}</dt>
          <dd className="mt-1 flex flex-wrap items-baseline gap-x-2 tabular-nums">
            <span className="text-[23px] font-[650] tracking-[-0.01em]">
              {fact.value}
            </span>
            {fact.change === null ? null : (
              <span
                className={`text-[14px] ${fact.change.tone === "neg" ? "text-neg" : "text-pos"}`}
              >
                {fact.change.text}
              </span>
            )}
          </dd>
          {fact.note === null ? null : (
            <dd className="mt-0.5 text-[14px] text-sec">
              {typeof fact.note === "string"
                ? fact.note
                : `${fact.note.source}, ${fact.note.rest}`}
            </dd>
          )}
        </div>
      ))}
    </dl>
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
      aside={
        data === null ? null : (
          <Link
            to="/epochs"
            className="rounded-sm text-[14px] font-semibold outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
          >
            All epochs
          </Link>
        )
      }
    >
      {emissions.status !== "ok" ? (
        <PanelState section={emissions} />
      ) : data === null ? (
        <PanelEmpty>Not available yet</PanelEmpty>
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

export function TokenView({
  page,
  tab,
  paged,
  now,
}: {
  page: TokenPage
  /** A tab past Overview, with its data; null on Overview. */
  tab: TokenTabData | null
  paged: boolean
  now: number
}): ReactNode {
  const current: TokenTab = tab === null ? "overview" : tab.tab
  const holders =
    tab?.tab === "holders" && tab.data.status === "ok"
      ? tab.data.data.holders
      : null
  const bar = (
    <TokenTabBar slug={page.slug} current={current} holders={holders} />
  )
  if (tab !== null) {
    return (
      <>
        <Header page={page} />
        <Facts page={page} />
        {bar}
        <Suspense fallback={null}>
          <TokenTabContent slug={page.slug} tab={tab} paged={paged} now={now} />
        </Suspense>
      </>
    )
  }
  const toggle = (
    <RangeToggle
      period={page.period}
      to="/tokens/$token"
      params={{ token: page.slug }}
      search={{}}
    >
      <Suspense fallback={null}>
        <CustomPeriod period={page.period} search={{}} />
      </Suspense>
    </RangeToggle>
  )
  return (
    <>
      <Header page={page} />
      <Facts page={page} />
      {bar}
      <Suspense fallback={null}>
        <CrossChainSections page={page} />
      </Suspense>
      <h2 className="mt-12 text-[24px] font-[650] tracking-[-0.015em]">
        On Mezo
      </h2>
      <div className="mt-4 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        {page.panels.map((panel) => (
          <Panel key={panel.id} label={panel.label} aside={toggle}>
            {panel.data.status !== "ok" ? (
              <PanelState section={panel.data} />
            ) : (
              <SeriesBody
                name={panel.label}
                data={panel.data.data}
                stats={panel.stats}
                empty={panel.empty}
              />
            )}
          </Panel>
        ))}
        {page.splits.length === 0 ? null : (
          <Suspense fallback={null}>
            {page.splits.map((split) => (
              <SplitView key={split.id} split={split} />
            ))}
          </Suspense>
        )}
        {page.later ? (
          <Suspense fallback={null}>
            <MusdLaterPanels period={page.period} toggle={toggle} />
          </Suspense>
        ) : null}
        {page.emissions === null ? null : (
          <Emissions emissions={page.emissions} />
        )}
      </div>
    </>
  )
}
