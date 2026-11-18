import type {
  ScanBorrowTotalsResponse,
  ScanEnclaveEventItem,
  ScanEnclavePositionSummary,
  ScanMorphoMarket,
  ScanMorphoPosition,
  ScanTrove,
} from "@matchbox/contracts/scan"
import {
  epochStart,
  type FixtureRoute,
  type FixtureScenario,
  fakeAddress,
  fakeHash,
  fixtureNow,
  musdToken,
  ok,
  pageAnswer,
  units,
} from "./shared"
import {
  enclave,
  enclavePositionId,
  markets,
  otherVoter,
  tokens,
  wallet,
} from "./world"

/**
 * `/borrow/*` as the API answers it: two Morpho Blue markets, troves, an
 * Enclave position and their histories. Health figures are 1e18-scaled
 * strings computed here once with bigint, as the API computes them at read
 * time (apps/api src/scan/borrow-math.ts); the pages only format them.
 */

const wad = 10n ** 18n
const btcUsd = 74_000n
const block = 13_118_000
const updated = fixtureNow - 120

/** USD per BTC in Morpho's oracle scale for a loan token of `decimals`. */
function oraclePrice(loanDecimals: number): bigint {
  return (btcUsd * 10n ** BigInt(loanDecimals) * 10n ** 36n) / wad
}

type Health = ScanMorphoPosition["health"]

function morphoHealth(
  collateral: bigint,
  debt: bigint,
  lltv: bigint,
  price: bigint,
): Health {
  if (debt === 0n) {
    return {
      ltv: null,
      health_factor: null,
      liquidation_price: null,
      band: "no_debt",
    }
  }
  const value = (collateral * price) / 10n ** 36n
  const healthFactor = (value * lltv) / debt
  return {
    ltv: ((debt * wad) / value).toString(),
    health_factor: healthFactor.toString(),
    liquidation_price: (
      (debt * 10n ** 36n * wad) /
      (collateral * lltv)
    ).toString(),
    band:
      healthFactor < wad
        ? "liquidatable"
        : healthFactor < (wad * 11n) / 10n
          ? "near_liquidation"
          : "healthy",
  }
}

function market(
  id: string,
  loan: string,
  loanDecimals: number,
  supply: string,
  borrow: string,
  ratePerYear: string,
): ScanMorphoMarket {
  const supplied = BigInt(units(supply, loanDecimals))
  const borrowed = BigInt(units(borrow, loanDecimals))
  return {
    market_id: id,
    loan_token: loan,
    collateral_token: tokens.btc,
    oracle: fakeAddress(`0c${id.slice(2, 8)}`),
    irm: fakeAddress("1e3"),
    lltv: units("0.86"),
    total_supply_assets: supplied.toString(),
    total_supply_shares: (supplied * 1_000_000n).toString(),
    total_borrow_assets: borrowed.toString(),
    total_borrow_shares: (borrowed * 1_000_000n).toString(),
    fee: "0",
    utilization: ((borrowed * wad) / supplied).toString(),
    borrow_rate_per_second: (
      BigInt(units(ratePerYear)) / 31_536_000n
    ).toString(),
    oracle_price: oraclePrice(loanDecimals).toString(),
    // As the API from b07ccde: read on chain when the market was found.
    loan_decimals: loanDecimals,
    collateral_decimals: 18,
    block,
    updated_at: updated,
  }
}

export const marketList: ScanMorphoMarket[] = [
  market(markets.btcMusdc, tokens.musdc, 6, "2500000", "1800000", "0.052"),
  market(markets.btcMusd, tokens.musd, 18, "1200000", "640000", "0.047"),
  // Discovered on chain: in no configured list, so only the market list
  // names it and carries its decimals. One borrower so far.
  {
    ...market(markets.discovered, tokens.musd, 18, "5000", "1000", "0.050"),
    block: 13_118_800,
  },
]

