import { MORPHO_MARKETS } from "@matchbox/chain"
import type {
  ScanBorrowTotals,
  ScanEnclaveEventItem,
  ScanEnclavePositionSummary,
  ScanLoanHealth,
  ScanMorphoMarket,
  ScanMorphoPosition,
  ScanTrove,
} from "@matchbox/contracts/scan"
import {
  formatDay,
  formatDecimal,
  shortAddress,
  shortHash,
  unitsToDecimal,
} from "@matchbox/domain/format"
import {
  dropToLiquidationBps,
  morphoLiquidationIncentiveFactor,
  morphoSupplyApy,
} from "@matchbox/domain/loanMath"
import { formatTokenAmount, knownTokens, type MarketToken } from "./tokens"
import { bandWords } from "./words"

/**
 * Borrow positions as Scan draws them. Health, LTV, collateral ratio and
 * liquidation price come from the API as 1e18-scaled integer strings
 * (computed there from live state and the current price); this only
 * formats them with the domain helpers and never recomputes money.
 *
 * Morpho figures: the API's Morpho maths is checked only against hand
 * computations so far (apps/api README "Borrow figures"); it needs an
 * on-chain check before launch.
 */

export type HealthBand = ScanLoanHealth["band"]

export type HealthView = {
  band: HealthBand
  /** "1.37": collateral value times the threshold over debt. */
  healthFactor: string | null
  /** "62.7%": debt over collateral value. */
  ltv: string | null
  /**
   * The BTC price the position liquidates at: in USD for a trove (MUSD's
   * PriceFeed prices BTC in USD), "$53,937"; in the loan token for a
   * Morpho position (its oracle prices BTC in the loan token, never taken
   * as $1), "53,937 mUSDC".
   */
  liquidationPrice: string | null
  /**
   * The figures use the market BTC price, not MUSD's own price feed
   * (the API's `health_basis.estimate`): shown as an estimate.
   */
  estimate: boolean
  /** The band in words: "Price out of date" when a stale price banded it. */
  bandText: string
  /**
   * Why the band is unknown when MUSD's price is stale
   * (`health_basis.stale`): "Price 120 blocks old"; null otherwise.
   */
  priceNote: string | null
}

/** A stale protocol price, in words; null when the price is current. */
export function stalePriceNote(
  basis:
    | {
        stale?: boolean | null | undefined
        lag_blocks?: number | null | undefined
      }
    | undefined,
): string | null {
  if (basis?.stale !== true) return null
  const lag = basis.lag_blocks
  return typeof lag === "number" && lag > 0
    ? `Price ${lag.toLocaleString("en-US")} block${lag === 1 ? "" : "s"} old`
    : "Price out of date"
}

/** A 1e18-scaled ratio as a percent with one decimal: "62.7%". */
export function wadPercent(wad: string | null): string | null {
  if (wad === null) return null
  return `${formatDecimal(unitsToDecimal(wad, 16), 1)}%`
}

/**
 * Which way a risk figure rounds: always toward danger, never in the
 * borrower's favour. A health factor or a collateral ratio rounds down (a
 * 0.9951 health factor is "0.99", not a safe-looking "1.00"); an LTV or a
 * liquidation price rounds up.
 */
export type Caution = "down" | "up"

/** `value` over `scale`, rounded `caution`'s way (non-negative values). */
function divideCautious(
  value: bigint,
  scale: bigint,
  caution: Caution,
): bigint {
  const quotient = value / scale
  return caution === "up" && quotient * scale !== value
    ? quotient + 1n
    : quotient
}

/** A 1e18-scaled risk ratio as a percent, one decimal, rounded cautiously. */
export function wadPercentCautious(
  wad: string | null,
  caution: Caution,
): string | null {
  if (wad === null) return null
  const tenths = divideCautious(BigInt(wad), 10n ** 15n, caution)
  return `${formatDecimal(unitsToDecimal(tenths.toString(), 1), 1)}%`
}

/** A 1e18-scaled ratio as a plain figure: "1.37". */
export function wadFigure(wad: string | null, places = 2): string | null {
  if (wad === null) return null
  return formatDecimal(unitsToDecimal(wad, 18), places)
}

/** A health factor, two decimals, rounded down: 0.9951 is "0.99". */
export function healthFigure(wad: string | null): string | null {
  if (wad === null) return null
  const hundredths = divideCautious(BigInt(wad), 10n ** 16n, "down")
  return formatDecimal(unitsToDecimal(hundredths.toString(), 2), 2)
}

/**
 * A price in base units of `decimals` as a whole figure rounded up, so a
 * liquidation price never shows lower than it is: "53,937".
 */
export function wholeUp(units: string, decimals: number): string {
  return formatDecimal(
    divideCautious(BigInt(units), 10n ** BigInt(decimals), "up").toString(),
    0,
  )
}

/** A 1e18-scaled ratio as a number for bars (display only, never money). */
export function wadNumber(wad: string | null): number | null {
  if (wad === null) return null
  return Number(unitsToDecimal(wad, 18))
}

