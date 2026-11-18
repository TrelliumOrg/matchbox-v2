import { addressAvatar, formatDay, shortAddress } from "@matchbox/domain/format"
import * as Avatar from "@matchbox/ui/avatar"
import * as DataTable from "@matchbox/ui/data-table"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as SubTabs from "@matchbox/ui/sub-tabs"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { LiquidationView } from "../../data/borrow"
import type {
  EnclaveRowView,
  MarketDetailView,
  TroveRowView,
} from "../../data/scan/borrow-views"
import { PageTitle } from "../../shell/page"
import { TxLink } from "../parts"
import {
  Amount,
  Borrower,
  bandTone,
  Coin,
  CoinPair,
  HealthBar,
  HealthCell,
  rowLink,
} from "./parts"

/**
 * The Borrow topic's lists (`mGK4_HnGnZ`): the title with its tabs,
 * Morpho Blue markets, MUSD troves and trove liquidations, on hairlines
 * that reflow to two lines on phones. One module, so the topic adds few
 * chunks to the entry's import map.
 */

// -- title and tabs -----------------------------------------------------------

const tabs = [
  { label: "Overview", key: "overview" },
  { label: "Enclaves", key: "enclaves" },
  { label: "Markets", key: "markets" },
  { label: "Positions", key: "positions" },
  { label: "Liquidations", key: "liquidations" },
  { label: "Troves", key: "troves" },
] as const

export type BorrowTab = (typeof tabs)[number]["key"]

export function BorrowHeader({ current }: { current: BorrowTab }): ReactNode {
  return (
    <>
      <PageTitle>Borrow</PageTitle>
      <SubTabs.Root label="Borrow" className="mt-4 mb-8">
        {tabs.map((tab) => {
          const active = tab.key === current ? "page" : undefined
          return (
            <SubTabs.Item key={tab.key}>
              {tab.key === "overview" ? (
                <Link
                  to="/borrow"
                  activeOptions={{ exact: true }}
                  aria-current={active}
                >
                  {tab.label}
                </Link>
              ) : (
                <Link
                  to="/borrow/$tab"
                  params={{ tab: tab.key }}
                  aria-current={active}
                >
                  {tab.label}
                </Link>
              )}
            </SubTabs.Item>
          )
        })}
      </SubTabs.Root>
    </>
  )
}

/** A quiet underlined link to a fuller list ("All markets"). */
export function MoreLink({
  tab,
  children,
}: {
  tab: Exclude<BorrowTab, "overview">
  children: string
}): ReactNode {
  return (
    <Link
      to="/borrow/$tab"
      params={{ tab }}
      className="rounded-sm text-[15px] font-semibold text-ink underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ink"
    >
      {children}
    </Link>
  )
}

// -- markets ------------------------------------------------------------------