function position(
  owning: ScanMorphoMarket,
  account: string,
  collateral: string,
  borrow: string,
  loanDecimals: number,
): ScanMorphoPosition {
  const coll = BigInt(units(collateral))
  const debt = BigInt(units(borrow, loanDecimals))
  return {
    market_id: owning.market_id,
    account,
    supply_shares: "0",
    supply_assets: "0",
    borrow_shares: (debt * 1_000_000n).toString(),
    borrow_assets: debt.toString(),
    collateral: coll.toString(),
    health: morphoHealth(
      coll,
      debt,
      BigInt(owning.lltv),
      BigInt(owning.oracle_price ?? "0"),
    ),
    block,
    updated_at: updated,
  }
}

const [musdcMarket, musdMarket, discoveredMarket] = marketList as [
  ScanMorphoMarket,
  ScanMorphoMarket,
  ScanMorphoMarket,
]

/** An account that only supplies to a Morpho market. */
export const morphoSupplier = fakeAddress("b0ee4f61")

export const morphoPositions: ScanMorphoPosition[] = [
  position(musdcMarket, wallet, "1.3040", "60486.22", 6),
  position(musdcMarket, otherVoter, "4.2000", "198000", 6),
  position(musdMarket, otherVoter, "2.0000", "121000", 18),
  // The wallet's loan in the discovered market: the address page names it
  // and sizes it from the market list, not from a configured market.
  position(discoveredMarket, wallet, "0.0500", "1000", 18),
  // A lender in the mUSDC market: supply only, no debt and no collateral.
  // Not a borrow position, so the Positions tab leaves it out.
  {
    ...position(musdcMarket, morphoSupplier, "0", "0", 6),
    supply_shares: (BigInt(units("5000", 6)) * 1_000_000n).toString(),
    supply_assets: units("5000", 6),
  },
]

function trove(
  owner: string,
  coll: string,
  principal: string,
  interest: string,
): ScanTrove {
  const collateral = BigInt(units(coll))
  const debt = BigInt(units(principal)) + BigInt(units(interest))
  const value = collateral * btcUsd
  const ratio = (value * wad) / debt
  const healthFactor = (ratio * 10n) / 11n
  return {
    owner,
    status: "active",
    coll: collateral.toString(),
    principal: units(principal),
    interest: units(interest),
    interest_rate: 100,
    health: {
      collateral_ratio: ratio.toString(),
      ltv: ((debt * wad) / value).toString(),
      health_factor: healthFactor.toString(),
      liquidation_price: ((debt * 11n * wad) / (collateral * 10n)).toString(),
      band:
        healthFactor < wad
          ? "liquidatable"
          : healthFactor < (wad * 15n) / 11n
            ? "near_liquidation"
            : "healthy",
    },
    // Valued at the market BTC price, not MUSD's own price feed: the API
    // says so, and pages label the figures as an estimate.
    health_basis: {
      source: "market",
      btc_usd: btcUsd.toString(),
      estimate: true,
      block,
      stale: false,
      lag_blocks: 0,
    },
    block,
    updated_at: updated,
  }
}

export const troves: ScanTrove[] = [
  trove(wallet, "0.2710", "10000", "12.50"),
  trove(otherVoter, "0.5931", "38304.95", "40.10"),
  trove(fakeAddress("a7f5f738"), "0.1500", "9000", "3.20"),
]

let eventSeq = 0
const eventBase = (timestamp: number, from: string) => {
  eventSeq += 1
  return {
    tx_hash: fakeHash(`b${eventSeq.toString(16)}`),
    log_index: 0,
    block_number: 12_400_000 + eventSeq * 3_000,
    timestamp,
    tx_from: from,
  }
}

