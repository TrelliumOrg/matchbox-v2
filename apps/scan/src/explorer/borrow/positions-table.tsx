import { shortAddress } from "@matchbox/domain/format"
import * as DataTable from "@matchbox/ui/data-table"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { MorphoRowView, TroveRowView } from "../../data/scan/borrow-views"
import { bandWords } from "../../data/scan/words"
import {
  Amount,
  Borrower,
  bandTone,
  CoinStack,
  HealthCell,
  rowLink,
} from "./parts"

/**
 * Morpho Blue positions with their health, two lines on phones; with
 * troves among them (the closest to liquidation across both), a trove in
 * the same columns.
 */

/** A trove liquidates under the 110% minimum ratio: LTV above 1 / 1.1. */
const troveLtvLimit = 1 / 1.1

function TroveRankRow({
  row,
  showMarket,
}: {
  row: TroveRowView
  showMarket: boolean
}): ReactNode {
  return (
    <DataTable.Row>
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
          {showMarket ? (
            <span className="flex items-center gap-1.5 text-[14px] text-sec">
              <CoinStack collateral="BTC" loan="MUSD" />
              MUSD trove
            </span>
          ) : null}
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
          <span className="pl-[26px] text-[14px] text-sec">{row.rate}</span>
        </span>
      </DataTable.Cell>
      <DataTable.Cell phone="value">
        <span className="max-lg:hidden">
          <HealthCell
            band={row.health.band}
            figure={row.health.healthFactor}
            detail={
              row.collateralRatio === null
                ? row.health.bandText
                : `Collateral ratio ${row.collateralRatio} of 110%`
            }
            share={row.ltvShare}
            limit={troveLtvLimit}
            label={`LTV ${row.health.ltv ?? "none"}, ${row.health.bandText}`}
          />
        </span>
        <span
          className={`font-semibold tabular-nums lg:hidden ${bandTone[row.health.band]}`}
        >
          {row.health.healthFactor ?? row.health.bandText}
        </span>
      </DataTable.Cell>
      <DataTable.Cell align="end" phone="meta">
        <span className="font-semibold lg:text-[15px]">
          {row.health.liquidationPrice ?? "None"}
        </span>
      </DataTable.Cell>
    </DataTable.Row>
  )
}

// -- Morpho positions ---------------------------------------------------------

export function PositionsTable({
  rows,
  caption,
  showMarket = false,
}: {
  rows: readonly (MorphoRowView | TroveRowView)[]
  caption: string
  showMarket?: boolean
}): ReactNode {
  return (
    <DataTable.Root caption={caption} captionHidden reflow="lg">
      <DataTable.Header>
        <DataTable.Column>Borrower</DataTable.Column>
        <DataTable.Column>Collateral</DataTable.Column>
        <DataTable.Column>Debt</DataTable.Column>
        <DataTable.Column>Health</DataTable.Column>
        <DataTable.Column align="end">Liquidates under</DataTable.Column>
      </DataTable.Header>
      <DataTable.Body>
        {rows.length === 0 ? (
          <DataTable.Empty columns={5}>No positions</DataTable.Empty>
        ) : (
          rows.map((row) =>
            row.kind === "trove" ? (
              <TroveRankRow
                key={`trove:${row.owner}`}
                row={row}
                showMarket={showMarket}
              />
            ) : (
              <DataTable.Row key={`${row.marketId}:${row.account}`}>
                <DataTable.Cell phone="title">
                  <Borrower address={row.account}>
                    <Link
                      to="/borrow/markets/$market/$account"
                      params={{ market: row.marketId, account: row.account }}
                      title={row.account}
                      className={`${rowLink} font-mono text-[14.5px]`}
                    >
                      {shortAddress(row.account)}
                    </Link>
                    {showMarket ? (
                      <span className="flex items-center gap-1.5 text-[14px] text-sec">
                        <CoinStack
                          collateral={row.collateralSymbol}
                          loan={row.loanSymbol}
                        />
                        {row.market}
                      </span>
                    ) : null}
                  </Borrower>
                </DataTable.Cell>
                <DataTable.Cell phone="detail">
                  <span className="flex flex-wrap gap-x-4">
                    <Amount coin={row.collateralSymbol} text={row.collateral} />
                    <span className="lg:hidden">
                      <Amount coin={row.loanSymbol} text={row.debt} />
                    </span>
                  </span>
                </DataTable.Cell>
                <DataTable.Cell>
                  <span className="flex flex-col">
                    <Amount coin={row.loanSymbol} text={row.debt} />
                    {row.debtShare !== null ? (
                      <span className="pl-[26px] text-[14px] text-sec">
                        {row.debtShare}
                      </span>
                    ) : row.borrowApr === null ? null : (
                      <span className="pl-[26px] text-[14px] text-sec">
                        {row.borrowApr} APR
                      </span>
                    )}
                  </span>
                </DataTable.Cell>
                <DataTable.Cell phone="value">
                  <span className="max-lg:hidden">
                    <HealthCell
                      band={row.health.band}
                      figure={row.health.healthFactor}
                      detail={
                        row.health.ltv === null
                          ? bandWords[row.health.band]
                          : `LTV ${row.health.ltv}${row.lltv === null ? "" : ` of ${row.lltv}`}`
                      }
                      share={row.ltvShare}
                      limit={row.lltvShare}
                      label={`LTV ${row.health.ltv ?? "none"}, ${bandWords[row.health.band]}`}
                    />
                  </span>
                  <span
                    className={`font-semibold tabular-nums lg:hidden ${bandTone[row.health.band]}`}
                  >
                    {row.health.healthFactor ?? bandWords[row.health.band]}
                  </span>
                </DataTable.Cell>
                <DataTable.Cell align="end" phone="meta">
                  <span className="flex flex-col items-end">
                    <span className="font-semibold lg:text-[15px]">
                      {row.health.liquidationPrice ?? "None"}
                    </span>
                    {row.drop === null ? null : (
                      <span className="text-[14px] text-sec max-lg:hidden">
                        {row.drop}
                      </span>
                    )}
                  </span>
                </DataTable.Cell>
              </DataTable.Row>
            ),
          )
        )}
      </DataTable.Body>
    </DataTable.Root>
  )
}
