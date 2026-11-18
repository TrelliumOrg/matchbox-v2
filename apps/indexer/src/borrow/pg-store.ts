import { BORROW_CONTRACT_KINDS } from "@matchbox/chain"
import { z } from "zod"
import { type Network, networkSchema } from "../ingest/networks"
import { lowerAddressSchema, lowerHexSchema } from "../ingest/rpc"
import { deleteNetworkRows, hasRowSeq, isTracked } from "../row-seq"
import { BORROW_DECODER_VERSION, type BorrowState } from "./decoder"
import {
  type BorrowContract,
  ENCLAVE_ACTIONS,
  type EnclaveEventRow,
  type EnclavePosition,
  type MorphoEventRow,
  type MorphoMarketRow,
} from "./rows"
import {
  BORROW_STREAM,
  BorrowCheckpointMovedError,
  BorrowReplayRequiredError,
  type BorrowStore,
  type BorrowWindowCommit,
  positionFromRow,
} from "./store"

// The part of pg's Pool and PoolClient the store uses, so tests can run it
// on PGlite (an in-process Postgres) instead of a server.
export type SqlResult = { rows: unknown[] }
export type SqlClient = {
  query(text: string, values?: unknown[]): Promise<SqlResult>
  release(): void
}
export type SqlPool = {
  query(text: string, values?: unknown[]): Promise<SqlResult>
  connect(): Promise<SqlClient>
}
type PoolClient = SqlClient

// numeric(78,0) and bigint columns are selected as ::text and parsed back to
// exact bigints.
const bigintText = z
  .string()
  .regex(/^-?\d+$/)
  .transform((value) => BigInt(value))

const versionRowSchema = z.object({ decoder_version: z.number().int() })
const checkpointRowSchema = z.object({ last_block: bigintText })

const contractRowSchema = z.object({
  network: networkSchema,
  address: lowerAddressSchema,
  kind: z.enum(BORROW_CONTRACT_KINDS),
  template: z.string(),
  created_block: bigintText,
  created_tx: lowerHexSchema.nullable(),
})

const marketRowSchema = z.object({
  network: networkSchema,
  market_id: lowerHexSchema,
  loan_token: lowerAddressSchema,
  collateral_token: lowerAddressSchema,
  oracle: lowerAddressSchema,
  irm: lowerAddressSchema,
  lltv: bigintText,
  loan_decimals: z.number().int().nullable(),
  collateral_decimals: z.number().int().nullable(),
  fee: bigintText,
  total_supply_assets: bigintText,
  total_supply_shares: bigintText,
  total_borrow_assets: bigintText,
  total_borrow_shares: bigintText,
  total_collateral: bigintText,
  last_update: bigintText,
  created_block: bigintText,
  created_tx: lowerHexSchema,
  created_timestamp: bigintText,
  updated_block: bigintText,
})

const positionRowSchema = z.object({
  position_id: lowerHexSchema,
  enclave: lowerAddressSchema,
  borrower: lowerAddressSchema,
  principal: bigintText,
  pledged_ve_btc: z.array(bigintText),
  action: z.enum(ENCLAVE_ACTIONS),
})

// Postgres caps a statement at 65,535 parameters.
const INSERT_BATCH_ROWS = 1_000

function text(value: bigint | null): string | null {
  return value === null ? null : value.toString()
}

async function insertRows(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: unknown[][],
  suffix: string,
): Promise<void> {
  for (let start = 0; start < rows.length; start += INSERT_BATCH_ROWS) {
    const batch = rows.slice(start, start + INSERT_BATCH_ROWS)
    const params: unknown[] = []
    const tuples = batch.map((row) => {
      const placeholders = row.map((value) => {
        params.push(value)
        return `$${params.length}`
      })
      return `(${placeholders.join(", ")})`
    })
    await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")} ${suffix}`,
      params,
    )
  }
}

const MORPHO_EVENT_COLUMNS = [
  "network",
  "tx_hash",
  "log_index",
  "block_number",
  "timestamp",
  "tx_from",
  "market_id",
  "action",
  "caller",
  "on_behalf",
  "receiver",
  "assets",
  "shares",
  "seized_assets",
  "bad_debt_assets",
  "bad_debt_shares",
  "prev_borrow_rate",
  "fee_shares",
  "fee",
  "decoder_version",
]

