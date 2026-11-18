import {
  CONTRACTS,
  MORPHO_BLUE_DEPLOY_BLOCK,
  MORPHO_MARKETS,
  VOTING_ESCROW_ABI,
} from "@matchbox/chain"
import type { Logger } from "@matchbox/logger"
import { type Address, type Hex, isHex, type PublicClient } from "viem"
import { z } from "zod"
import { readCursor, writeCursor } from "../cursors"
import {
  type DiscoveredMarket,
  discoverMorphoAccounts,
  discoverMorphoMarkets,
  type MorphoRead,
  readMorpho,
  readTokenDecimals,
} from "./morpho"
import { musdPriceScale, readTroves, type TroveRead } from "./troves"

/** The chain reads behind the live snapshot (a fake in tests). */
export type LiveChainReader = {
  head(): Promise<bigint>
  discoverAccounts(
    fromBlock: bigint,
    toBlock: bigint,
    windows: number,
  ): Promise<{
    accounts: Set<string>
    markets: DiscoveredMarket[]
    scannedTo: bigint
  }>
  /** CreateMarket logs only (the one-time backfill). */
  discoverMarkets(
    fromBlock: bigint,
    toBlock: bigint,
    windows: number,
  ): Promise<{ markets: DiscoveredMarket[]; scannedTo: bigint }>
  /** ERC-20 decimals() per token (lower case); null when unreadable. */
  tokenDecimals(
    tokens: readonly Address[],
    block: bigint,
  ): Promise<Map<string, number | null>>
  morpho(
    marketIds: readonly Hex[],
    accounts: readonly string[],
    block: bigint,
  ): Promise<MorphoRead>
  troves(block: bigint): Promise<TroveRead>
  /** veBTC and veMEZO `supply()` at `block`; null when a read failed. */
  escrowSupply(
    block: bigint,
  ): Promise<{ vebtc: bigint | null; vemezo: bigint | null }>
}

export function createLiveChainReader(
  client: PublicClient,
  logger: Logger,
): LiveChainReader {
  return {
    head: () => client.getBlockNumber(),
    discoverAccounts: (fromBlock, toBlock, windows) =>
      discoverMorphoAccounts(client, fromBlock, toBlock, windows),
    discoverMarkets: (fromBlock, toBlock, windows) =>
      discoverMorphoMarkets(client, fromBlock, toBlock, windows),
    tokenDecimals: (tokens, block) => readTokenDecimals(client, tokens, block),
    morpho: (marketIds, accounts, block) =>
      readMorpho(client, marketIds, accounts, block, logger),
    troves: (block) => readTroves(client, block),
    async escrowSupply(block) {
      const results = await client.multicall({
        blockNumber: block,
        allowFailure: true,
        contracts: [CONTRACTS.mainnet.veBTC, CONTRACTS.mainnet.veMEZO].map(
          (address) => ({
            address,
            abi: VOTING_ESCROW_ABI,
            functionName: "supply" as const,
          }),
        ),
      })
      const [vebtc, vemezo] = results
      return {
        vebtc: vebtc?.status === "success" ? vebtc.result : null,
        vemezo: vemezo?.status === "success" ? vemezo.result : null,
      }
    },
  }
}

// Every 5 minutes: Morpho markets and positions, troves and Stability Pool
// totals from Mezo RPC into READ_DB, all at one block. Rows are only
// rewritten when their values change (the WHERE on each upsert), so a quiet
// market costs reads, not writes.

const network = "mezo"
const morphoCursor = "morpho-logs"
/**
 * The CreateMarket backfill over the blocks the account scan read before
 * it also asked for CreateMarket: the last block scanned, then "done".
 */
const marketsBackfillCursor = "morpho-markets-backfill"

/** Markets every run reads even before discovery has stored them. */
const configuredMarkets: readonly Hex[] = Object.values(MORPHO_MARKETS.mainnet)

export type LiveSnapshotDeps = {
  db: D1Database
  chain: LiveChainReader
  logWindowsPerRun: number
  nowSeconds: number
  logger: Logger
}

export type LiveSnapshotSummary = {
  block: number
  markets: number
  positions: number
  troves: number
  accountsDiscovered: number
  /** CreateMarket logs found this run (scan and backfill). */
  marketsDiscovered: number
  /** False when the MUSD price could not be stored (migration 0005 missing). */
  priceStored: boolean
}

