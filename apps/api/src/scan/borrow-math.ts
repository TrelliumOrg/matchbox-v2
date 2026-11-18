import type {
  ScanLoanHealth,
  ScanMorphoMarket,
  ScanMorphoPosition,
  ScanTrove,
} from "@matchbox/contracts/scan"
import {
  bandFor,
  collateralRatio,
  formatFixedPoint,
  liquidationPrice,
} from "@matchbox/domain"
import { z } from "zod"

// Health of Borrow positions at read time, from the live snapshot's state
// and the current price. All bigint; no Number or parseFloat on amounts.
// Troves use @matchbox/domain's LiquityMath port. @matchbox/domain has no
// Morpho Blue math yet, so the share conversions and health below follow
// Morpho's SharesMathLib and MarketParams (virtual shares 1e6, virtual
// assets 1, oracle price scaled by 1e36) and should move to the domain
// package (README, "Not served yet").

const WAD = 10n ** 18n
const ORACLE_SCALE = 10n ** 36n
const VIRTUAL_SHARES = 10n ** 6n
const VIRTUAL_ASSETS = 1n

/** mUSD's minimum and critical collateral ratios (110%, 150%). */
export const MUSD_MCR = (110n * WAD) / 100n
export const MUSD_CCR = (150n * WAD) / 100n

/** Below this health factor a Morpho position is near liquidation. */
const NEAR_LIQUIDATION_HEALTH = (110n * WAD) / 100n

function toAssetsDown(shares: bigint, assets: bigint, total: bigint): bigint {
  return (shares * (assets + VIRTUAL_ASSETS)) / (total + VIRTUAL_SHARES)
}

function toAssetsUp(shares: bigint, assets: bigint, total: bigint): bigint {
  const denominator = total + VIRTUAL_SHARES
  return (shares * (assets + VIRTUAL_ASSETS) + denominator - 1n) / denominator
}

function divUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator
}

export type MarketRow = {
  market_id: string
  loan_token: string
  collateral_token: string
  oracle: string
  irm: string
  lltv_raw: string
  total_supply_assets_raw: string
  total_supply_shares_raw: string
  total_borrow_assets_raw: string
  total_borrow_shares_raw: string
  fee_raw: string
  borrow_rate_raw: string | null
  oracle_price_raw: string | null
  block: number
  updated_at: number
}

export function marketView(row: MarketRow): ScanMorphoMarket {
  const supplied = BigInt(row.total_supply_assets_raw)
  const borrowed = BigInt(row.total_borrow_assets_raw)
  return {
    market_id: row.market_id,
    loan_token: row.loan_token.toLowerCase(),
    collateral_token: row.collateral_token.toLowerCase(),
    oracle: row.oracle.toLowerCase(),
    irm: row.irm.toLowerCase(),
    lltv: row.lltv_raw,
    total_supply_assets: row.total_supply_assets_raw,
    total_supply_shares: row.total_supply_shares_raw,
    total_borrow_assets: row.total_borrow_assets_raw,
    total_borrow_shares: row.total_borrow_shares_raw,
    fee: row.fee_raw,
    utilization:
      supplied === 0n ? null : ((borrowed * WAD) / supplied).toString(),
    borrow_rate_per_second: row.borrow_rate_raw,
    oracle_price: row.oracle_price_raw,
    block: row.block,
    updated_at: row.updated_at,
  }
}

export type PositionRow = {
  market_id: string
  account: string
  supply_shares_raw: string
  borrow_shares_raw: string
  collateral_raw: string
  block: number
  updated_at: number
}

/**
 * A Morpho position with its assets and health at the snapshot. Interest
 * accrued since the market's last update is not included (the snapshot is
 * at most five minutes old).
 */