export const troveEvents = [
  {
    ...eventBase(epochStart(46) + 7_200, wallet),
    contract_address: fakeAddress("44b1bac6"),
    emitter: "BORROWER_OPERATIONS" as const,
    borrower: wallet,
    operation: 2,
    action: "LOAN_BORROWED",
    principal: units("10000"),
    interest: units("12.50"),
    coll: units("0.2710"),
    stake: units("0.2710"),
    interest_rate: 100,
    prev_principal: units("6000"),
    prev_interest: units("8.10"),
    prev_coll: units("0.2710"),
    accrued_interest: units("4.40"),
    debt_change: units("4000"),
    coll_change: "0",
  },
  {
    ...eventBase(epochStart(41) + 3_600, wallet),
    contract_address: fakeAddress("44b1bac6"),
    emitter: "BORROWER_OPERATIONS" as const,
    borrower: wallet,
    operation: 0,
    action: "LOAN_OPENED",
    principal: units("6000"),
    interest: "0",
    coll: units("0.2710"),
    stake: units("0.2710"),
    interest_rate: 100,
    prev_principal: null,
    prev_interest: null,
    prev_coll: null,
    accrued_interest: null,
    debt_change: units("6000"),
    coll_change: units("0.2710"),
  },
  {
    ...eventBase(epochStart(45) + 50_000, otherVoter),
    contract_address: fakeAddress("94afb503"),
    emitter: "TROVE_MANAGER" as const,
    borrower: fakeAddress("1a1a"),
    operation: 3,
    action: "LOAN_LIQUIDATED",
    principal: "0",
    interest: "0",
    coll: "0",
    stake: "0",
    interest_rate: 100,
    prev_principal: units("2189"),
    prev_interest: units("3.30"),
    prev_coll: units("0.0310"),
    accrued_interest: null,
    debt_change: `-${units("2192.30")}`,
    coll_change: `-${units("0.0310")}`,
  },
]

/** The account whose Morpho position the fixtures liquidate. */
export const morphoLiquidated = fakeAddress("2b2b")

/** The account the fixtures liquidate in the discovered market. */
export const morphoDiscoveredLiquidated = fakeAddress("3c3c")

const morphoEvent = (
  timestamp: number,
  account: string,
  marketId: string,
  action: string,
  assets: string,
) => ({
  ...eventBase(timestamp, account),
  market_id: marketId,
  action,
  caller: account,
  on_behalf: account,
  receiver: account,
  assets,
  shares: (BigInt(assets) * 1_000_000n).toString(),
  seized_assets: null,
  bad_debt_assets: null,
  bad_debt_shares: null,
  prev_borrow_rate: null,
  fee_shares: null,
  fee: null,
})

export const morphoEvents = [
  morphoEvent(
    epochStart(47) + 20_000,
    wallet,
    markets.btcMusdc,
    "COLLATERAL_SUPPLIED",
    units("0.2416"),
  ),
  morphoEvent(
    epochStart(45) + 10_000,
    wallet,
    markets.btcMusdc,
    "BORROWED",
    units("60486.22", 6),
  ),
  morphoEvent(
    epochStart(45) + 9_000,
    wallet,
    markets.btcMusdc,
    "COLLATERAL_SUPPLIED",
    units("1.0624"),
  ),
  morphoEvent(
    epochStart(44) + 9_000,
    otherVoter,
    markets.btcMusd,
    "BORROWED",
    units("121000"),
  ),
  // A Morpho liquidation, older than the trove liquidation (a lower block),
  // so the merged list orders them by (block, log) as the API does.
  {
    ...morphoEvent(
      epochStart(44) + 30_000,
      morphoLiquidated,
      markets.btcMusd,
      "LIQUIDATED",
      units("2000"),
    ),
    block_number: 12_401_500,
    caller: fakeAddress("11c0"),
    seized_assets: units("0.0310"),
  },
  // A liquidation in the discovered market: named and sized only from the
  // market list. The oldest liquidation, so the lists' order is unchanged.
  {
    ...morphoEvent(
      epochStart(44) + 20_000,
      morphoDiscoveredLiquidated,
      markets.discovered,
      "LIQUIDATED",
      units("500"),
    ),
    block_number: 12_401_000,
    caller: fakeAddress("11c0"),
    seized_assets: units("0.0080"),
  },
]

/** An Enclave position that is closed (its latest event closed it). */
export const closedEnclavePositionId = fakeHash("e7c1c105ed")