function morphoStatements(
  db: D1Database,
  read: MorphoRead,
  block: number,
  now: number,
): D1PreparedStatement[] {
  const markets = read.markets.map((market) =>
    db
      .prepare(
        `INSERT INTO morpho_markets (network, market_id, loan_token,
           collateral_token, oracle, irm, lltv_raw, total_supply_assets_raw,
           total_supply_shares_raw, total_borrow_assets_raw,
           total_borrow_shares_raw, fee_raw, last_update, borrow_rate_raw,
           oracle_price_raw, block, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
           ?15, ?16, ?17)
         ON CONFLICT (network, market_id) DO UPDATE SET
           total_supply_assets_raw = excluded.total_supply_assets_raw,
           total_supply_shares_raw = excluded.total_supply_shares_raw,
           total_borrow_assets_raw = excluded.total_borrow_assets_raw,
           total_borrow_shares_raw = excluded.total_borrow_shares_raw,
           fee_raw = excluded.fee_raw,
           last_update = excluded.last_update,
           borrow_rate_raw = excluded.borrow_rate_raw,
           oracle_price_raw = excluded.oracle_price_raw,
           block = excluded.block,
           updated_at = excluded.updated_at
         WHERE morpho_markets.last_update <> excluded.last_update
           OR morpho_markets.total_supply_assets_raw <> excluded.total_supply_assets_raw
           OR morpho_markets.total_borrow_assets_raw <> excluded.total_borrow_assets_raw
           OR coalesce(morpho_markets.borrow_rate_raw, '') <> coalesce(excluded.borrow_rate_raw, '')
           OR coalesce(morpho_markets.oracle_price_raw, '') <> coalesce(excluded.oracle_price_raw, '')`,
      )
      .bind(
        network,
        market.marketId,
        market.loanToken.toLowerCase(),
        market.collateralToken.toLowerCase(),
        market.oracle.toLowerCase(),
        market.irm.toLowerCase(),
        market.lltv.toString(),
        market.totalSupplyAssets.toString(),
        market.totalSupplyShares.toString(),
        market.totalBorrowAssets.toString(),
        market.totalBorrowShares.toString(),
        market.fee.toString(),
        Number(market.lastUpdate),
        market.borrowRate?.toString() ?? null,
        market.oraclePrice?.toString() ?? null,
        block,
        now,
      ),
  )
  const positions = read.positions.map((position) =>
    db
      .prepare(
        `INSERT INTO morpho_positions (network, market_id, account,
           supply_shares_raw, borrow_shares_raw, collateral_raw, block,
           updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT (network, market_id, account) DO UPDATE SET
           supply_shares_raw = excluded.supply_shares_raw,
           borrow_shares_raw = excluded.borrow_shares_raw,
           collateral_raw = excluded.collateral_raw,
           block = excluded.block,
           updated_at = excluded.updated_at
         WHERE morpho_positions.supply_shares_raw <> excluded.supply_shares_raw
           OR morpho_positions.borrow_shares_raw <> excluded.borrow_shares_raw
           OR morpho_positions.collateral_raw <> excluded.collateral_raw`,
      )
      .bind(
        network,
        position.marketId,
        position.account.toLowerCase(),
        position.supplyShares.toString(),
        position.borrowShares.toString(),
        position.collateral.toString(),
        block,
        now,
      ),
  )
  // Positions that closed since the last run.
  const open = read.positions.map(
    (position) => `${position.marketId}:${position.account.toLowerCase()}`,
  )
  const closed = db
    .prepare(
      `DELETE FROM morpho_positions
       WHERE network = ?1
         AND market_id || ':' || account NOT IN (SELECT value FROM json_each(?2))`,
    )
    .bind(network, JSON.stringify(open))
  return [...markets, ...positions, closed]
}

function troveStatements(
  db: D1Database,
  read: TroveRead,
  block: number,
  now: number,
): D1PreparedStatement[] {
  const troves = read.troves.map((trove) =>
    db
      .prepare(
        `INSERT INTO troves (network, owner, status, coll_raw, principal_raw,
           interest_raw, interest_rate, block, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT (network, owner) DO UPDATE SET
           status = excluded.status,
           coll_raw = excluded.coll_raw,
           principal_raw = excluded.principal_raw,
           interest_raw = excluded.interest_raw,
           interest_rate = excluded.interest_rate,
           block = excluded.block,
           updated_at = excluded.updated_at
         WHERE troves.status <> excluded.status
           OR troves.coll_raw <> excluded.coll_raw
           OR troves.principal_raw <> excluded.principal_raw
           OR troves.interest_raw <> excluded.interest_raw
           OR troves.interest_rate <> excluded.interest_rate`,
      )
      .bind(
        network,
        trove.owner.toLowerCase(),
        trove.status,
        trove.coll.toString(),
        trove.principal.toString(),
        trove.interest.toString(),
        trove.interestRate,
        block,
        now,
      ),
  )
  const owners = read.troves.map((trove) => trove.owner.toLowerCase())
  const closed = db
    .prepare(
      `DELETE FROM troves
       WHERE network = ?1 AND owner NOT IN (SELECT value FROM json_each(?2))`,
    )
    .bind(network, JSON.stringify(owners))
  const pool = db
    .prepare(
      `INSERT INTO stability_pool (network, total_musd_deposits_raw,
         total_collateral_raw, block, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (network) DO UPDATE SET
         total_musd_deposits_raw = excluded.total_musd_deposits_raw,
         total_collateral_raw = excluded.total_collateral_raw,
         block = excluded.block,
         updated_at = excluded.updated_at
       WHERE stability_pool.total_musd_deposits_raw <> excluded.total_musd_deposits_raw
         OR stability_pool.total_collateral_raw <> excluded.total_collateral_raw`,
    )
    .bind(
      network,
      read.stabilityPool.totalMusdDeposits.toString(),
      read.stabilityPool.totalCollateral.toString(),
      block,
      now,
    )
  return [...troves, closed, pool]
}