export function morphoPositionView(
  position: PositionRow,
  market: MarketRow,
): ScanMorphoPosition {
  const supplyShares = BigInt(position.supply_shares_raw)
  const borrowShares = BigInt(position.borrow_shares_raw)
  const collateral = BigInt(position.collateral_raw)
  const supplyAssets = toAssetsDown(
    supplyShares,
    BigInt(market.total_supply_assets_raw),
    BigInt(market.total_supply_shares_raw),
  )
  const borrowAssets = toAssetsUp(
    borrowShares,
    BigInt(market.total_borrow_assets_raw),
    BigInt(market.total_borrow_shares_raw),
  )
  return {
    market_id: position.market_id,
    account: position.account.toLowerCase(),
    supply_shares: position.supply_shares_raw,
    supply_assets: supplyAssets.toString(),
    borrow_shares: position.borrow_shares_raw,
    borrow_assets: borrowAssets.toString(),
    collateral: position.collateral_raw,
    health: morphoHealth({
      borrowAssets,
      collateral,
      lltv: BigInt(market.lltv_raw),
      oraclePrice:
        market.oracle_price_raw === null
          ? null
          : BigInt(market.oracle_price_raw),
    }),
    block: position.block,
    updated_at: position.updated_at,
  }
}

export function morphoHealth(input: {
  borrowAssets: bigint
  collateral: bigint
  lltv: bigint
  oraclePrice: bigint | null
}): ScanLoanHealth {
  const { borrowAssets, collateral, lltv, oraclePrice } = input
  if (borrowAssets === 0n) {
    return {
      ltv: null,
      health_factor: null,
      liquidation_price: null,
      band: "no_debt",
    }
  }
  if (oraclePrice === null) {
    // Debt and nothing to value the collateral with: not known healthy.
    return {
      ltv: null,
      health_factor: null,
      liquidation_price: null,
      band: "unknown",
    }
  }
  if (collateral === 0n || lltv === 0n) {
    return {
      ltv: null,
      health_factor: "0",
      liquidation_price: null,
      band: "liquidatable",
    }
  }
  // Collateral value in loan-token base units.
  const value = (collateral * oraclePrice) / ORACLE_SCALE
  const ltv = value === 0n ? null : divUp(borrowAssets * WAD, value)
  const maxBorrow = (value * lltv) / WAD
  const health = (maxBorrow * WAD) / borrowAssets
  // Oracle price at which borrowAssets equals collateral value x LLTV.
  const liquidation = divUp(
    borrowAssets * ORACLE_SCALE * WAD,
    collateral * lltv,
  )
  let band: ScanLoanHealth["band"] = "healthy"
  if (health < WAD) band = "liquidatable"
  else if (health < NEAR_LIQUIDATION_HEALTH) band = "near_liquidation"
  return {
    ltv: ltv === null ? null : ltv.toString(),
    health_factor: health.toString(),
    liquidation_price: liquidation.toString(),
    band,
  }
}

export type TroveRow = {
  owner: string
  status: string
  coll_raw: string
  principal_raw: string
  interest_raw: string
  interest_rate: number
  block: number
  updated_at: number
}

/** MUSD's PriceFeed price: USD per BTC, 1e18-scaled, and its block. */
export type TrovePrice = {
  usd: bigint
  /** musd_btc_price_block: the block of the last live run that read it. */
  block: number | null
  /** The stability_pool row's block: the pool's last change. */
  poolBlock: number | null
}

/**
 * Whether the PriceFeed price is current for a trove. The live snapshot
 * (apps/jobs/src/live/snapshot.ts, since 5785d87) writes the price and
 * musd_btc_price_block on every run, right after the batch that rewrites
 * troves and the pool, while those rows' `block` moves only when their
 * values change, so it is never newer than the latest run's. A price
 * block older than the trove's or the pool's therefore means a later run
 * wrote those rows and then failed to write the price: the price is from
 * an earlier run, stale. Exact, no threshold. The pool is the better
 * witness of a later run (it changes most runs), so the reference is the
 * newer of the two. Null when it cannot be judged (no price block).
 */
export function trovePriceLag(
  feed: TrovePrice,
  troveBlock: number,
): { lagBlocks: number; stale: boolean } | null {
  if (feed.block === null) return null
  const reference = Math.max(troveBlock, feed.poolBlock ?? 0)
  const lagBlocks = Math.max(0, reference - feed.block)
  return { lagBlocks, stale: lagBlocks > 0 }
}