export const enclaveEvents: ScanEnclaveEventItem[] = [
  {
    ...eventBase(epochStart(43) + 3_000, wallet),
    ve_btc_token_id: "604",
    contract_address: fakeAddress("2c5e389a"),
    enclave,
    position_id: enclavePositionId,
    borrower: wallet,
    action: "POSITION_OPENED",
    // An opening's amount is the MUSD minted (the indexer's debtAmount).
    amount: units("25000"),
    principal: units("25000"),
    interest_rate: 100,
    originator_fee_rate: 0,
    warning_cr: units("1.5"),
    minimum_cr: units("1.1"),
    lock_duration: null,
    other_ve_btc_token_id: null,
    pledged_ve_btc: ["604"],
  },
  // A position another borrower opened, repaid and closed: its latest
  // event is POSITION_CLOSED (newest first, as the API lists them).
  ...(["POSITION_CLOSED", "DEBT_REPAID", "POSITION_OPENED"] as const).map(
    (action, index): ScanEnclaveEventItem => ({
      ...eventBase(epochStart(42) + 3_000 - index * 1_000, otherVoter),
      block_number: 12_390_000 - index * 1_000,
      ve_btc_token_id: "605",
      contract_address: fakeAddress("2c5e389a"),
      enclave,
      position_id: closedEnclavePositionId,
      borrower: otherVoter,
      action,
      amount: action === "POSITION_CLOSED" ? null : units("8000"),
      // Every row of a position carries its principal after the event.
      principal: action === "POSITION_OPENED" ? units("8000") : "0",
      interest_rate: action === "POSITION_OPENED" ? 100 : null,
      originator_fee_rate: action === "POSITION_OPENED" ? 0 : null,
      warning_cr: action === "POSITION_OPENED" ? units("1.5") : null,
      minimum_cr: action === "POSITION_OPENED" ? units("1.1") : null,
      lock_duration: null,
      other_ve_btc_token_id: null,
      pledged_ve_btc: action === "POSITION_CLOSED" ? [] : ["605"],
    }),
  ),
]

export function borrowPositionsOf(owner: string) {
  const enclaveLatest = new Map<string, ScanEnclaveEventItem>()
  for (const event of enclaveEvents) {
    if (event.borrower === owner && event.position_id !== null) {
      if (!enclaveLatest.has(event.position_id)) {
        enclaveLatest.set(event.position_id, event)
      }
    }
  }
  return {
    owner,
    morpho: morphoPositions.filter((each) => each.account === owner),
    trove: troves.find((each) => each.owner === owner) ?? null,
    enclave: [...enclaveLatest].map(([position_id, latest]) => ({
      position_id,
      latest,
    })),
    btc_usd: btcUsd.toString(),
  }
}

/**
 * An Enclave position summed from its events (newest first), as
 * `/borrow/enclave/positions` sums it (apps/api src/scan/enclaves.ts).
 */
function enclaveSummaryOf(
  positionId: string,
  events: readonly ScanEnclaveEventItem[],
): ScanEnclavePositionSummary | null {
  const latest = events[0]
  if (latest === undefined) return null
  const closed = latest.action === "POSITION_CLOSED"
  const sum = (action: string) =>
    events
      .filter((each) => each.action === action)
      .reduce((total, each) => total + BigInt(each.amount ?? "0"), 0n)
  const opened =
    [...events].reverse().find((each) => each.action === "POSITION_OPENED") ??
    null
  const tokens = new Set(
    events.flatMap((each) => [each.ve_btc_token_id, ...each.pledged_ve_btc]),
  )
  return {
    position_id: positionId,
    enclave: latest.enclave,
    borrower: latest.borrower,
    status: closed ? "closed" : "open",
    principal: closed
      ? "0"
      : (events.find((each) => each.principal !== null)?.principal ?? null),
    minted: (sum("POSITION_OPENED") + sum("DEBT_INCREASED")).toString(),
    repaid: sum("DEBT_REPAID").toString(),
    pledged_ve_btc: closed ? [] : latest.pledged_ve_btc,
    ve_btc_token_ids: [...tokens].sort((a, b) =>
      BigInt(a) < BigInt(b) ? -1 : 1,
    ),
    opened:
      opened === null
        ? null
        : {
            block_number: opened.block_number,
            timestamp: opened.timestamp,
            tx_hash: opened.tx_hash,
          },
    latest: {
      block_number: latest.block_number,
      timestamp: latest.timestamp,
      tx_hash: latest.tx_hash,
      action: latest.action,
    },
    complete: true,
  }
}

/** Every Enclave position, in position id order as the API pages them. */
export const enclaveSummaries: ScanEnclavePositionSummary[] = [
  ...new Set(
    enclaveEvents.flatMap((each) =>
      each.position_id === null ? [] : [each.position_id],
    ),
  ),
]
  .sort()
  .flatMap((id) => {
    const summary = enclaveSummaryOf(
      id,
      enclaveEvents.filter((each) => each.position_id === id),
    )
    return summary === null ? [] : [summary]
  })

