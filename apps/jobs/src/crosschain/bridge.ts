import {
  type BridgedAsset,
  bridgedAssets,
  chainOfWormholeId,
} from "@matchbox/chain"
import type { JsonRow } from "../scan/statements"
import { nextDay } from "../scan/transform"
import {
  type BridgeDay,
  type Fetcher,
  type RouteTotal,
  wormholeDaily,
  wormholeRouteTotals,
} from "./sources"

// Wormhole NTT flows from Wormholescan. Per route it gives only all-time
// totals (transfers, USD), so each day's totals are stored and a route's
// daily flow is the change from the previous stored day (the API computes
// it). Its own daily series covers every route together. Wormholescan's
// NTT endpoints know MUSD only: they answer "Unsupported token" for MEZO,
// so MEZO's flows are not available.

/** Assets Wormholescan's NTT endpoints support (checked 12 Nov 2026). */
export const wormholescanAssets: readonly BridgedAsset[] = ["musd"]

/** Days of Wormholescan's daily series re-read each run (late transfers). */
export const bridgeDaysBack = 7

/** A chain's slug, or "wormhole-{id}" for a chain not in the catalog. */
function chainName(wormholeId: number): string {
  return chainOfWormholeId(wormholeId) ?? `wormhole-${wormholeId}`
}

export function routeTotalRows(
  asset: BridgedAsset,
  totals: readonly RouteTotal[],
  day: string,
  nowSeconds: number,
): JsonRow[] {
  return totals.map((total) => ({
    asset,
    from_chain: chainName(total.from),
    to_chain: chainName(total.to),
    day,
    transfers_total: total.transfers,
    notional_usd_total: total.notionalUsd,
    updated_at: nowSeconds,
  }))
}

export function bridgeDailyRows(
  asset: BridgedAsset,
  days: readonly BridgeDay[],
  nowSeconds: number,
): JsonRow[] {
  return days.map((day) => ({
    asset,
    day: day.day,
    transfers: day.transfers,
    notional_usd: day.notionalUsd,
    updated_at: nowSeconds,
  }))
}

export type BridgeReading = {
  asset: BridgedAsset
  totals: RouteTotal[]
  days: BridgeDay[]
}

/** Route totals now, and the daily series from `fromDay` through today. */
export async function readBridgeFlows(
  fetcher: Fetcher,
  asset: BridgedAsset,
  fromDay: string,
  today: string,
): Promise<BridgeReading> {
  const symbol = bridgedAssets[asset].symbol
  const [totals, days] = await Promise.all([
    wormholeRouteTotals(fetcher, symbol),
    wormholeDaily(fetcher, symbol, fromDay, nextDay(today)),
  ])
  return { asset, totals, days }
}