/**
 * The protocol price (PriceFeed.fetchPrice()) on the pool row, read at the
 * same block (migrations/0005_musd_price.sql). Its own statement, after the
 * main batch: the columns exist only once READ_DB migration 0005 is
 * applied, and a missing column must never fail the Morpho, trove and pool
 * writes. Written on every run, changed or not, so musd_btc_price_block is
 * the block of the last run that read the price (one row write per run):
 * a reader compares it with the trove and pool blocks to tell a current
 * price from a stale one.
 */
function priceStatement(
  db: D1Database,
  price: bigint | null,
  block: number,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE stability_pool SET musd_btc_price_raw = ?2,
         musd_btc_price_scale = ?3, musd_btc_price_block = ?4
       WHERE network = ?1`,
    )
    .bind(
      network,
      price?.toString() ?? null,
      price === null ? null : musdPriceScale,
      block,
    )
}

/**
 * Markets discovered from CreateMarket (READ_DB migration 0006), with the
 * tokens' on-chain decimals; null when the table is missing.
 */
async function storedMarkets(db: D1Database): Promise<Hex[] | null> {
  try {
    const result = await db
      .prepare("SELECT market_id FROM morpho_known_markets WHERE network = ?1")
      .bind(network)
      .all()
    return z
      .array(z.object({ market_id: z.string() }))
      .parse(result.results)
      .flatMap((row) => (isHex(row.market_id) ? [row.market_id] : []))
  } catch {
    return null
  }
}

/**
 * Stores newly found markets (each once) with their tokens' decimals as
 * read on chain: NULL when decimals() could not be read, so a reader never
 * assumes 18 for a token it does not know.
 */
function knownMarketStatements(
  db: D1Database,
  markets: readonly DiscoveredMarket[],
  decimals: ReadonlyMap<string, number | null>,
  now: number,
): D1PreparedStatement[] {
  return markets.map((market) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO morpho_known_markets (network, market_id,
           loan_token, collateral_token, oracle, irm, lltv_raw,
           loan_decimals, collateral_decimals, created_block, discovered_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      )
      .bind(
        network,
        market.marketId,
        market.loanToken.toLowerCase(),
        market.collateralToken.toLowerCase(),
        market.oracle.toLowerCase(),
        market.irm.toLowerCase(),
        market.lltv.toString(),
        decimals.get(market.loanToken.toLowerCase()) ?? null,
        decimals.get(market.collateralToken.toLowerCase()) ?? null,
        Number(market.createdBlock),
        now,
      ),
  )
}

async function knownAccounts(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare("SELECT account FROM morpho_accounts WHERE network = ?1")
    .bind(network)
    .all<{ account: string }>()
  return result.results.map((row) => row.account)
}

/** Upserts each escrow's supply, rewriting only a changed value. */
function supplyStatements(
  db: D1Database,
  supply: { vebtc: bigint | null; vemezo: bigint | null },
  block: number,
  now: number,
): D1PreparedStatement[] {
  return (["vebtc", "vemezo"] as const).flatMap((escrow) => {
    const value = supply[escrow]
    if (value === null) return []
    return [
      db
        .prepare(
          `INSERT INTO escrow_supply (network, escrow, supply_raw, block, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT (network, escrow) DO UPDATE SET
             supply_raw = excluded.supply_raw,
             block = excluded.block,
             updated_at = excluded.updated_at
           WHERE escrow_supply.supply_raw <> excluded.supply_raw`,
        )
        .bind(network, escrow, value.toString(), block, now),
    ]
  })
}

/** Escrow supplies the live snapshot stored; null for a missing escrow. */
export async function readEscrowSupply(
  db: D1Database,
): Promise<{ vebtc: bigint | null; vemezo: bigint | null }> {
  const result = await db
    .prepare("SELECT escrow, supply_raw FROM escrow_supply WHERE network = ?1")
    .bind(network)
    .all()
  const supply: { vebtc: bigint | null; vemezo: bigint | null } = {
    vebtc: null,
    vemezo: null,
  }
  for (const raw of result.results) {
    const row = escrowSupplyRowSchema.safeParse(raw)
    if (row.success) supply[row.data.escrow] = BigInt(row.data.supply_raw)
  }
  return supply
}

const escrowSupplyRowSchema = z.object({
  escrow: z.enum(["vebtc", "vemezo"]),
  supply_raw: z.string().regex(/^[0-9]+$/),
})

export async function runLiveSnapshot(
  deps: LiveSnapshotDeps,
): Promise<LiveSnapshotSummary> {
  const head = await deps.chain.head()
  const block = Number(head)
  const from = await readCursor(deps.db, morphoCursor, network)
  const discovery = await deps.chain.discoverAccounts(
    from === null ? 0n : BigInt(from) + 1n,
    head,
    deps.logWindowsPerRun,
  )
  // The one-time CreateMarket backfill, over the blocks the account scan
  // had read before it asked for CreateMarket too; same window budget.
  const backfillAt = await readCursor(deps.db, marketsBackfillCursor, network)
  let backfill: { markets: DiscoveredMarket[]; value: string } | null = null
  if (backfillAt !== "done") {
    const end = from === null ? -1n : BigInt(from)
    const start =
      backfillAt === null ? MORPHO_BLUE_DEPLOY_BLOCK : BigInt(backfillAt) + 1n
    if (start > end) {
      backfill = { markets: [], value: "done" }
    } else {
      const read = await deps.chain.discoverMarkets(
        start,
        end,
        deps.logWindowsPerRun,
      )
      backfill = {
        markets: read.markets,
        value: read.scannedTo >= end ? "done" : read.scannedTo.toString(),
      }
    }
  }
  const found = new Map<string, DiscoveredMarket>()
  for (const market of [...discovery.markets, ...(backfill?.markets ?? [])]) {
    found.set(market.marketId, market)
  }
  // Stored before the cursors move, so a market found in a scanned window
  // is never lost; if it cannot be stored (migration 0006 not applied), the
  // cursors stay and the same windows are scanned again next run.
  let marketsStored = true
  if (found.size > 0) {
    try {
      const markets = [...found.values()]
      const decimals = await deps.chain.tokenDecimals(
        markets.flatMap((market) => [market.loanToken, market.collateralToken]),
        head,
      )
      await deps.db.batch(
        knownMarketStatements(deps.db, markets, decimals, deps.nowSeconds),
      )
    } catch (error) {
      marketsStored = false
      deps.logger.error({
        message:
          "MORPHO MARKETS NOT STORED: apply READ_DB migration 0006_morpho_known_markets; the log scan repeats until then",
        markets: [...found.keys()],
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const discovered = [...discovery.accounts]
  if (discovered.length > 0) {
    await deps.db.batch(
      discovered.map((account) =>
        deps.db
          .prepare(
            `INSERT OR IGNORE INTO morpho_accounts
               (network, account, first_seen_block)
             VALUES (?1, ?2, ?3)`,
          )
          .bind(network, account, block),
      ),
    )
  }
  if (marketsStored && backfill !== null) {
    await writeCursor(
      deps.db,
      marketsBackfillCursor,
      network,
      backfill.value,
      deps.nowSeconds,
    )
  }
  if (marketsStored && discovery.scannedTo >= 0n) {
    await writeCursor(
      deps.db,
      morphoCursor,
      network,
      discovery.scannedTo.toString(),
      deps.nowSeconds,
    )
  }
  const accounts = await knownAccounts(deps.db)
  const stored = await storedMarkets(deps.db)
  const marketIds = [
    ...new Set<Hex>([
      ...configuredMarkets,
      ...(stored ?? []),
      ...[...found.values()].map((market) => market.marketId),
    ]),
  ].sort()
  const [morpho, troves, supply] = await Promise.all([
    deps.chain.morpho(marketIds, accounts, head),
    deps.chain.troves(head),
    deps.chain.escrowSupply(head).catch(() => ({ vebtc: null, vemezo: null })),
  ])
  await deps.db.batch([
    ...morphoStatements(deps.db, morpho, block, deps.nowSeconds),
    ...troveStatements(deps.db, troves, block, deps.nowSeconds),
    ...supplyStatements(deps.db, supply, block, deps.nowSeconds),
  ])
  let priceStored = true
  try {
    await priceStatement(deps.db, troves.musdPrice, block).run()
  } catch (error) {
    priceStored = false
    deps.logger.error({
      message:
        "MUSD PRICE NOT STORED: apply READ_DB migration 0005_musd_price (the rest of the live snapshot was written)",
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return {
    block,
    markets: morpho.markets.length,
    positions: morpho.positions.length,
    troves: troves.troves.length,
    accountsDiscovered: discovered.length,
    marketsDiscovered: found.size,
    priceStored,
  }
}