/** The positions a veBTC was pledged to, newest first. */
export function enclaveLockOf(tokenId: string) {
  return {
    token_id: tokenId,
    positions: enclaveSummaries
      .filter((each) => each.ve_btc_token_ids.includes(tokenId))
      .sort((a, b) => b.latest.block_number - a.latest.block_number),
  }
}

const e18 = 10n ** 18n

/**
 * `/borrow/totals` from the fixtures' open troves, open Enclave principal
 * and the markets that lend MUSD (mUSDC is excluded, never priced). The
 * history repeats today's venues back 30 days. `filling` plays an Enclave
 * read that stopped short: no total, never a smaller one.
 */
export function borrowTotals(
  scenario: FixtureScenario,
): Omit<ScanBorrowTotalsResponse, "snapshot"> {
  const open = troves.filter((each) => each.status === "active")
  const principal = open.reduce((sum, each) => sum + BigInt(each.principal), 0n)
  const interest = open.reduce((sum, each) => sum + BigInt(each.interest), 0n)
  const troveDebt = principal + interest
  const openEnclaves = enclaveSummaries.filter((each) => each.status === "open")
  const enclaveDebt = openEnclaves.reduce(
    (sum, each) => sum + BigInt(each.principal ?? "0"),
    0n,
  )
  const lending = marketList.map((each) => ({
    market_id: each.market_id,
    loan_token: each.loan_token,
    borrowed: each.total_borrow_assets,
    loan_decimals: each.loan_decimals ?? null,
  }))
  const included = lending.filter((each) => each.loan_token === musdToken)
  const marketDebt = included.reduce(
    (sum, each) => sum + BigInt(each.borrowed),
    0n,
  )
  const total = troveDebt + enclaveDebt + marketDebt
  // BTC behind the loans: the open troves' collateral, 2.5 BTC of veBTC
  // pledged to the open Enclave positions, and the positions in markets
  // whose collateral is BTC.
  const btcToken = "0x7b7c000000000000000000000000000000000000"
  const troveColl = open.reduce((sum, each) => sum + BigInt(each.coll), 0n)
  const enclaveColl = (25n * e18) / 10n
  // Only the MUSD markets Borrowed counts.
  const musdMarkets = new Set(
    marketList
      .filter((each) => each.loan_token === musdToken)
      .map((each) => each.market_id),
  )
  const btcMarkets = new Set(
    marketList
      .filter(
        (each) =>
          musdMarkets.has(each.market_id) && each.collateral_token === btcToken,
      )
      .map((each) => each.market_id),
  )
  const marketColl = morphoPositions
    .filter((each) => btcMarkets.has(each.market_id))
    .reduce((sum, each) => sum + BigInt(each.collateral), 0n)
  const owing = morphoPositions.filter(
    (each) => musdMarkets.has(each.market_id) && each.borrow_assets !== "0",
  ).length
  const newest = [...enclaveSummaries].sort(
    (a, b) => b.latest.block_number - a.latest.block_number,
  )[0]
  const today = fixtureNow * 1000
  const days = Array.from({ length: 30 }, (_, index) =>
    new Date(today - (29 - index) * 86_400_000).toISOString().slice(0, 10),
  )
  const whole = scenario !== "filling"
  return {
    data: {
      unit: { symbol: "MUSD", token: musdToken, decimals: 18 },
      total: whole ? total.toString() : null,
      missing: whole ? [] : ["enclaves"],
      enclaves_share: whole ? ((enclaveDebt * e18) / total).toString() : null,
      venues: {
        troves: {
          status: "ok",
          data: {
            basis: "principal_plus_interest",
            debt: troveDebt.toString(),
            principal: principal.toString(),
            interest: interest.toString(),
            open: open.length,
            block,
          },
        },
        enclaves: whole
          ? {
              status: "ok",
              data: {
                basis: "principal",
                debt: enclaveDebt.toString(),
                open: openEnclaves.length,
                positions: enclaveSummaries.length,
                latest_block: newest?.latest.block_number ?? null,
                latest_timestamp: newest?.latest.timestamp ?? null,
              },
            }
          : { status: "unavailable", reason: "incomplete" },
        markets: {
          status: "ok",
          data: {
            basis: "total_borrow_assets",
            debt: marketDebt.toString(),
            included,
            excluded: lending
              .filter((each) => each.loan_token !== musdToken)
              .map((each) => ({ ...each, reason: "loan_token" as const })),
          },
        },
      },
      history: {
        status: "ok",
        data: {
          from: days[0] ?? "",
          to: days.at(-1) ?? "",
          points: days.map((day, index) => ({
            day,
            total: whole ? total.toString() : null,
            troves: troveDebt.toString(),
            enclaves: whole ? enclaveDebt.toString() : null,
            markets: marketDebt.toString(),
            partial: index === days.length - 1,
          })),
        },
      },
      collateral: whole
        ? {
            status: "ok",
            data: {
              token: btcToken,
              decimals: 18,
              total: (troveColl + enclaveColl + marketColl).toString(),
              troves: troveColl.toString(),
              enclaves: enclaveColl.toString(),
              markets: marketColl.toString(),
              open_markets: owing,
            },
          }
        : { status: "unavailable", reason: "incomplete" },
    },
  }
}