export type MarketView = {
  id: string
  /** "BTC / mUSDC". */
  name: string
  loan: MarketToken | null
  collateral: MarketToken | null
  /** "86%". */
  lltv: string
  supplied: string | null
  borrowed: string | null
  utilization: string | null
  /** APR from the per-second rate: "5.2%". Null when unread. */
  borrowApr: string | null
  /**
   * The oracle's BTC price in the loan token, "74,000 mUSDC" (not dollars:
   * a dollar token is never taken as $1), when known.
   */
  price: string | null
}

const secondsPerYear = 31_536_000n

/**
 * One side of a market: its symbol from the token registry (else its
 * short address) and its decimals from the market answer, read on chain
 * (null when nobody knows them). An API from before b07ccde sends no
 * decimals: the registry's then, else null.
 */
function marketSide(
  address: string,
  decimals: number | null | undefined,
): MarketToken {
  const registered = knownTokens[address.toLowerCase()]
  return {
    symbol: registered?.symbol ?? shortAddress(address),
    decimals:
      decimals === undefined ? (registered?.decimals ?? null) : decimals,
  }
}

/** The market's loan and collateral tokens, with their decimals. */
export function marketTokens(market: ScanMorphoMarket): {
  loan: MarketToken
  collateral: MarketToken
} {
  return {
    loan: marketSide(market.loan_token, market.loan_decimals),
    collateral: marketSide(market.collateral_token, market.collateral_decimals),
  }
}

/** Oracle units' scale: 36 plus the loan's decimals less the collateral's. */
function oracleScale(
  loan: MarketToken | null,
  collateral: MarketToken | null,
): number | null {
  if (loan?.decimals == null || collateral?.decimals == null) return null
  return 36 + loan.decimals - collateral.decimals
}

/** A liquidation price in the loan token, null without both decimals. */
function liquidationText(
  price: string,
  loan: MarketToken,
  collateral: MarketToken | null,
): string | null {
  const scale = oracleScale(loan, collateral)
  return scale === null ? null : `${wholeUp(price, scale)} ${loan.symbol}`
}

/**
 * A market's name: collateral / loan. One the configured list does not
 * have (discovered on chain, as the third market) adds its short id, as
 * it can share its tokens with a configured one.
 */
function marketName(
  id: string,
  loan: MarketToken | null,
  collateral: MarketToken | null,
): string {
  const pair = `${collateral?.symbol ?? "?"} / ${loan?.symbol ?? "?"}`
  return configuredIds.has(id) ? pair : `${pair} (${shortAddress(id)})`
}

/**
 * The market answer by id, for pages that list positions or events
 * without their market (the address page, the liquidations list): every
 * market the API knows, discovered ones included. Empty when the list
 * could not be read, so callers fall back to the configured markets.
 */
export function marketsById(
  markets: readonly ScanMorphoMarket[] | null,
): ReadonlyMap<string, ScanMorphoMarket> {
  return new Map((markets ?? []).map((market) => [market.market_id, market]))
}

export function marketView(market: ScanMorphoMarket): MarketView {
  const { loan, collateral } = marketTokens(market)
  const scale = oracleScale(loan, collateral)
  const rate =
    market.borrow_rate_per_second === null
      ? null
      : (BigInt(market.borrow_rate_per_second) * secondsPerYear).toString()
  return {
    id: market.market_id,
    name: marketName(market.market_id, loan, collateral),
    loan,
    collateral,
    lltv: wadPercent(market.lltv)?.replace(".0%", "%") ?? "",
    supplied: formatTokenAmount(market.total_supply_assets, loan),
    borrowed: formatTokenAmount(market.total_borrow_assets, loan),
    utilization: wadPercent(market.utilization),
    borrowApr: wadPercent(rate),
    price:
      market.oracle_price === null || scale === null
        ? null
        : `${formatDecimal(unitsToDecimal(market.oracle_price, scale), 0)} ${loan.symbol}`,
  }
}

/**
 * The Morpho Blue markets on Mezo whose tokens we know, for positions read
 * without their market (the address document's borrow part).
 */
const knownMarkets: Readonly<
  Record<string, { loan: MarketToken; collateral: MarketToken }>
> = {
  [MORPHO_MARKETS.mainnet.btcMusdc]: {
    loan: marketSide("0x04671c72aab5ac02a03c1098314b1bb6b560c197", undefined),
    collateral: marketSide(
      "0x7b7c000000000000000000000000000000000000",
      undefined,
    ),
  },
  [MORPHO_MARKETS.mainnet.btcMusd]: {
    loan: marketSide("0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186", undefined),
    collateral: marketSide(
      "0x7b7c000000000000000000000000000000000000",
      undefined,
    ),
  },
}

/** The Morpho Blue markets on Mezo we know, by id (read ahead of the list). */
export const knownMarketIds: readonly string[] = Object.keys(knownMarkets)

const configuredIds = new Set(knownMarketIds)

export type MorphoPositionView = {
  kind: "morpho"
  marketId: string
  market: string
  account: string
  collateral: string | null
  debt: string | null
  health: HealthView
}