export function MarketsTable({
  markets,
}: {
  markets: readonly MarketDetailView[]
}): ReactNode {
  return (
    <DataTable.Root caption="Morpho Blue markets" captionHidden reflow="lg">
      <DataTable.Header>
        <DataTable.Column>Market</DataTable.Column>
        <DataTable.Column>LLTV</DataTable.Column>
        <DataTable.Column>Borrow APR</DataTable.Column>
        <DataTable.Column>Utilization</DataTable.Column>
        <DataTable.Column>Borrowed</DataTable.Column>
        <DataTable.Column align="end">
          <span className="sr-only">Open</span>
        </DataTable.Column>
      </DataTable.Header>
      <DataTable.Body>
        {markets.length === 0 ? (
          <DataTable.Empty columns={6}>No markets</DataTable.Empty>
        ) : (
          markets.map((market) => (
            <DataTable.Row key={market.id}>
              <DataTable.Cell phone="title">
                <span className="flex min-w-0 items-center gap-3">
                  <CoinPair
                    collateral={market.collateral?.symbol ?? null}
                    loan={market.loan?.symbol ?? null}
                    size={26}
                  />
                  <span className="flex min-w-0 flex-col">
                    <Link
                      to="/borrow/markets/$market"
                      params={{ market: market.id }}
                      className={rowLink}
                    >
                      {market.name}
                    </Link>
                    <span className="font-mono text-[13.5px] text-sec">
                      {shortAddress(market.id)}
                    </span>
                  </span>
                </span>
              </DataTable.Cell>
              <DataTable.Cell phone="detail">
                <span className="lg:font-semibold">
                  <span className="lg:hidden">LLTV </span>
                  {market.lltv}
                </span>
              </DataTable.Cell>
              <DataTable.Cell phone="value">
                <span className="font-semibold">
                  {market.borrowApr ?? "None"}
                  <span className="font-normal text-sec lg:hidden"> APR</span>
                </span>
              </DataTable.Cell>
              <DataTable.Cell phone="meta">
                <span className="flex items-center gap-3 max-lg:justify-end">
                  <span className="w-24 max-lg:w-16">
                    <HealthBar
                      share={market.utilizationShare}
                      limit={null}
                      band="near_liquidation"
                      label={`Utilization ${market.utilization ?? "unknown"}`}
                    />
                  </span>
                  <span className="tabular-nums">
                    {market.utilization ?? "None"}
                  </span>
                </span>
              </DataTable.Cell>
              <DataTable.Cell>
                <span className="flex flex-col">
                  <span className="font-semibold">
                    {market.borrowed ?? "None"}
                  </span>
                  <span className="text-[14px] text-sec">
                    {market.supplied === null
                      ? null
                      : `${market.supplied} supplied`}
                  </span>
                </span>
              </DataTable.Cell>
              <DataTable.Cell align="end">
                <Link
                  to="/borrow/markets/$market"
                  params={{ market: market.id }}
                  aria-label={`Open ${market.name}`}
                  className="inline-grid size-9 place-items-center rounded-full text-sec outline-none hover:bg-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
                >
                  <Glyph
                    shape={shapes.chevronRight}
                    size={18}
                    strokeWidth={2}
                  />
                </Link>
              </DataTable.Cell>
            </DataTable.Row>
          ))
        )}
      </DataTable.Body>
    </DataTable.Root>
  )
}

// -- Enclaves -----------------------------------------------------------------

/** A position's veBTC locks, linked to their lock pages. */
function PledgedLocks({ tokens }: { tokens: readonly string[] }): ReactNode {
  if (tokens.length === 0) return <span className="text-sec">None</span>
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {tokens.map((token) => (
        <Link
          key={token}
          to="/locks/$escrow/$id"
          params={{ escrow: "vebtc", id: token }}
          className={`${rowLink} inline-flex items-center gap-2 tabular-nums`}
        >
          <Coin ticker="BTC" />
          veBTC #{token}
        </Link>
      ))}
    </span>
  )
}

/**
 * Enclave positions (`mGK4_HnGnZ`): position and borrower, the veBTC
 * pledged, principal (interest accrues on chain with no event, so it is
 * not here), MUSD minted and repaid, and the state with its last change.
 */