const marketPattern = "(0x[0-9a-f]{64})"
const addressPattern = "(0x[0-9a-f]{40})"
const findMarket = (id: string | undefined) =>
  marketList.find((each) => each.market_id === id) ?? null

/** The routes the API answers from READ_DB's live snapshot. */
const livePrefixes = [
  "^borrow/markets",
  "^borrow/totals",
  "^borrow/troves",
  "^borrow/owners/",
  "^borrow/stability-pool",
]

/**
 * How far behind the head the live snapshot is, as every live Borrow
 * answer says (`snapshot`): current, or stale in the `delayed` scenario.
 */
export function liveSnapshot(scenario: FixtureScenario) {
  const behind = scenario === "delayed" ? 412 : 12
  return {
    block,
    head: block + behind,
    behind_blocks: behind,
    stale: behind > 240,
    max_behind_blocks: 240,
  }
}

const borrowRoutes: FixtureRoute[] = [
  {
    // One stored market row failed its schema and was left out
    // (`meta.skipped`), so the pages say a row is not shown.
    pattern: /^borrow\/markets$/,
    answer: () => ok({ data: marketList, meta: { skipped: 1 } }),
  },
  {
    pattern: new RegExp(`^borrow/markets/${marketPattern}$`),
    answer: (match) => {
      const found = findMarket(match[1])
      return found === null ? null : ok({ data: found })
    },
  },
  {
    pattern: new RegExp(`^borrow/markets/${marketPattern}/positions$`),
    answer: (match, query) =>
      findMarket(match[1]) === null
        ? null
        : pageAnswer(
            morphoPositions.filter((each) => each.market_id === match[1]),
            query,
          ),
  },
  {
    pattern: new RegExp(`^borrow/markets/${marketPattern}/events$`),
    answer: (match, query) =>
      pageAnswer(
        morphoEvents.filter((each) => each.market_id === match[1]),
        query,
      ),
  },
  {
    pattern: new RegExp(
      `^borrow/markets/${marketPattern}/positions/${addressPattern}/events$`,
    ),
    answer: (match, query) =>
      pageAnswer(
        morphoEvents.filter(
          (each) => each.market_id === match[1] && each.on_behalf === match[2],
        ),
        query,
      ),
  },
  {
    pattern: new RegExp(`^borrow/owners/${addressPattern}$`),
    answer: (match) => ok({ data: borrowPositionsOf(match[1] ?? "") }),
  },
  {
    pattern: /^borrow\/enclave\/positions\/(0x[0-9a-f]{64}|[0-9]+)\/events$/,
    answer: (match, query) =>
      pageAnswer(
        enclaveEvents.filter((each) => each.position_id === match[1]),
        query,
      ),
  },
  {
    pattern: /^borrow\/enclave\/positions$/,
    answer: (_m, query) => pageAnswer(enclaveSummaries, query),
  },
  {
    pattern: /^borrow\/enclave\/locks\/([0-9]{1,78})$/,
    answer: (match) =>
      ok({ data: enclaveLockOf(match[1] ?? ""), meta: { skipped: 0 } }),
  },
  {
    pattern: /^borrow\/totals$/,
    answer: (_m, _query, scenario) => ok(borrowTotals(scenario)),
  },
  {
    pattern: new RegExp(`^borrow/enclave/borrowers/${addressPattern}/events$`),
    answer: (match, query) =>
      pageAnswer(
        enclaveEvents.filter((each) => each.borrower === match[1]),
        query,
      ),
  },
  {
    pattern: /^borrow\/troves$/,
    answer: (_m, query) => pageAnswer(troves, query),
  },
  {
    pattern: new RegExp(`^borrow/troves/${addressPattern}$`),
    answer: (match) => {
      const found = troves.find((each) => each.owner === match[1])
      return found === undefined ? null : ok({ data: found })
    },
  },
  {
    pattern: new RegExp(`^borrow/troves/${addressPattern}/events$`),
    answer: (match, query) =>
      pageAnswer(
        troveEvents.filter((each) => each.borrower === match[1]),
        query,
      ),
  },
  {
    // Trove and Morpho liquidations merged newest first by (block, log),
    // each with its `kind`, as the API answers.
    pattern: /^borrow\/liquidations$/,
    answer: (_m, query) =>
      pageAnswer(
        [
          ...troveEvents
            .filter((each) => each.action === "LOAN_LIQUIDATED")
            .map((each) => ({ kind: "trove" as const, ...each })),
          ...morphoEvents
            .filter((each) => each.action === "LIQUIDATED")
            .map((each) => ({ kind: "morpho" as const, ...each })),
        ].sort(
          (a, b) =>
            b.block_number - a.block_number || b.log_index - a.log_index,
        ),
        query,
      ),
  },
  {
    // Every venue's latest events, newest first, one item per Enclave
    // event, as the API answers (no cursor).
    pattern: /^borrow\/events$/,
    answer: (_m, query) => {
      const limit = Number(query.get("limit") ?? "10")
      if (!Number.isInteger(limit) || limit < 1 || limit > 25) return null
      // Borrowers' actions only, as the API lists them: no lender's
      // supply, settings or accruals.
      const lending = new Set(["SUPPLIED", "WITHDRAWN", "INTEREST_ACCRUED"])
      const items = [
        ...troveEvents.map((each) => ({ kind: "trove" as const, ...each })),
        ...morphoEvents
          .filter((each) => !lending.has(each.action))
          .map((each) => ({ kind: "morpho" as const, ...each })),
        ...enclaveEvents.map((each) => ({ kind: "enclave" as const, ...each })),
      ].sort(
        (a, b) =>
          b.timestamp - a.timestamp ||
          b.block_number - a.block_number ||
          b.log_index - a.log_index,
      )
      return ok({ data: items.slice(0, limit), meta: { skipped: 0 } })
    },
  },
  {
    pattern: /^borrow\/redemptions$/,
    answer: (_m, query) =>
      pageAnswer(
        troveEvents.filter((each) => each.action === "LOAN_REDEEMED"),
        query,
      ),
  },
  {
    pattern: /^borrow\/stability-pool$/,
    answer: () =>
      ok({
        data: {
          total_musd_deposits: units("1840221.40"),
          total_collateral: units("2.1180"),
          block,
          updated_at: updated,
        },
      }),
  },
]

/** Live answers carry their snapshot's age; history answers do not. */
function isLive(route: FixtureRoute): boolean {
  const source = route.pattern.source.replaceAll("\\/", "/")
  return (
    livePrefixes.some((prefix) => source.startsWith(prefix)) &&
    !source.includes("/events")
  )
}

export const borrowFixtures: FixtureRoute[] = borrowRoutes.map((route) =>
  isLive(route)
    ? {
        ...route,
        answer: (match, query, scenario) => {
          const answer = route.answer(match, query, scenario)
          if (answer === null || answer.status !== 200) return answer
          return {
            ...answer,
            body: {
              ...(answer.body as object),
              snapshot: liveSnapshot(scenario),
            },
          }
        },
      }
    : route,
)