export function morphoPositionView(
  position: ScanMorphoPosition,
  market: MarketView | null,
): MorphoPositionView {
  const known = knownMarkets[position.market_id]
  const loan = market?.loan ?? known?.loan ?? null
  const collateral = market?.collateral ?? known?.collateral ?? null
  return {
    kind: "morpho",
    marketId: position.market_id,
    market:
      market?.name ??
      (loan === null || collateral === null
        ? "Morpho market"
        : marketName(position.market_id, loan, collateral)),
    account: position.account,
    collateral: formatTokenAmount(position.collateral, collateral),
    debt: formatTokenAmount(position.borrow_assets, loan),
    health: {
      estimate: false,
      band: position.health.band,
      bandText: bandWords[position.health.band],
      priceNote: null,
      healthFactor: healthFigure(position.health.health_factor),
      ltv: wadPercentCautious(position.health.ltv, "up"),
      liquidationPrice:
        position.health.liquidation_price === null || loan === null
          ? null
          : liquidationText(
              position.health.liquidation_price,
              loan,
              collateral,
            ),
    },
  }
}

export type TroveView = {
  kind: "trove"
  owner: string
  collateral: string | null
  debt: string | null
  /** "1.00% APR" from basis points. */
  rate: string
  /** "200.2%", rounded down. */
  collateralRatio: string | null
  health: HealthView
}

const btcToken =
  knownTokens["0x7b7c000000000000000000000000000000000000"] ?? null
const musdToken = { symbol: "MUSD", decimals: 18 }

export function troveView(trove: ScanTrove): TroveView {
  const debt = (BigInt(trove.principal) + BigInt(trove.interest)).toString()
  return {
    kind: "trove",
    owner: trove.owner,
    collateral: formatTokenAmount(trove.coll, btcToken),
    debt: formatTokenAmount(debt, musdToken),
    rate: `${formatDecimal(unitsToDecimal(String(trove.interest_rate), 2), 2)}% APR`,
    collateralRatio: wadPercentCautious(trove.health.collateral_ratio, "down"),
    health: {
      estimate: trove.health_basis?.estimate === true,
      band: trove.health.band,
      bandText:
        trove.health.band === "unknown" && trove.health_basis?.stale === true
          ? "Price out of date"
          : bandWords[trove.health.band],
      priceNote: stalePriceNote(trove.health_basis),
      healthFactor: healthFigure(trove.health.health_factor),
      ltv: wadPercentCautious(trove.health.ltv, "up"),
      liquidationPrice:
        trove.health.liquidation_price === null
          ? null
          : `$${wholeUp(trove.health.liquidation_price, 18)}`,
    },
  }
}

export type EnclavePositionView = {
  kind: "enclave"
  positionId: string
  enclave: string
  /** The debt it opened with (live debt is not served yet). */
  principal: string | null
  rate: string | null
  /** "150%", "110%". */
  warningRatio: string | null
  minimumRatio: string | null
  pledged: string[]
  openedAt: number
  latestAction: string
}

export function enclavePositionView(
  positionId: string,
  latest: ScanEnclaveEventItem,
): EnclavePositionView {
  return {
    kind: "enclave",
    positionId,
    enclave: latest.enclave,
    principal:
      latest.principal === null
        ? null
        : formatTokenAmount(latest.principal, musdToken),
    rate:
      latest.interest_rate === null
        ? null
        : `${formatDecimal(unitsToDecimal(String(latest.interest_rate), 2), 2)}% APR`,
    warningRatio: wadPercent(latest.warning_cr)?.replace(".0%", "%") ?? null,
    minimumRatio: wadPercent(latest.minimum_cr)?.replace(".0%", "%") ?? null,
    pledged: latest.pledged_ve_btc,
    openedAt: latest.timestamp,
    latestAction: latest.action,
  }
}

export { bandWords }

// -- loan history -----------------------------------------------------------

const actionWords: Readonly<Record<string, string>> = {
  LOAN_OPENED: "Opened",
  LOAN_BORROWED: "Borrowed",
  LOAN_REPAID: "Repaid",
  LOAN_ADJUSTED: "Adjusted",
  LOAN_CLOSED: "Closed",
  LOAN_LIQUIDATED: "Liquidated",
  LOAN_REDEEMED: "Redeemed",
  LOAN_COLL_ADDED: "Added collateral",
  LOAN_COLL_WITHDRAWN: "Removed collateral",
  LOAN_REFINANCED: "Refinanced",
  LOAN_REWARDS_APPLIED: "Applied rewards",
  SUPPLIED: "Supplied",
  WITHDRAWN: "Withdrew",
  COLLATERAL_SUPPLIED: "Added collateral",
  COLLATERAL_WITHDRAWN: "Removed collateral",
  BORROWED: "Borrowed",
  REPAID: "Repaid",
  LIQUIDATED: "Liquidated",
  POSITION_OPENED: "Opened",
  POSITION_CLOSED: "Closed",
  DEBT_INCREASED: "Borrowed",
  DEBT_REPAID: "Repaid",
  COLLATERAL_PLEDGED: "Pledged veBTC",
  COLLATERAL_RELEASED: "Released veBTC",
  INTEREST_RATE_SET: "Set the rate",
  ORIGINATOR_FEE_RATE_SET: "Set the fee",
  CR_THRESHOLDS_SET: "Set the ratios",
  VEBTC_LOCKED: "Locked BTC in veBTC",
  VEBTC_INCREASED: "Added BTC to veBTC",
  VEBTC_MERGED: "Merged veBTC",
  VEBTC_WITHDRAWN: "Withdrew veBTC",
}

