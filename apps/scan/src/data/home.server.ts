import {
  formatBtc,
  formatDuration,
  unitsToDecimal,
} from "@matchbox/domain/format"
import { canonicalQuery } from "./caller.server"
import { nowSeconds } from "./clock.server"
import type { Section } from "./explorer"
import {
  borrowedTile,
  byIncentives,
  collateralTile,
  countedBlocks,
  type HomeGauge,
  type HomeTile,
  homeGauge,
  incentivesTotal,
  positionsTile,
  sparkline,
  validatorsTile,
} from "./scan/home-views"
import { type LatestBorrowRow, latestBorrowRow } from "./scan/latest-borrowing"
import {
  changeOver,
  compactUsd,
  scaledDecimal,
  usdValue,
} from "./scan/network-views"
import { readScan } from "./scan/read.server"
import { scanSchemas } from "./scan/schemas"
import { metric } from "./scan/series"
import { readSeries } from "./scan/series.server"
import { pointLabel } from "./scan/series-views"
import { scanSection, usdText } from "./scan/voting-views"

/**
 * Home's live sections (`cP_-xnZA8I`): the tiles and "Epoch gauges". Every
 * read runs at once and only its own tile degrades: a tile whose answer is
 * missing is left out, never shown as zero. Sources:
 *
 * - Borrowed: `/borrow/totals` (MUSD owed, Enclaves' share, 30 days).
 * - BTC collateral: `/borrow/totals` `collateral` (open troves, the veBTC
 *   open Enclave positions pledge, BTC-collateral Morpho positions), at
 *   the latest daily BTC price. Hidden until the API sends the part.
 * - Open positions: open troves and Enclave positions from the totals'
 *   venues, Morpho positions that owe from its `collateral`.
 * - veBTC locked: the `escrow.supply` series for veBTC (30 days), in USD
 *   at the latest daily BTC price (`/prices/btc`).
 * - Validators: `/validators`, the set without the pools that left.
 * - Epoch incentives and Epoch gauges: Pro's gauge directory for the
 *   current epoch (`/gauges`), the one answer that prices incentives and
 *   carries each gauge's votes and voter APY. The epoch routes
 *   (`/epochs/{start}/gauges`, `/incentives`) carry token amounts only.
 *
 * Left out until their data exists: the collateral and open positions
 * sparklines (no daily history across venues), MEZO unclaimed by
 * validators, the lock count, TVL, active addresses, and the health
 * column of "Latest borrowing" (the events carry no live position state).
 */

export type HomePage = {
  tiles: HomeTile[]
  /** The newest borrow events of every venue (`/borrow/events`). */
  borrowing: Section<LatestBorrowRow[]>
  gauges: Section<{ epoch: number; rows: HomeGauge[] }>
}

/** Rows "Latest borrowing" shows. */
const borrowingRows = 5

/** Gauges "Epoch gauges" shows. */
const shownGauges = 4

const day = (seconds: number) =>
  new Date(seconds * 1000).toISOString().slice(0, 10)

export async function homePage(): Promise<HomePage> {
  const at = nowSeconds()
  const [borrow, locked, btc, validators, directory, events] =
    await Promise.all([
      readScan(
        "borrow/totals",
        new URLSearchParams(),
        scanSchemas.borrowTotals,
      ),
      readSeries({
        metric: metric("escrow.supply"),
        dimension: "vebtc",
        days: 30,
        now: at,
      }),
      readScan(
        "prices/btc",
        canonicalQuery({ from: day(at - 6 * 86_400), to: day(at) }),
        scanSchemas.prices,
      ),
      readScan("validators", new URLSearchParams(), scanSchemas.validators),
      readScan("gauges", new URLSearchParams(), scanSchemas.gauges),
      readScan(
        "borrow/events",
        canonicalQuery({ limit: borrowingRows }),
        scanSchemas.borrowEvents,
      ),
    ])

  const tiles: HomeTile[] = []
  const borrowed = borrow.status === "ok" ? borrowedTile(borrow.data) : null
  if (borrowed !== null) tiles.push(borrowed)
  const btcPrice =
    btc.status === "ok" ? (btc.data.data.points.at(-1)?.price ?? null) : null
  const venues = borrow.status === "ok" ? borrow.data.data.venues : null
  const collateral =
    borrow.status === "ok" && borrow.data.data.collateral?.status === "ok"
      ? borrow.data.data.collateral.data
      : null
  const backing =
    collateral === null
      ? null
      : collateralTile(
          {
            troves: BigInt(collateral.troves),
            enclaves: BigInt(collateral.enclaves),
            markets: BigInt(collateral.markets),
          },
          btcPrice,
        )
  if (backing !== null) tiles.push(backing)
  const open = positionsTile({
    troves: venues?.troves.status === "ok" ? venues.troves.data.open : null,
    enclaves:
      venues?.enclaves.status === "ok" ? venues.enclaves.data.open : null,
    markets: collateral?.open_markets ?? null,
  })
  if (open !== null) tiles.push(open)

  const lastLocked =
    locked.status === "ok" ? (locked.data.points.at(-1) ?? null) : null
  if (locked.status === "ok" && lastLocked !== null) {
    const price =
      btc.status === "ok" ? (btc.data.data.points.at(-1)?.price ?? null) : null
    const change = changeOver(locked.data, 30, 18)
    tiles.push({
      id: "vebtc",
      label: "veBTC locked",
      value: formatBtc(lastLocked.decimal).text,
      detail:
        price === null ? null : compactUsd(usdValue(lastLocked.decimal, price)),
      aside:
        change.status === "ok"
          ? { label: "30d", value: signedBtc(change.value) }
          : null,
      spark: sparkline(
        locked.data.points.map((point) => scaledDecimal(point.decimal, 18)),
      ),
      sparkDays: locked.data.points.map((point) => ({
        label: pointLabel(point),
        text: formatBtc(point.decimal).text,
      })),
    })
  }

  if (validators.status === "ok") {
    const tile = validatorsTile(
      validators.data.data.validators,
      countedBlocks(validators.data.data),
    )
    if (tile !== null) tiles.push(tile)
  }

  if (directory.status === "ok") {
    const { epoch, gauges } = directory.data.data
    const funded = gauges.filter((card) => card.incentives.tokens.length > 0)
    if (funded.length > 0) {
      tiles.push({
        id: "incentives",
        label: `Epoch ${epoch.number} incentives`,
        value: usdText(incentivesTotal(funded)),
        detail:
          epoch.end > at ? `Closes in ${formatDuration(epoch.end - at)}` : null,
        aside: null,
        spark: null,
        sparkDays: null,
      })
    }
  }

  return {
    tiles,
    borrowing: scanSection(events, (answer) =>
      answer.data.map(latestBorrowRow),
    ),
    gauges: scanSection(directory, (answer) => ({
      epoch: answer.data.epoch.number,
      rows: byIncentives(answer.data.gauges)
        .slice(0, shownGauges)
        .map(homeGauge),
    })),
  }
}

/** "+12.5000 BTC" from 18-decimal units. */
function signedBtc(value: bigint): string {
  const size = value < 0n ? -value : value
  const text = formatBtc(unitsToDecimal(size.toString(), 18)).text
  return `${value < 0n ? "-" : value > 0n ? "+" : ""}${text}`
}
