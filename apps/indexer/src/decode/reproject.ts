import type { ClientBase, PoolClient } from "pg"
import type { Address, Hex } from "viem"
import { z } from "zod"
import type { Network } from "../ingest/networks"
import type { RawLog, RawTx, RpcClient } from "../ingest/rpc"
import { storedInput } from "./calldata"
import { staticSourcesFor } from "./dispatch"
import { lower } from "./helpers"
import { PgStore } from "./pg-store"
import {
  type LogWithTx,
  PROJECTION_STREAM,
  projectBlock,
  projectionStatus,
} from "./projection"
import type {
  ActivityEventRow,
  BribeToPoolRow,
  DynamicDataSource,
  LockPositionRow,
  RewardDepositRow,
  TroveUpdateRow,
  VoteRow,
} from "./rows"
import type { Store } from "./store"

// Adds the rows of legacy reward contracts that the projection skipped,
// without a replay. Raw logs are pruned about 7 days after projection, so
// the logs come from RPC again, from each contract's start block through the
// projection checkpoint. They run through the same handlers as a projection
// (projectBlock, under the decoder version the tables were built with) into
// a Postgres store, and only the rows for logs that have none yet are
// written, in one transaction.
//
// The RPC reads take minutes, so the projection can change under them. The
// write transaction therefore locks the projection_state row and the
// projection checkpoint row (FOR SHARE) and aborts, writing nothing, unless
// the decoder version is the one read at the start and the checkpoint is
// still at or past the block read through. A replay or reset
// (resetProjection) deletes both rows, so it either committed before the
// lock (the check sees that and aborts) or waits for this transaction and
// then clears these rows with everything else. A normal tick is safe: it
// only projects blocks after its checkpoint, which never goes backwards,
// and while the lock is held it waits for this transaction before moving
// the checkpoint. Which logs already have rows is read again inside the
// transaction, under a transaction-level advisory lock that keeps two runs
// of this from interleaving, so nothing can add rows for logs at or below
// the checkpoint between that check and the insert. Re-running it writes
// nothing new.
//
// Only the Legacy* reward contracts qualify. Their handlers read and write
// nothing but their own rows (activity_events, reward_deposits and the
// bribe_to_pool mapping), so a log decoded out of order produces the same
// rows it would have in order. Escrows, voters and pools keep state across
// logs and need a replay.

const REPROJECTABLE_SOURCES: ReadonlySet<string> = new Set([
  "LegacyBribe",
  "LegacyFee",
])

export type ReprojectOptions = {
  network: Network
  contracts: Address[]
  windowSize: bigint
  concurrency: number
  apply: boolean
  // Called when a step's connection was ended and the step runs again.
  onReconnect?: (step: string, error: unknown) => void
}

// What this needs of a pg Pool: a connection for each database step.
export type ConnectionPool = { connect(): Promise<PoolClient> }

export type ReprojectedDeposit = Pick<
  RewardDepositRow,
  | "txHash"
  | "blockNumber"
  | "rewardContract"
  | "rewardType"
  | "gauge"
  | "pool"
  | "token"
  | "epochStart"
  | "amount"
>

export type ReprojectResult = {
  from: bigint
  through: bigint
  decoderVersion: number
  // eth_getLogs windows read, and the logs they returned per contract. A
  // contract known to have logs that shows 0 here means the fetch went
  // wrong, not that nothing is left to do.
  windowsRead: number
  logsFetched: number
  logsFetchedByContract: Record<Address, number>
  // Logs that already have rows (the cron projected them once it ran this
  // decoder, or an earlier run of this did).
  alreadyProjected: number
  logsHandled: number
  activities: number
  deposits: ReprojectedDeposit[]
  applied: boolean
}

// The projection changed while this ran; nothing was written.
export class ProjectionChangedError extends Error {
  constructor(network: Network, detail: string) {
    super(
      `${network} projection changed while this ran (${detail}): a replay, rebuild or reset ran or is running. Nothing was written. Let it finish, then run this again, starting with a dry run.`,
    )
    this.name = "ProjectionChangedError"
  }
}

