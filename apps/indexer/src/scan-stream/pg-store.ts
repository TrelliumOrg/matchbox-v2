import { z } from "zod"
import type { SqlClient, SqlPool } from "../borrow/pg-store"
import type { Network } from "../ingest/networks"
import { deleteNetworkRows, hasRowSeq } from "../row-seq"
import { SCAN_DECODER_VERSION } from "./decoder"
import {
  SCAN_STREAM,
  ScanCheckpointMovedError,
  ScanReplayRequiredError,
  type ScanStore,
  type ScanWindowCommit,
} from "./store"

// The scan stream's Postgres store. A window commits its day rollups, fee
// rows and checkpoint in one transaction, under a per-network advisory lock,
// and only if the checkpoint has not moved since the window was fetched:
// day rollups are added to, so applying a window twice would double them.

const checkpointRowSchema = z.object({
  last_block: z.string().transform(BigInt),
})
const versionRowSchema = z.object({ decoder_version: z.number().int() })

async function readCheckpoint(
  client: SqlClient,
  network: Network,
): Promise<bigint | null> {
  const result = await client.query(
    `SELECT last_block::text AS last_block FROM matchbox.indexer_checkpoints
     WHERE network = $1 AND stream = $2`,
    [network, SCAN_STREAM],
  )
  return z.array(checkpointRowSchema).parse(result.rows)[0]?.last_block ?? null
}

export class PgScanStore implements ScanStore {
  constructor(private readonly pool: SqlPool) {}

  private async withClient<T>(work: (client: SqlClient) => Promise<T>) {
    const client = await this.pool.connect()
    try {
      return await work(client)
    } finally {
      client.release()
    }
  }

  async getCheckpoint(network: Network): Promise<bigint | null> {
    return this.withClient((client) => readCheckpoint(client, network))
  }

  async builtWithDecoderVersion(network: Network): Promise<number | null> {
    const result = await this.pool.query(
      "SELECT decoder_version FROM matchbox.scan_stream_state WHERE network = $1",
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
        `INSERT INTO matchbox.scan_stream_state (network, decoder_version)
         VALUES ($1, $2) ON CONFLICT (network) DO NOTHING`,
        [network, SCAN_DECODER_VERSION],
      )
      return
    }
    if (built !== SCAN_DECODER_VERSION) {
      throw new ScanReplayRequiredError(network, built)
    }
  }

  async commitWindow(commit: ScanWindowCommit): Promise<void> {
    await this.withClient(async (client) => {
      await client.query("BEGIN")
      try {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext('matchbox-scan:' || $1))",
          [commit.network],
        )
        const current = await readCheckpoint(client, commit.network)
        if (current !== commit.expectedCheckpoint) {
          throw new ScanCheckpointMovedError(
            commit.network,
            commit.expectedCheckpoint,
            current,
          )
        }
        if (commit.days.length > 0) {
          await client.query(
            `INSERT INTO matchbox.token_transfer_days AS t
               (network, token, day, transfers, volume, minted, burned)
             SELECT $1, d.token, d.day, d.transfers, d.volume, d.minted, d.burned
             FROM unnest($2::text[], $3::date[], $4::bigint[], $5::numeric[],
                         $6::numeric[], $7::numeric[])
               AS d(token, day, transfers, volume, minted, burned)
             ON CONFLICT (network, token, day) DO UPDATE SET
               transfers = t.transfers + EXCLUDED.transfers,
               volume = t.volume + EXCLUDED.volume,
               minted = t.minted + EXCLUDED.minted,
               burned = t.burned + EXCLUDED.burned`,
            [
              commit.network,
              commit.days.map((d) => d.token),
              commit.days.map((d) => d.day),
              commit.days.map((d) => d.transfers.toString()),
              commit.days.map((d) => d.volume.toString()),
              commit.days.map((d) => d.minted.toString()),
              commit.days.map((d) => d.burned.toString()),
            ],
          )
        }
        if (commit.fees.length > 0) {
          const text = (value: bigint | null) =>
            value === null ? null : value.toString()
          await client.query(
            `INSERT INTO matchbox.musd_fees (network, tx_hash, log_index,
               block_number, timestamp, contract_address, fee_type, borrower,
               asset, amount, redemption_attempted, redemption_actual,
               redemption_collateral_sent, decoder_version)
             SELECT $1, f.*, $14 FROM unnest($2::text[], $3::bigint[],
               $4::bigint[], $5::bigint[], $6::text[], $7::text[], $8::text[],
               $9::text[], $10::numeric[], $11::numeric[], $12::numeric[],
               $13::numeric[])
               AS f(tx_hash, log_index, block_number, timestamp,
                    contract_address, fee_type, borrower, asset, amount,
                    redemption_attempted, redemption_actual,
                    redemption_collateral_sent)
             ON CONFLICT (network, tx_hash, log_index) DO NOTHING`,
            [
              commit.network,
              commit.fees.map((f) => f.txHash),
              commit.fees.map((f) => f.logIndex.toString()),
              commit.fees.map((f) => f.blockNumber.toString()),
              commit.fees.map((f) => f.timestamp.toString()),
              commit.fees.map((f) => f.contractAddress),
              commit.fees.map((f) => f.feeType),
              commit.fees.map((f) => f.borrower),
              commit.fees.map((f) => f.asset),
              commit.fees.map((f) => f.amount.toString()),
              commit.fees.map((f) => text(f.redemptionAttempted)),
              commit.fees.map((f) => text(f.redemptionActual)),
              commit.fees.map((f) => text(f.redemptionCollateralSent)),
              SCAN_DECODER_VERSION,
            ],
          )
        }
        await client.query(
          `INSERT INTO matchbox.indexer_checkpoints (network, stream, last_block, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (network, stream) DO UPDATE
             SET last_block = EXCLUDED.last_block, updated_at = now()`,
          [commit.network, SCAN_STREAM, commit.toBlock.toString()],
        )
        await client.query("COMMIT")
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      }
    })
  }

  // Empties the stream for a replay: one reset tombstone per table, so a
  // reader drops its copies and refills from the rows stamped after it.
  async reset(network: Network): Promise<void> {
    await this.withClient(async (client) => {
      await client.query("BEGIN")
      try {
        const tombstones = await hasRowSeq(client)
        for (const table of ["token_transfer_days", "musd_fees"]) {
          await deleteNetworkRows(client, table, network, tombstones)
        }
        await deleteNetworkRows(client, "scan_stream_state", network, false)
        await client.query(
          "DELETE FROM matchbox.indexer_checkpoints WHERE network = $1 AND stream = $2",
          [network, SCAN_STREAM],
        )
        await client.query("COMMIT")
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      }
    })
  }
}