/** "Added collateral" for COLLATERAL_SUPPLIED; unknown actions in words. */
export function loanActionWords(action: string): string {
  const known = actionWords[action]
  if (known !== undefined) return known
  const words = action.toLowerCase().replace(/_/g, " ")
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

export type LoanEventView = {
  key: string
  kind: "trove" | "morpho" | "enclave"
  /** "MUSD loan", "BTC / mUSDC", "Enclave". */
  loan: string
  action: string
  /** "4,000.00 MUSD", "+0.2710 BTC collateral"; null when not given. */
  detail: string | null
  timestamp: number
  block: number
  txHash: string
}

function signedAmount(
  change: string | null,
  token: MarketToken | null,
): string | null {
  if (change === null || change === "0") return null
  const negative = change.startsWith("-")
  const text = formatTokenAmount(negative ? change.slice(1) : change, token)
  return text === null ? null : `${negative ? "-" : "+"}${text}`
}

export function troveEventView(event: {
  tx_hash: string
  log_index: number
  block_number: number
  timestamp: number
  action: string
  debt_change: string | null
  coll_change: string | null
}): LoanEventView {
  const parts = [
    signedAmount(event.debt_change, musdToken),
    signedAmount(event.coll_change, btcToken),
  ].filter((part): part is string => part !== null)
  return {
    key: `trove:${event.tx_hash}:${event.log_index}`,
    kind: "trove",
    loan: "MUSD loan",
    action: loanActionWords(event.action),
    detail: parts.length === 0 ? null : parts.join(", "),
    timestamp: event.timestamp,
    block: event.block_number,
    txHash: event.tx_hash,
  }
}

export function morphoEventView(event: {
  tx_hash: string
  log_index: number
  block_number: number
  timestamp: number
  market_id: string
  action: string
  assets: string | null
}): LoanEventView {
  const known = knownMarkets[event.market_id]
  const collateralSide = event.action.startsWith("COLLATERAL_")
  const token = collateralSide
    ? (known?.collateral ?? null)
    : (known?.loan ?? null)
  return {
    key: `morpho:${event.tx_hash}:${event.log_index}`,
    kind: "morpho",
    loan:
      known === undefined || known.loan === null || known.collateral === null
        ? "Morpho market"
        : `${known.collateral.symbol} / ${known.loan.symbol}`,
    action: loanActionWords(event.action),
    detail:
      event.assets === null ? null : formatTokenAmount(event.assets, token),
    timestamp: event.timestamp,
    block: event.block_number,
    txHash: event.tx_hash,
  }
}

/**
 * An Enclave event's amount: BTC for its veBTC lock's own events
 * (`VEBTC_*`), else MUSD (minted, repaid, the principal after).
 */
export function enclaveAmount(event: {
  action: string
  amount: string | null
  principal: string | null
}): string | null {
  if (event.action.startsWith("VEBTC_")) {
    return event.amount === null
      ? null
      : formatTokenAmount(event.amount, btcToken)
  }
  const amount = event.principal ?? event.amount
  return amount === null ? null : formatTokenAmount(amount, musdToken)
}

export function enclaveEventView(event: ScanEnclaveEventItem): LoanEventView {
  return {
    key: `enclave:${event.tx_hash}:${event.log_index}:${event.ve_btc_token_id}`,
    kind: "enclave",
    loan: "Enclave",
    action: loanActionWords(event.action),
    detail: enclaveAmount(event),
    timestamp: event.timestamp,
    block: event.block_number,
    txHash: event.tx_hash,
  }
}

// -- Borrow pages -------------------------------------------------------------

/** A 1e18 ratio as a 0 to 1 share for bars (display only, never money). */
function barShare(wad: string | null): number | null {
  const value = wadNumber(wad)
  return value === null ? null : Math.min(1, Math.max(0, value))
}

/**
 * "49.0%": basis points with one decimal, rounded down, so a drop to
 * liquidation never shows larger than it is.
 */
function bpsPercent(bps: number): string {
  const tenths = divideCautious(BigInt(Math.trunc(bps)), 10n, "down")
  return `${formatDecimal(unitsToDecimal(tenths.toString(), 1), 1)}%`
}

/** "1.00%": basis points with two decimals. */
function bpsRate(bps: number): string {
  return `${formatDecimal(unitsToDecimal(String(bps), 2), 2)}%`
}

export type MarketDetailView = MarketView & {
  loanToken: string
  collateralToken: string
  oracle: string
  irm: string
  /** Protocol fee on interest: "0%". */
  fee: string
  /** Utilization as a 0 to 1 share for the bar. */
  utilizationShare: number | null
  /**
   * What suppliers earn: the borrow rate compounded as Morpho does, times
   * utilization, less the fee (`morphoSupplyApy`): "1.7%". Null when the
   * rate or utilization is unread.
   */
  supplyApy: string | null
  /** Supplied less borrowed, in the loan token: what can be borrowed now. */
  available: string | null
  /** The liquidation incentive from the LLTV (Morpho's formula): "4.38%". */
  liquidationIncentive: string
  block: number
  updatedAt: number
}

/** A 1e18-scaled ratio as a percent with two decimals: "4.38%". */
function wadPercent2(wad: bigint): string {
  return `${formatDecimal(unitsToDecimal(wad.toString(), 16), 2)}%`
}

function supplyApyOf(market: ScanMorphoMarket): string | null {
  if (market.borrow_rate_per_second === null || market.utilization === null) {
    return null
  }
  return wadPercent(
    morphoSupplyApy({
      ratePerSecond: BigInt(market.borrow_rate_per_second),
      utilization: BigInt(market.utilization),
      fee: BigInt(market.fee),
    }).toString(),
  )
}

function availableOf(market: ScanMorphoMarket): string | null {
  const left =
    BigInt(market.total_supply_assets) - BigInt(market.total_borrow_assets)
  return formatTokenAmount(
    (left > 0n ? left : 0n).toString(),
    marketTokens(market).loan,
  )
}

export function marketDetailView(market: ScanMorphoMarket): MarketDetailView {
  return {
    ...marketView(market),
    loanToken: market.loan_token,
    collateralToken: market.collateral_token,
    oracle: market.oracle,
    irm: market.irm,
    fee: wadPercent(market.fee)?.replace(".0%", "%") ?? "",
    utilizationShare: barShare(market.utilization),
    supplyApy: supplyApyOf(market),
    available: availableOf(market),
    liquidationIncentive: wadPercent2(
      morphoLiquidationIncentiveFactor(BigInt(market.lltv)) - 10n ** 18n,
    ),
    block: market.block,
    updatedAt: market.updated_at,
  }
}

export type MorphoRowView = MorphoPositionView & {
  loanSymbol: string | null
  collateralSymbol: string | null
  /** The market's LLTV: "86%". */
  lltv: string | null
  /** LTV and LLTV as 0 to 1 shares for the health bar. */
  ltvShare: number | null
  lltvShare: number | null
  /** "49.0% below BTC": how far the oracle price sits above liquidation. */
  drop: string | null
  /** The market's borrow rate: "5.2%". */
  borrowApr: string | null
  /** Holds debt, collateral or a supply (a lender's position is open). */
  open: boolean
  /**
   * Its debt over the market's total borrowed: "96.5% of debt". Set on
   * the market page only, where every row is the same market.
   */
  debtShare: string | null
  block: number
  updatedAt: number
}

/**
 * A Morpho position with its market. The drop to liquidation compares the
 * API's oracle price and liquidation price (both in oracle units) with the
 * domain helper; nothing else is derived here.
 */
export function morphoRowView(
  position: ScanMorphoPosition,
  market: ScanMorphoMarket | null,
): MorphoRowView {
  const known = market === null ? null : marketView(market)
  const base = morphoPositionView(position, known)
  const fallback = knownMarkets[position.market_id]
  const loan = known?.loan ?? fallback?.loan ?? null
  const collateral = known?.collateral ?? fallback?.collateral ?? null
  const price = market?.oracle_price ?? null
  const liquidation = position.health.liquidation_price
  const bps =
    price === null || liquidation === null
      ? 0
      : dropToLiquidationBps(BigInt(price), BigInt(liquidation))
  return {
    ...base,
    loanSymbol: loan?.symbol ?? null,
    collateralSymbol: collateral?.symbol ?? null,
    lltv: known?.lltv ?? null,
    ltvShare: barShare(position.health.ltv),
    lltvShare: market === null ? null : barShare(market.lltv),
    drop: bps > 0 ? `${bpsPercent(bps)} below BTC` : null,
    borrowApr: known?.borrowApr ?? null,
    open:
      position.borrow_assets !== "0" ||
      position.collateral !== "0" ||
      position.supply_assets !== "0",
    debtShare: null,
    block: position.block,
    updatedAt: position.updated_at,
  }
}

function compareWads(left: string | null, right: string | null): number {
  if (left === null || right === null) {
    return left === right ? 0 : left === null ? 1 : -1
  }
  const difference = BigInt(left) - BigInt(right)
  return difference === 0n ? 0 : difference < 0n ? -1 : 1
}

/**
 * Where a loan ranks by risk: debt nobody can price (`unknown`: no oracle
 * or protocol price) first, since it could be anywhere up to liquidation,
 * then by the figure, then no debt.
 */
function riskRank(health: { band: HealthBand }): number {
  return health.band === "unknown" ? 0 : 1
}

/**
 * Positions closest to liquidation first: unpriced debt, then by health
 * factor (no debt last).
 */
export function byHealth(
  a: { health: { health_factor: string | null; band: HealthBand } },
  b: { health: { health_factor: string | null; band: HealthBand } },
): number {
  return (
    riskRank(a.health) - riskRank(b.health) ||
    compareWads(a.health.health_factor, b.health.health_factor)
  )
}

/** Largest debt first. */
export function byDebt(a: ScanMorphoPosition, b: ScanMorphoPosition): number {
  return -compareWads(a.borrow_assets, b.borrow_assets)
}

/**
 * Troves, unpriced debt first, then lowest collateral ratio (no debt
 * last).
 */
export function byCollateralRatio(a: ScanTrove, b: ScanTrove): number {
  return (
    riskRank(a.health) - riskRank(b.health) ||
    compareWads(a.health.collateral_ratio, b.health.collateral_ratio)
  )
}

const troveStatusWords: Readonly<Record<string, string>> = {
  active: "Active",
  closedbyowner: "Closed",
  closedbyliquidation: "Liquidated",
  closedbyredemption: "Redeemed",
  nonexistent: "Closed",
}

export type TroveRowView = TroveView & {
  /** "Active", "Closed", "Liquidated". */
  status: string
  open: boolean
  principal: string | null
  interest: string | null
  ltvShare: number | null
  block: number
  updatedAt: number
}

export function troveRowView(trove: ScanTrove): TroveRowView {
  const key = trove.status.replace(/[^a-z]/gi, "").toLowerCase()
  return {
    ...troveView(trove),
    status: troveStatusWords[key] ?? loanActionWords(trove.status),
    open: key === "active",
    principal: formatTokenAmount(trove.principal, musdToken),
    interest: formatTokenAmount(trove.interest, musdToken),
    ltvShare: barShare(trove.health.ltv),
    block: trove.block,
    updatedAt: trove.updated_at,
  }
}

/** One line of a loan's history or a market's activity, in words. */
export type HistoryView = {
  key: string
  /** "Sun 8 Nov". */
  day: string
  /** "Added 0.2416 BTC". */
  title: string
  /** "Collateral", "+4,000.00 MUSD". */
  subline: string | null
  /** The coin for the row's icon. */
  coin: string | null
  /** Whose position moved. */
  account: string | null
  txHash: string
}

type MorphoEvent = {
  tx_hash: string
  log_index: number
  block_number: number
  timestamp: number
  market_id: string
  action: string
  on_behalf: string | null
  assets: string | null
  seized_assets: string | null
}

const morphoVerbs: Readonly<
  Record<string, { verb: string; side: "loan" | "collateral"; part: string }>
> = {
  SUPPLIED: { verb: "Supplied", side: "loan", part: "Supply" },
  WITHDRAWN: { verb: "Withdrew", side: "loan", part: "Supply" },
  COLLATERAL_SUPPLIED: {
    verb: "Added",
    side: "collateral",
    part: "Collateral",
  },
  COLLATERAL_WITHDRAWN: {
    verb: "Withdrew",
    side: "collateral",
    part: "Collateral",
  },
  BORROWED: { verb: "Borrowed", side: "loan", part: "Debt" },
  REPAID: { verb: "Repaid", side: "loan", part: "Debt" },
}

/**
 * A market's activity without the interest bookkeeping. Morpho accrues a
 * market's interest (an AccrueInterest log) before every supply, borrow,
 * repay, withdrawal and liquidation, so each action came with an "Interest
 * accrued" row of its own. That row is folded into the action of the same
 * transaction; an accrual nobody acted beside (a bare `accrueInterest`
 * call) stays, so the list still shows every transaction.
 */
export function foldInterest<Event extends { tx_hash: string; action: string }>(
  events: readonly Event[],
): Event[] {
  const acted = new Set(
    events
      .filter((event) => event.action !== "INTEREST_ACCRUED")
      .map((event) => event.tx_hash),
  )
  return events.filter(
    (event) => event.action !== "INTEREST_ACCRUED" || !acted.has(event.tx_hash),
  )
}

export type MorphoMove = {
  /** "Added", "Borrowed", "Liquidated". */
  verb: string
  /** "Collateral", "Debt", "Supply"; null for a liquidation. */
  part: string | null
  /** The amount moved in its token ("0.2416 BTC"), by the market's decimals. */
  amount: string | null
  /** A liquidation's collateral seized and debt repaid. */
  seized: string | null
  repaid: string | null
  coin: string | null
}

/**
 * What a Morpho event moved, by the market's own decimals (the market
 * answer; without it, a configured market by the token registry).
 */
export function morphoMove(
  event: Pick<MorphoEvent, "market_id" | "action" | "assets" | "seized_assets">,
  market: ScanMorphoMarket | null,
): MorphoMove {
  const sides =
    market === null
      ? (knownMarkets[event.market_id] ?? null)
      : marketTokens(market)
  const loan = sides?.loan ?? null
  const collateral = sides?.collateral ?? null
  if (event.action === "LIQUIDATED") {
    return {
      verb: "Liquidated",
      part: null,
      amount: null,
      seized:
        event.seized_assets === null
          ? null
          : formatTokenAmount(event.seized_assets, collateral),
      repaid:
        event.assets === null ? null : formatTokenAmount(event.assets, loan),
      coin: collateral?.symbol ?? null,
    }
  }
  const verb = morphoVerbs[event.action]
  const token =
    verb === undefined ? loan : verb.side === "collateral" ? collateral : loan
  return {
    verb: verb?.verb ?? loanActionWords(event.action),
    part: verb?.part ?? null,
    amount:
      event.assets === null ? null : formatTokenAmount(event.assets, token),
    seized: null,
    repaid: null,
    coin: token?.symbol ?? null,
  }
}

export function morphoHistoryView(
  event: MorphoEvent,
  market: ScanMorphoMarket | null,
): HistoryView {
  // The market answer carries its decimals; without it, a configured
  // market by the token registry.
  const sides =
    market === null
      ? (knownMarkets[event.market_id] ?? null)
      : marketTokens(market)
  const loan = sides?.loan ?? null
  const collateral = sides?.collateral ?? null
  const base = {
    key: `morpho:${event.tx_hash}:${event.log_index}`,
    day: formatDay(event.timestamp),
    account: event.on_behalf,
    txHash: event.tx_hash,
  }
  if (event.action === "LIQUIDATED") {
    const seized =
      event.seized_assets === null
        ? null
        : formatTokenAmount(event.seized_assets, collateral)
    const repaid =
      event.assets === null ? null : formatTokenAmount(event.assets, loan)
    const parts = [
      seized === null ? null : `Seized ${seized}`,
      repaid === null ? null : `repaid ${repaid}`,
    ].filter((part): part is string => part !== null)
    return {
      ...base,
      title: "Liquidated",
      subline: parts.length === 0 ? null : parts.join(", "),
      coin: collateral?.symbol ?? null,
    }
  }
  const verb = morphoVerbs[event.action]
  const token =
    verb === undefined ? loan : verb.side === "collateral" ? collateral : loan
  const amount =
    event.assets === null ? null : formatTokenAmount(event.assets, token)
  const words = verb?.verb ?? loanActionWords(event.action)
  return {
    ...base,
    title: amount === null ? words : `${words} ${amount}`,
    subline: verb?.part ?? null,
    coin: token?.symbol ?? null,
  }
}

export function troveHistoryView(event: {
  tx_hash: string
  log_index: number
  block_number: number
  timestamp: number
  borrower: string
  action: string
  debt_change: string | null
  coll_change: string | null
}): HistoryView {
  const view = troveEventView(event)
  const debtMoved = event.debt_change !== null && event.debt_change !== "0"
  const collMoved = event.coll_change !== null && event.coll_change !== "0"
  return {
    key: view.key,
    day: formatDay(event.timestamp),
    title: view.action,
    subline: view.detail,
    coin: !debtMoved && collMoved ? "BTC" : "MUSD",
    account: event.borrower,
    txHash: event.tx_hash,
  }
}

export function enclaveHistoryView(event: ScanEnclaveEventItem): HistoryView {
  const view = enclaveEventView(event)
  const rate =
    event.interest_rate === null ? null : `${bpsRate(event.interest_rate)} APR`
  const parts = [view.detail, rate].filter(
    (part): part is string => part !== null,
  )
  return {
    key: view.key,
    day: formatDay(event.timestamp),
    title: view.action,
    subline: parts.length === 0 ? null : parts.join(", "),
    coin: view.detail === null ? null : "MUSD",
    account: event.borrower,
    txHash: event.tx_hash,
  }
}

export type EnclavePageView = EnclavePositionView & {
  /** False once its latest event closed it. */
  open: boolean
  borrower: string | null
  /** "0.00%": the originator fee from basis points. */
  originatorFee: string | null
  openedBlock: number
  latestTx: string
}

/** An Enclave position from its events, newest first. */
export function enclavePageView(
  positionId: string,
  events: readonly ScanEnclaveEventItem[],
): EnclavePageView | null {
  const latest = events[0]
  if (latest === undefined) return null
  const opened =
    events.find((event) => event.action === "POSITION_OPENED") ??
    events.at(-1) ??
    latest
  const terms = events.find((event) => event.principal !== null) ?? latest
  return {
    ...enclavePositionView(positionId, terms),
    latestAction: loanActionWords(latest.action),
    open: latest.action !== "POSITION_CLOSED",
    openedAt: opened.timestamp,
    borrower: latest.borrower ?? opened.borrower,
    originatorFee:
      terms.originator_fee_rate === null
        ? null
        : bpsRate(terms.originator_fee_rate),
    openedBlock: opened.block_number,
    latestTx: latest.tx_hash,
  }
}

// -- Enclave lists and the Borrowed figure ------------------------------------

/** "0x1473…d786" for a hash id, "#12" for a numbered one. */
export function shortPositionId(id: string): string {
  return id.startsWith("0x") ? shortHash(id) : `#${id}`
}

/** Base units of MUSD as a whole figure: "723,361 MUSD". */
export function wholeMusd(units: string, decimals: number): string {
  return `${formatDecimal(unitsToDecimal(units, decimals), 0)} MUSD`
}

export type BorrowedView = {
  /**
   * MUSD owed across troves, Enclaves and MUSD markets, whole: "723,361
   * MUSD". Null when a venue could not be read: never a partial sum.
   */
  total: string | null
  /** "3.5% in Enclaves". */
  enclavesShare: string | null
  /** Open Enclave positions, null when the Enclave venue is unavailable. */
  enclaves: { open: number; positions: number } | null
  /** Open troves' principal plus interest: "57,360.75 MUSD". */
  troveDebt: string | null
}

/** `/borrow/totals` as the Borrow tiles draw it: MUSD, never dollars. */
export function borrowedView(totals: ScanBorrowTotals): BorrowedView {
  const { unit, venues } = totals
  const token = { symbol: unit.symbol, decimals: unit.decimals }
  return {
    total:
      totals.total === null ? null : wholeMusd(totals.total, unit.decimals),
    enclavesShare:
      totals.enclaves_share === null
        ? null
        : // 1e18 is 100%: a percent is the fraction with 16 decimals.
          `${formatDecimal(unitsToDecimal(totals.enclaves_share, 16), 1)}% in Enclaves`,
    enclaves:
      venues.enclaves.status === "ok"
        ? {
            open: venues.enclaves.data.open,
            positions: venues.enclaves.data.positions,
          }
        : null,
    troveDebt:
      venues.troves.status === "ok"
        ? formatTokenAmount(venues.troves.data.debt, token)
        : null,
  }
}

export type EnclaveRowView = {
  positionId: string
  /** "0x1473…d786" or "#12". */
  short: string
  enclave: string
  borrower: string | null
  open: boolean
  /** "Active" or "Closed". */
  status: string
  /**
   * Principal after the latest event: "25,000.00 MUSD". Interest accrues
   * on chain with no event, so this is not the live debt.
   */
  principal: string | null
  /** Opened with plus every increase, and repaid; null when not whole. */
  minted: string | null
  repaid: string | null
  /** veBTC token ids pledged now (none once closed). */
  pledged: string[]
  /** Every veBTC the position has pledged. */
  tokens: string[]
  openedAt: number | null
  latestAt: number
  latestBlock: number
  /** "Repaid", "Opened". */
  latestAction: string
  latestTx: string
}

export function enclaveRowView(
  summary: ScanEnclavePositionSummary,
): EnclaveRowView {
  const amount = (units: string | null) =>
    units === null ? null : formatTokenAmount(units, musdToken)
  return {
    positionId: summary.position_id,
    short: shortPositionId(summary.position_id),
    enclave: summary.enclave,
    borrower: summary.borrower,
    open: summary.status === "open",
    status: summary.status === "open" ? "Active" : "Closed",
    principal: amount(summary.principal),
    minted: amount(summary.minted),
    repaid: amount(summary.repaid),
    pledged: summary.pledged_ve_btc,
    tokens: summary.ve_btc_token_ids,
    openedAt: summary.opened?.timestamp ?? null,
    latestAt: summary.latest.timestamp,
    latestBlock: summary.latest.block_number,
    latestAction: loanActionWords(summary.latest.action),
    latestTx: summary.latest.tx_hash,
  }
}

/** Open positions first, then the most recently changed. */
export function byOpenThenLatest(
  a: ScanEnclavePositionSummary,
  b: ScanEnclavePositionSummary,
): number {
  const open = (each: ScanEnclavePositionSummary) =>
    each.status === "open" ? 0 : 1
  return (
    open(a) - open(b) ||
    b.latest.block_number - a.latest.block_number ||
    (a.position_id < b.position_id ? -1 : 1)
  )
}

/** The Enclave position a veBTC lock backs, or last backed. */
export type LockEnclaveView = EnclaveRowView & {
  /** The lock is pledged to the position now (it is open). */
  backing: boolean
}

/**
 * A veBTC's Enclave position from `/borrow/enclave/locks/{id}` (newest
 * first): the newest one, or null when the lock was never pledged.
 */
export function lockEnclaveView(
  tokenId: string,
  positions: readonly ScanEnclavePositionSummary[],
): LockEnclaveView | null {
  const latest = positions[0]
  if (latest === undefined) return null
  return {
    ...enclaveRowView(latest),
    backing:
      latest.status === "open" && latest.pledged_ve_btc.includes(tokenId),
  }
}

/**
 * A position's debt as a share of its market's total borrowed: "96.5% of
 * debt", "<0.1% of debt"; null with no debt or nothing borrowed.
 */
export function debtShareOf(
  position: ScanMorphoPosition,
  market: ScanMorphoMarket,
): string | null {
  const debt = BigInt(position.borrow_assets)
  const total = BigInt(market.total_borrow_assets)
  if (debt === 0n || total === 0n) return null
  const share = (debt * 10n ** 18n) / total
  // Below a twentieth of a percent, one decimal would round to 0.0%.
  if (share < 5n * 10n ** 14n) return "<0.1% of debt"
  return `${wadPercent(share.toString())} of debt`
}