// COMMIT failed, for instance because the connection ended while it was in
// flight; the rows may or may not have been written.
export class CommitOutcomeUnknownError extends Error {
  constructor(network: Network, options: { cause: unknown }) {
    const reason =
      options.cause instanceof Error
        ? options.cause.message
        : String(options.cause)
    super(
      `${network}: COMMIT failed (${reason}), so whether the rows were written is unknown. Run a dry run: it lists only the rows still missing, and an --apply after it writes those once.`,
      options,
    )
    this.name = "CommitOutcomeUnknownError"
  }
}

// admin_shutdown: what Neon sends when it suspends an idle compute (and what
// a server restart sends).
const CONNECTION_ENDED = "57P01"

function endedByServer(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === CONNECTION_ENDED
  )
}

// Runs one database step on its own connection, and once more on a new one
// if the server ended the first.
async function withConnection<T>(
  pool: ConnectionPool,
  step: string,
  onReconnect: ReprojectOptions["onReconnect"],
  work: (db: ClientBase) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const client = await pool.connect()
    // pg's pool stops listening for a client's errors while it is checked
    // out, and an "error" event with no listener ends the process. The
    // server ending the connection emits one, even mid-query.
    let ended: unknown
    const onError = (error: unknown): void => {
      ended = error
    }
    client.on("error", onError)
    try {
      const result = await work(client)
      client.removeListener("error", onError)
      client.release()
      return result
    } catch (error) {
      client.removeListener("error", onError)
      const lost = endedByServer(error) || endedByServer(ended)
      // Closed rather than put back in the pool: it may be broken, or still
      // in a transaction whose ROLLBACK failed.
      client.release(true)
      if (!lost || attempt > 1 || error instanceof CommitOutcomeUnknownError) {
        throw error
      }
      onReconnect?.(step, error)
    }
  }
}

// Records what the handlers add, and passes everything to the real store.
class RecordingStore implements Store {
  activities = 0
  readonly deposits: RewardDepositRow[] = []

  constructor(private readonly inner: Store) {}

  get decoderVersion(): number {
    return this.inner.decoderVersion
  }

  getLock(id: string): LockPositionRow | undefined {
    return this.inner.getLock(id)
  }

  putLock(lock: LockPositionRow): void {
    this.inner.putLock(lock)
  }

  getRewardMapping(rewardContract: Address): BribeToPoolRow | undefined {
    return this.inner.getRewardMapping(rewardContract)
  }

  putRewardMapping(mapping: BribeToPoolRow): void {
    this.inner.putRewardMapping(mapping)
  }

  putVote(vote: VoteRow): void {
    this.inner.putVote(vote)
  }

  getDataSource(address: Address): DynamicDataSource | undefined {
    return this.inner.getDataSource(address)
  }

  putDataSource(source: DynamicDataSource): void {
    this.inner.putDataSource(source)
  }

  addActivity(activity: ActivityEventRow): void {
    this.activities += 1
    this.inner.addActivity(activity)
  }

  addRewardDeposit(deposit: RewardDepositRow): void {
    this.deposits.push(deposit)
    this.inner.addRewardDeposit(deposit)
  }

  getTrove(borrower: Address): TroveUpdateRow | undefined {
    return this.inner.getTrove(borrower)
  }

  addTroveUpdate(update: TroveUpdateRow): void {
    this.inner.addTroveUpdate(update)
  }
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index] as T)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  )
  return results
}

const keyRowSchema = z.object({
  tx_hash: z.string(),
  log_index: z.coerce.number().int(),
})

function logKey(txHash: string, logIndex: number): string {
  return `${lower(txHash as Hex)}-${logIndex}`
}

// (tx, logIndex) of the given transactions' logs that already have an
// activity row or a reward deposit.
async function projectedKeys(
  db: ClientBase,
  network: Network,
  txHashes: Hex[],
): Promise<Set<string>> {
  if (txHashes.length === 0) return new Set()
  const result = await db.query(
    `SELECT tx_hash, log_index::text AS log_index
     FROM matchbox.activity_events
     WHERE network = $1
       AND tx_hash IN (SELECT jsonb_array_elements_text($2::jsonb))
     UNION
     SELECT tx_hash, log_index::text AS log_index
     FROM matchbox.reward_deposits
     WHERE network = $1
       AND tx_hash IN (SELECT jsonb_array_elements_text($2::jsonb))`,
    [network, JSON.stringify(txHashes)],
  )
  return new Set(
    z
      .array(keyRowSchema)
      .parse(result.rows)
      .map((row) => logKey(row.tx_hash, row.log_index)),
  )
}