/**
 * The PriceFeed price from the stability_pool row's musd_btc_price_raw,
 * _scale and _block (apps/jobs/migrations/0005). Null when the raw value
 * or its scale is NULL or absent (a reverted read, rows from before the
 * migration), malformed, or zero: troves are then `unknown`.
 */
export function trovePriceOf(row: unknown): TrovePrice | null {
  const parsed = trovePriceRowSchema.safeParse(row)
  if (!parsed.success) return null
  const raw = parsed.data.musd_btc_price_raw
  const scale = parsed.data.musd_btc_price_scale
  if (
    raw === null ||
    raw === undefined ||
    scale === null ||
    scale === undefined
  ) {
    return null
  }
  const value = BigInt(raw)
  const usd =
    scale <= 18
      ? value * 10n ** BigInt(18 - scale)
      : value / 10n ** BigInt(scale - 18)
  if (usd === 0n) return null
  return {
    usd,
    block: parsed.data.musd_btc_price_block ?? null,
    poolBlock: parsed.data.block ?? null,
  }
}

const trovePriceRowSchema = z.object({
  musd_btc_price_raw: z
    .string()
    .regex(/^(0|[1-9][0-9]{0,77})$/)
    .nullable()
    .optional(),
  musd_btc_price_scale: z.number().int().min(0).max(36).nullable().optional(),
  musd_btc_price_block: z.number().int().nonnegative().nullable().optional(),
  block: z.number().int().nonnegative().nullable().optional(),
})

/**
 * A trove with ICR, LTV and liquidation price at MUSD's PriceFeed price,
 * the one the protocol uses. Without it, or with a stale one (older than
 * the trove's or the pool's last write: trovePriceLag), the trove is
 * `unknown`: the protocol prices with a current price, so an old one could
 * band it wrongly exactly when the price moves, and the market price is
 * not a stand-in. A stale price is still shown in `health_basis`.
 */
export function troveView(row: TroveRow, feed: TrovePrice | null): ScanTrove {
  const coll = BigInt(row.coll_raw)
  const debt = BigInt(row.principal_raw) + BigInt(row.interest_raw)
  const lag = feed === null ? null : trovePriceLag(feed, row.block)
  const price = lag?.stale === true ? null : (feed?.usd ?? null)
  const base = {
    owner: row.owner.toLowerCase(),
    status: row.status,
    coll: row.coll_raw,
    principal: row.principal_raw,
    interest: row.interest_raw,
    interest_rate: row.interest_rate,
    health_basis: {
      source: "price_feed" as const,
      btc_usd: feed === null ? null : formatFixedPoint(feed.usd, 18),
      estimate: false,
      block: feed?.block ?? null,
      stale: lag === null ? null : lag.stale,
      lag_blocks: lag?.lagBlocks ?? null,
    },
    block: row.block,
    updated_at: row.updated_at,
  }
  if (debt === 0n) {
    return {
      ...base,
      health: {
        ltv: null,
        health_factor: null,
        liquidation_price: null,
        band: "no_debt",
        collateral_ratio: null,
      },
    }
  }
  const liquidation = liquidationPrice(MUSD_MCR, debt, coll)
  if (price === null) {
    return {
      ...base,
      health: {
        ltv: null,
        health_factor: null,
        liquidation_price: liquidation?.toString() ?? null,
        band: "unknown",
        collateral_ratio: null,
      },
    }
  }
  const ratio = collateralRatio(coll, price, debt)
  const value = (coll * price) / WAD
  return {
    ...base,
    health: {
      collateral_ratio: ratio?.toString() ?? null,
      ltv: value === 0n ? null : divUp(debt * WAD, value).toString(),
      health_factor:
        ratio === null ? null : ((ratio * WAD) / MUSD_MCR).toString(),
      liquidation_price: liquidation?.toString() ?? null,
      band: bandFor(ratio, MUSD_MCR, MUSD_CCR),
    },
  }
}