function morphoEventValues(row: MorphoEventRow): unknown[] {
  return [
    row.network,
    row.txHash,
    row.logIndex,
    row.blockNumber.toString(),
    row.timestamp.toString(),
    row.txFrom,
    row.marketId,
    row.action,
    row.caller,
    row.onBehalf,
    row.receiver,
    text(row.assets),
    text(row.shares),
    text(row.seizedAssets),
    text(row.badDebtAssets),
    text(row.badDebtShares),
    text(row.prevBorrowRate),
    text(row.feeShares),
    text(row.fee),
    BORROW_DECODER_VERSION,
  ]
}

const ENCLAVE_EVENT_COLUMNS = [
  "network",
  "tx_hash",
  "log_index",
  "ve_btc_token_id",
  "block_number",
  "timestamp",
  "tx_from",
  "contract_address",
  "enclave",
  "position_id",
  "borrower",
  "action",
  "amount",
  "principal",
  "interest_rate",
  "originator_fee_rate",
  "warning_cr",
  "minimum_cr",
  "lock_duration",
  "other_ve_btc_token_id",
  "pledged_ve_btc",
  "decoder_version",
]

function enclaveEventValues(row: EnclaveEventRow): unknown[] {
  return [
    row.network,
    row.txHash,
    row.logIndex,
    row.veBtcTokenId.toString(),
    row.blockNumber.toString(),
    row.timestamp.toString(),
    row.txFrom,
    row.contractAddress,
    row.enclave,
    row.positionId,
    row.borrower,
    row.action,
    text(row.amount),
    text(row.principal),
    row.interestRate,
    row.originatorFeeRate,
    text(row.warningCr),
    text(row.minimumCr),
    text(row.lockDuration),
    text(row.otherVeBtcTokenId),
    row.pledgedVeBtc.map((token) => token.toString()),
    BORROW_DECODER_VERSION,
  ]
}

const MARKET_COLUMNS = [
  "network",
  "market_id",
  "loan_token",
  "collateral_token",
  "oracle",
  "irm",
  "lltv",
  "loan_decimals",
  "collateral_decimals",
  "fee",
  "total_supply_assets",
  "total_supply_shares",
  "total_borrow_assets",
  "total_borrow_shares",
  "total_collateral",
  "last_update",
  "created_block",
  "created_tx",
  "created_timestamp",
  "updated_block",
  "decoder_version",
]

// Totals and fee are the market's state after the window; the rest never
// changes after CreateMarket.
const MARKET_UPDATED_COLUMNS = [
  "fee",
  "total_supply_assets",
  "total_supply_shares",
  "total_borrow_assets",
  "total_borrow_shares",
  "total_collateral",
  "last_update",
  "updated_block",
  "decoder_version",
]

function marketValues(row: MorphoMarketRow): unknown[] {
  return [
    row.network,
    row.marketId,
    row.loanToken,
    row.collateralToken,
    row.oracle,
    row.irm,
    row.lltv.toString(),
    row.loanDecimals,
    row.collateralDecimals,
    row.fee.toString(),
    row.totalSupplyAssets.toString(),
    row.totalSupplyShares.toString(),
    row.totalBorrowAssets.toString(),
    row.totalBorrowShares.toString(),
    row.totalCollateral.toString(),
    row.lastUpdate.toString(),
    row.createdBlock.toString(),
    row.createdTx,
    row.createdTimestamp.toString(),
    row.updatedBlock.toString(),
    BORROW_DECODER_VERSION,
  ]
}

const CONTRACT_COLUMNS = [
  "network",
  "address",
  "kind",
  "template",
  "created_block",
  "created_tx",
]

function contractValues(contract: BorrowContract): unknown[] {
  return [
    contract.network,
    contract.address,
    contract.kind,
    contract.template,
    contract.createdBlock.toString(),
    contract.createdTx,
  ]
}

// One row per address in a statement, earliest creation kept, so ON
// CONFLICT never touches a row twice.
function dedupeContracts(contracts: BorrowContract[]): BorrowContract[] {
  const byAddress = new Map<string, BorrowContract>()
  for (const contract of contracts) {
    const key = `${contract.network}:${contract.address}`
    const existing = byAddress.get(key)
    if (!existing || contract.createdBlock < existing.createdBlock) {
      byAddress.set(key, contract)
    }
  }
  return [...byAddress.values()]
}