const lockedVersionSchema = z.array(
  z.object({ decoder_version: z.number().int() }),
)
const lockedCheckpointSchema = z.array(
  z.object({ last_block: z.string().transform(BigInt) }),
)

// Inside the write transaction: holds the projection_state row and the
// projection checkpoint row until it ends, so a reset cannot delete them
// and a tick cannot move the checkpoint under the write, and aborts unless
// both still say what they said when this started.
async function assertProjectionUnchanged(
  db: ClientBase,
  network: Network,
  decoderVersion: number,
  through: bigint,
): Promise<void> {
  const state = await db.query(
    `SELECT decoder_version FROM matchbox.projection_state
     WHERE network = $1 FOR SHARE`,
    [network],
  )
  const version = lockedVersionSchema.parse(state.rows)[0]?.decoder_version
  const checkpoint = await db.query(
    `SELECT last_block::text AS last_block FROM matchbox.indexer_checkpoints
     WHERE network = $1 AND stream = $2 FOR SHARE`,
    [network, PROJECTION_STREAM],
  )
  const lastBlock = lockedCheckpointSchema.parse(checkpoint.rows)[0]?.last_block
  if (version !== decoderVersion) {
    throw new ProjectionChangedError(
      network,
      version === undefined
        ? `projection_state is gone; it was decoder v${decoderVersion}`
        : `decoder v${decoderVersion} is now v${version}`,
    )
  }
  if (lastBlock === undefined || lastBlock < through) {
    throw new ProjectionChangedError(
      network,
      lastBlock === undefined
        ? `the projection checkpoint is gone; it was ${through}`
        : `the projection checkpoint went back from ${through} to ${lastBlock}`,
    )
  }
}