export function EnclavesTable({
  rows,
  caption,
}: {
  rows: readonly EnclaveRowView[]
  caption: string
}): ReactNode {
  return (
    <DataTable.Root caption={caption} captionHidden reflow="lg">
      <DataTable.Header>
        <DataTable.Column>Position</DataTable.Column>
        <DataTable.Column>Collateral</DataTable.Column>
        <DataTable.Column>Principal</DataTable.Column>
        <DataTable.Column>Minted</DataTable.Column>
        <DataTable.Column align="end">State</DataTable.Column>
      </DataTable.Header>
      <DataTable.Body>
        {rows.length === 0 ? (
          <DataTable.Empty columns={5}>No Enclave positions</DataTable.Empty>
        ) : (
          rows.map((row) => (
            <DataTable.Row key={row.positionId}>
              <DataTable.Cell phone="title">
                <Borrower address={row.borrower ?? row.enclave}>
                  <Link
                    to="/borrow/enclaves/$position"
                    params={{ position: row.positionId }}
                    title={row.positionId}
                    className={`${rowLink} font-mono text-[14.5px]`}
                  >
                    {row.short}
                  </Link>
                  <span className="font-mono text-[14px] text-sec">
                    {row.borrower === null
                      ? "Unknown borrower"
                      : shortAddress(row.borrower)}
                  </span>
                </Borrower>
              </DataTable.Cell>
              <DataTable.Cell phone="detail">
                <PledgedLocks tokens={row.open ? row.pledged : row.tokens} />
              </DataTable.Cell>
              <DataTable.Cell phone="value">
                <Amount coin="MUSD" text={row.principal} />
              </DataTable.Cell>
              <DataTable.Cell>
                <span className="flex flex-col tabular-nums">
                  <span className="font-semibold">{row.minted ?? "None"}</span>
                  <span className="text-[14px] text-sec">
                    {row.repaid === null ? null : `${row.repaid} repaid`}
                  </span>
                </span>
              </DataTable.Cell>
              <DataTable.Cell align="end" phone="meta">
                <span className="flex flex-col items-end">
                  <span
                    className={`font-semibold ${row.open ? "text-pos" : "text-ink2"}`}
                  >
                    {row.status}
                  </span>
                  <span className="text-[14px] text-sec">
                    {row.open && row.openedAt !== null
                      ? `Since ${formatDay(row.openedAt)}`
                      : `${row.latestAction} ${formatDay(row.latestAt)}`}
                  </span>
                </span>
              </DataTable.Cell>
            </DataTable.Row>
          ))
        )}
      </DataTable.Body>
    </DataTable.Root>
  )
}

// -- troves -------------------------------------------------------------------

export function TrovesTable({
  rows,
}: {
  rows: readonly TroveRowView[]
}): ReactNode {
  return (
    <DataTable.Root caption="MUSD troves" captionHidden reflow="lg">
      <DataTable.Header>
        <DataTable.Column>Owner</DataTable.Column>
        <DataTable.Column>Collateral</DataTable.Column>
        <DataTable.Column>Debt</DataTable.Column>
        <DataTable.Column>Collateral ratio</DataTable.Column>
        <DataTable.Column align="end">Liquidates under</DataTable.Column>
      </DataTable.Header>
      <DataTable.Body>
        {rows.length === 0 ? (
          <DataTable.Empty columns={5}>No troves</DataTable.Empty>
        ) : (
          rows.map((row) => (
            <DataTable.Row key={row.owner}>
              <DataTable.Cell phone="title">
                <Borrower address={row.owner}>
                  <Link
                    to="/borrow/troves/$owner"
                    params={{ owner: row.owner }}
                    title={row.owner}
                    className={`${rowLink} font-mono text-[14.5px]`}
                  >
                    {shortAddress(row.owner)}
                  </Link>
                  <span className="text-[14px] text-sec max-lg:hidden">
                    {row.status}
                  </span>
                </Borrower>
              </DataTable.Cell>
              <DataTable.Cell phone="detail">
                <span className="flex flex-wrap gap-x-4">
                  <Amount coin="BTC" text={row.collateral} />
                  <span className="lg:hidden">
                    <Amount coin="MUSD" text={row.debt} />
                  </span>
                </span>
              </DataTable.Cell>
              <DataTable.Cell>
                <span className="flex flex-col">
                  <Amount coin="MUSD" text={row.debt} />
                  <span className="pl-[26px] text-[14px] text-sec">
                    {row.rate}
                  </span>
                </span>
              </DataTable.Cell>
              <DataTable.Cell phone="value">
                <span className="max-lg:hidden">
                  <HealthCell
                    band={row.health.band}
                    figure={row.collateralRatio}
                    detail={
                      [
                        row.health.ltv === null
                          ? null
                          : `LTV ${row.health.ltv}`,
                        row.health.estimate ? "estimate" : null,
                        row.health.priceNote,
                      ]
                        .filter((part) => part !== null)
                        .join(", ") || null
                    }
                    share={row.ltvShare}
                    limit={null}
                    label={`LTV ${row.health.ltv ?? "none"}, ${row.health.bandText}`}
                  />
                </span>
                <span
                  className={`font-semibold tabular-nums lg:hidden ${bandTone[row.health.band]}`}
                >
                  {row.collateralRatio ?? row.health.bandText}
                </span>
              </DataTable.Cell>
              <DataTable.Cell align="end" phone="meta">
                <span className="font-semibold lg:text-[15px]">
                  {row.health.liquidationPrice ?? "None"}
                </span>
              </DataTable.Cell>
            </DataTable.Row>
          ))
        )}
      </DataTable.Body>
    </DataTable.Root>
  )
}