async function upsertContracts(
  client: PoolClient,
  contracts: BorrowContract[],
): Promise<void> {
  await insertRows(
    client,
    "matchbox.borrow_contracts",
    CONTRACT_COLUMNS,
    dedupeContracts(contracts).map(contractValues),
    `ON CONFLICT (network, address) DO UPDATE
       SET created_block = LEAST(matchbox.borrow_contracts.created_block, EXCLUDED.created_block)`,
  )
}

export class PgBorrowStore implements BorrowStore {
  constructor(private readonly pool: SqlPool) {}

  private async withClient<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect()
    try {
      return await work(client)
    } finally {
      client.release()
    }
  }

  async builtWithDecoderVersion(network: Network): Promise<number | null> {
    const result = await this.pool.query(
      "SELECT decoder_version FROM matchbox.borrow_state WHERE network = $1",
      [network],
    )
    return (
      z.array(versionRowSchema).parse(result.rows)[0]?.decoder_version ?? null
    )
  }

  async ensureDecoderVersion(network: Network): Promise<void> {
    const built = await this.builtWithDecoderVersion(network)
    if (built === null) {
      await this.pool.query(
        `INSERT INTO matchbox.borrow_state (network, decoder_version)
         VALUES ($1, $2) ON CONFLICT (network) DO NOTHING`,
        [network, BORROW_DECODER_VERSION],
      )
      return
    }
    if (built !== BORROW_DECODER_VERSION) {
      throw new BorrowReplayRequiredError(network, built)
    }
  }

  async loadContracts(network: Network): Promise<BorrowContract[]> {
    const result = await this.pool.query(
      `SELECT network, address, kind, template,
              created_block::text AS created_block, created_tx
       FROM matchbox.borrow_contracts WHERE network = $1`,
      [network],
    )
    return z
      .array(contractRowSchema)
      .parse(result.rows)
      .map((row) => ({
        network: row.network,
        address: row.address,
        kind: row.kind,
        template: row.template,
        createdBlock: row.created_block,
        createdTx: row.created_tx,
      }))
  }

  async upsertContracts(contracts: BorrowContract[]): Promise<void> {
    if (contracts.length === 0) return
    await this.withClient((client) => upsertContracts(client, contracts))
  }

  async getCheckpoint(network: Network): Promise<bigint | null> {
    return this.withClient((client) => readCheckpoint(client, network))
  }

  async loadState(network: Network): Promise<BorrowState> {
    const marketResult = await this.pool.query(
      `SELECT network, market_id, loan_token, collateral_token, oracle, irm,
              lltv::text AS lltv, loan_decimals, collateral_decimals,
              fee::text AS fee,
              total_supply_assets::text AS total_supply_assets,
              total_supply_shares::text AS total_supply_shares,
              total_borrow_assets::text AS total_borrow_assets,
              total_borrow_shares::text AS total_borrow_shares,
              total_collateral::text AS total_collateral,
              last_update::text AS last_update,
              created_block::text AS created_block, created_tx,
              created_timestamp::text AS created_timestamp,
              updated_block::text AS updated_block
       FROM matchbox.morpho_markets WHERE network = $1`,
      [network],
    )
    const markets: BorrowState["markets"] = new Map()
    for (const row of z.array(marketRowSchema).parse(marketResult.rows)) {
      markets.set(row.market_id, {
        network: row.network,
        marketId: row.market_id,
        loanToken: row.loan_token,
        collateralToken: row.collateral_token,
        oracle: row.oracle,
        irm: row.irm,
        lltv: row.lltv,
        loanDecimals: row.loan_decimals,
        collateralDecimals: row.collateral_decimals,
        fee: row.fee,
        totalSupplyAssets: row.total_supply_assets,
        totalSupplyShares: row.total_supply_shares,
        totalBorrowAssets: row.total_borrow_assets,
        totalBorrowShares: row.total_borrow_shares,
        totalCollateral: row.total_collateral,
        lastUpdate: row.last_update,
        createdBlock: row.created_block,
        createdTx: row.created_tx,
        createdTimestamp: row.created_timestamp,
        updatedBlock: row.updated_block,
      })
    }

    // Positions are governance-gated and few (four ever by Nov 2026), so
    // the latest row of each is loaded whole.
    const positionResult = await this.pool.query(
      `SELECT DISTINCT ON (position_id)
              position_id, enclave, borrower, principal::text AS principal,
              pledged_ve_btc::text[] AS pledged_ve_btc, action
       FROM matchbox.enclave_events
       WHERE network = $1 AND position_id IS NOT NULL
       ORDER BY position_id, block_number DESC, log_index DESC,
                ve_btc_token_id DESC`,
      [network],
    )
    const positions = new Map<EnclavePosition["positionId"], EnclavePosition>()
    for (const row of z.array(positionRowSchema).parse(positionResult.rows)) {
      positions.set(
        row.position_id,
        positionFromRow(row.position_id, {
          enclave: row.enclave,
          borrower: row.borrower,
          principal: row.principal,
          pledgedVeBtc: row.pledged_ve_btc,
          action: row.action,
        }),
      )
    }
    return { markets, positions }
  }

  async commitWindow(commit: BorrowWindowCommit): Promise<void> {
    await this.withClient(async (client) => {
      await client.query("BEGIN")
      try {
        // Serializes borrow commits per network, so the checkpoint check
        // below and the writes after it see the same state.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext('matchbox-borrow:' || $1))",
          [commit.network],
        )
        const current = await readCheckpoint(client, commit.network)
        if (current !== commit.expectedCheckpoint) {
          throw new BorrowCheckpointMovedError(
            commit.network,
            commit.expectedCheckpoint,
            current,
          )
        }
        await upsertContracts(client, commit.contracts)
        await insertRows(
          client,
          "matchbox.morpho_events",
          MORPHO_EVENT_COLUMNS,
          commit.morphoEvents.map(morphoEventValues),
          "ON CONFLICT (network, tx_hash, log_index) DO NOTHING",
        )
        await insertRows(
          client,
          "matchbox.enclave_events",
          ENCLAVE_EVENT_COLUMNS,
          commit.enclaveEvents.map(enclaveEventValues),
          "ON CONFLICT (network, tx_hash, log_index, ve_btc_token_id) DO NOTHING",
        )
        await insertRows(
          client,
          "matchbox.morpho_markets",
          MARKET_COLUMNS,
          commit.markets.map(marketValues),
          `ON CONFLICT (network, market_id) DO UPDATE SET ${MARKET_UPDATED_COLUMNS.map(
            (column) => `${column} = EXCLUDED.${column}`,
          ).join(", ")}`,
        )
        await client.query(
          `INSERT INTO matchbox.indexer_checkpoints (network, stream, last_block, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (network, stream) DO UPDATE
             SET last_block = EXCLUDED.last_block, updated_at = now()`,
          [commit.network, BORROW_STREAM, commit.toBlock.toString()],
        )
        await client.query("COMMIT")
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      }
    })
  }

  async reset(network: Network): Promise<void> {
    await this.withClient(async (client) => {
      await client.query("BEGIN")
      try {
        // morpho_events and enclave_events are tracked (src/row-seq.ts):
        // one reset tombstone each, not one per row.
        const tombstones = await hasRowSeq(client)
        for (const table of [
          "morpho_events",
          "morpho_markets",
          "enclave_events",
          "borrow_state",
        ]) {
          await deleteNetworkRows(
            client,
            table,
            network,
            tombstones && isTracked(table),
          )
        }
        await client.query(
          "DELETE FROM matchbox.indexer_checkpoints WHERE network = $1 AND stream = $2",
          [network, BORROW_STREAM],
        )
        await client.query("COMMIT")
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      }
    })
  }
}

async function readCheckpoint(
  client: PoolClient,
  network: Network,
): Promise<bigint | null> {
  const result = await client.query(
    `SELECT last_block::text AS last_block FROM matchbox.indexer_checkpoints
     WHERE network = $1 AND stream = $2`,
    [network, BORROW_STREAM],
  )
  return z.array(checkpointRowSchema).parse(result.rows)[0]?.last_block ?? null
}