export async function reprojectLegacyRewards(
  pool: ConnectionPool,
  rpc: RpcClient,
  options: ReprojectOptions,
): Promise<ReprojectResult> {
  const { network, onReconnect } = options
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new RangeError(
      `concurrency must be an integer of at least 1, got ${options.concurrency}`,
    )
  }
  if (options.windowSize < 1n) {
    throw new RangeError(
      `windowSize must be at least 1, got ${options.windowSize}`,
    )
  }
  const byAddress = new Map(
    staticSourcesFor(network).map((source) => [source.address, source]),
  )
  const contracts = [...new Set(options.contracts.map(lower))].sort()
  if (contracts.length === 0) throw new Error("No contracts to reproject")
  const sources = contracts.map(function sourceOf(address) {
    const source = byAddress.get(address)
    if (source === undefined || !REPROJECTABLE_SOURCES.has(source.name)) {
      throw new Error(
        `${address} is not a Legacy* reward contract of ${network}; only those can be reprojected without a replay`,
      )
    }
    return source
  })

  const status = await withConnection(
    pool,
    "read the projection status",
    onReconnect,
    (db) => projectionStatus(db, network),
  )
  if (
    status.projectedBlock === null ||
    status.builtWithDecoderVersion === null
  ) {
    throw new Error(
      `${network} has no projection yet; the projection itself will cover these contracts`,
    )
  }
  if (status.replayRequired) {
    throw new Error(
      `${network} tables were built with decoder v${status.builtWithDecoderVersion}, which this code no longer supports: replay instead`,
    )
  }
  const through = status.projectedBlock
  const decoderVersion = status.builtWithDecoderVersion
  const from = sources.reduce(
    (lowest, source) =>
      // biome-ignore lint/complexity/useMathMinMax: Math.min takes no bigints.
      source.startBlock < lowest ? source.startBlock : lowest,
    through + 1n,
  )
  const topic0s = [
    ...new Set(sources.flatMap((source) => [...source.selectors.keys()])),
  ].sort()

  const windows: { from: bigint; to: bigint }[] = []
  for (let start = from; start <= through; start += options.windowSize) {
    const end = start + options.windowSize - 1n
    // biome-ignore lint/complexity/useMathMinMax: Math.min takes no bigints.
    windows.push({ from: start, to: end < through ? end : through })
  }
  const logs: RawLog[] = (
    await mapLimit(windows, options.concurrency, (window) =>
      rpc.getLogs(window.from, window.to, contracts, topic0s),
    )
  ).flat()
  const logsFetchedByContract: Record<Address, number> = {}
  for (const address of contracts) logsFetchedByContract[address] = 0
  for (const log of logs) {
    const address = lower(log.address)
    logsFetchedByContract[address] = (logsFetchedByContract[address] ?? 0) + 1
  }
  const txHashes = [...new Set(logs.map((log) => log.txHash))]

  // A first look outside the transaction, only so the transactions of logs
  // that already have rows are not fetched. The transaction looks again.
  const doneBefore = await withConnection(
    pool,
    "look for logs that already have rows",
    onReconnect,
    (db) => projectedKeys(db, network, txHashes),
  )
  const transactions = new Map<Hex, RawTx>(
    (
      await rpc.getTransactions([
        ...new Set(
          logs
            .filter((log) => !doneBefore.has(logKey(log.txHash, log.logIndex)))
            .map((log) => log.txHash),
        ),
      ])
    ).map((tx) => [tx.hash, { ...tx, input: storedInput(tx) }]),
  )

  return withConnection(pool, "write the rows", onReconnect, async (db) => {
    await db.query("BEGIN")
    let committing = false
    try {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `matchbox-reproject-legacy-rewards:${network}`,
      ])
      await assertProjectionUnchanged(db, network, decoderVersion, through)

      const done = await projectedKeys(db, network, txHashes)
      const pending = logs.filter(
        (log) => !done.has(logKey(log.txHash, log.logIndex)),
      )
      const unfetched = pending.find((log) => !transactions.has(log.txHash))
      if (unfetched !== undefined) {
        // Rows seen in the first look are gone, which only a reset does.
        throw new ProjectionChangedError(
          network,
          `the rows of ${unfetched.txHash} disappeared`,
        )
      }

      const store = new PgStore(network, decoderVersion)
      await store.load(db)
      const recording = new RecordingStore(store)
      let logsHandled = 0
      let block: LogWithTx[] = []
      for (const log of pending) {
        const current = block[0]
        if (current && current.log.blockNumber !== log.blockNumber) {
          logsHandled += projectBlock(block, recording)
          block = []
        }
        block.push({ log, tx: transactions.get(log.txHash) ?? null })
      }
      if (block.length > 0) logsHandled += projectBlock(block, recording)

      const applied = options.apply && logsHandled > 0
      if (applied) {
        await store.flush(db)
        committing = true
        try {
          await db.query("COMMIT")
        } catch (error) {
          // Never retried, whatever the error: it may have committed.
          throw new CommitOutcomeUnknownError(network, { cause: error })
        }
      } else {
        await db.query("ROLLBACK")
      }

      return {
        from,
        through,
        decoderVersion,
        windowsRead: windows.length,
        logsFetched: logs.length,
        logsFetchedByContract,
        alreadyProjected: logs.length - pending.length,
        logsHandled,
        activities: recording.activities,
        deposits: recording.deposits.map((deposit) => ({
          txHash: deposit.txHash,
          blockNumber: deposit.blockNumber,
          rewardContract: deposit.rewardContract,
          rewardType: deposit.rewardType,
          gauge: deposit.gauge,
          pool: deposit.pool,
          token: deposit.token,
          epochStart: deposit.epochStart,
          amount: deposit.amount,
        })),
        applied,
      }
    } catch (error) {
      // After a failed COMMIT the transaction is already over. On an ended
      // connection the server rolled it back and ROLLBACK fails; the
      // connection is closed either way (withConnection), so the error that
      // stopped the write is the one to report.
      if (!committing) await db.query("ROLLBACK").catch(() => undefined)
      throw error
    }
  })
}