/** Troves as compact rows (the overview's panel): ratio and liquidation. */
export function TroveList({
  rows,
}: {
  rows: readonly TroveRowView[]
}): ReactNode {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-[15px] text-sec">No troves</p>
  }
  return (
    <ul aria-label="Lowest collateral ratio" className="flex flex-col">
      {rows.map((row) => {
        const avatar = addressAvatar(row.owner)
        return (
          <li
            key={row.owner}
            className="flex items-center gap-3 border-b border-line py-3 last:border-b-0"
          >
            <Avatar.Root
              initials={avatar.initials}
              hue={avatar.hue}
              size={36}
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <Link
                to="/borrow/troves/$owner"
                params={{ owner: row.owner }}
                title={row.owner}
                className={`${rowLink} font-mono text-[14.5px]`}
              >
                {shortAddress(row.owner)}
              </Link>
              <span className="flex flex-wrap gap-x-3 text-[14px] text-sec">
                <Amount coin="BTC" text={row.collateral} />
                <Amount coin="MUSD" text={row.debt} />
              </span>
            </span>
            <span className="flex flex-col items-end text-right">
              <span
                className={`text-[15px] font-semibold tabular-nums ${bandTone[row.health.band]}`}
              >
                {row.collateralRatio ?? row.health.bandText}
              </span>
              {row.health.liquidationPrice === null ? null : (
                <span className="text-[14px] text-sec tabular-nums">
                  Under {row.health.liquidationPrice}
                </span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

// -- liquidations -------------------------------------------------------------

/** The liquidated loan's owner, linked to the trove or the position. */
function LiquidatedLoan({ row }: { row: LiquidationView }): ReactNode {
  const className = `${rowLink} font-mono text-[14.5px]`
  if (row.borrower === null) {
    return <span className="font-mono text-[14.5px]">Unknown account</span>
  }
  return row.loan.kind === "trove" ? (
    <Link
      to="/borrow/troves/$owner"
      params={{ owner: row.borrower }}
      title={row.borrower}
      className={className}
    >
      {shortAddress(row.borrower)}
    </Link>
  ) : (
    <Link
      to="/borrow/markets/$market/$account"
      params={{ market: row.loan.market, account: row.borrower }}
      title={row.borrower}
      className={className}
    >
      {shortAddress(row.borrower)}
    </Link>
  )
}

export function LiquidationList({
  rows,
  label,
  empty,
}: {
  rows: readonly LiquidationView[]
  label: string
  empty: string
}): ReactNode {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-[15px] text-sec">{empty}</p>
  }
  return (
    <ul aria-label={label} className="flex flex-col">
      {rows.map((row) => {
        const avatar = addressAvatar(row.borrower ?? row.txHash.slice(0, 42))
        const loan = row.loan.kind === "trove" ? "MUSD trove" : row.loan.name
        return (
          <li
            key={row.key}
            className="flex items-center gap-3 border-b border-line py-3 last:border-b-0"
          >
            <Avatar.Root
              initials={avatar.initials}
              hue={avatar.hue}
              size={36}
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <LiquidatedLoan row={row} />
              <span className="truncate text-[14px] text-sec tabular-nums">
                {loan}, {row.detail ?? "No amount"}
              </span>
            </span>
            <span className="flex flex-col items-end text-right">
              <span className="text-[15px] font-semibold">{row.day}</span>
              <span className="max-md:hidden">
                <TxLink hash={row.txHash} />
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
