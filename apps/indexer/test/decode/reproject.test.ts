import { EventEmitter } from "node:events"
import { PGlite } from "@electric-sql/pglite"
import { VOTING_REWARD_EVENTS_ABI as rewardAbi } from "@matchbox/chain"
import type { PoolClient } from "pg"
import {
  type Address,
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
} from "viem"
import { beforeAll, describe, expect, it } from "vitest"
import { storedInput } from "../../src/decode/calldata"
import { resetProjection, runProjection } from "../../src/decode/projection"
import {
  CommitOutcomeUnknownError,
  type ConnectionPool,
  ProjectionChangedError,
  reprojectLegacyRewards,
} from "../../src/decode/reproject"
import { RpcClient } from "../../src/ingest/rpc"
import { type ChainLog, FakeChain } from "../ingest/fake-chain"
import { applyMigrations, pgClient, pgPool } from "../row-seq/pglite"

// reproject:legacy-rewards on a migrated PGlite warehouse whose projection
// ran past the sMUSD gauge's deposits without knowing its reward contracts:
// it writes their rows once, warehouse-only, and nothing past the checkpoint,
// and writes nothing when the projection changes while it reads the chain.

const SMUSD_GAUGE: Address = "0x677817bf3e44b90e8f95222f75e2950b7904a401"
const SMUSD_POOL: Address = "0xb4d498029af77680cd1ef828b967f010d06c51cc"
const SMUSD_BRIBE: Address = "0x7d98f38a020a94b08eec295bfb6f4e86d581e607"
const SMUSD_FEES: Address = "0x33b8b1162f0b86d68cad418d96246ee2c5164a01"
const MUSD: Address = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
const BTC: Address = "0x7b7c000000000000000000000000000000000000"
const ALICE: Address = "0x000000000000000000000000000000000000a11c"
const CHECKPOINT = 8_300_000
const E0 = 1_765_411_200n
const E17 = 1_775_692_800n
const E18 = 1_776_297_600n
const MUSD_UNIT = 10n ** 18n

function notify(
  block: number,
  address: Address,
  args: { from: Address; reward: Address; epoch: bigint; amount: bigint },
): ChainLog {
  const topics = encodeEventTopics({
    abi: rewardAbi,
    eventName: "NotifyReward",
    args: { from: args.from, reward: args.reward, epoch: args.epoch },
  }) as Hex[]
  return {
    block,
    logIndex: 5,
    address,
    topics,
    data: encodeAbiParameters([{ type: "uint256" }], [args.amount]),
  }
}

function claim(block: number, address: Address, amount: bigint): ChainLog {
  const topics = encodeEventTopics({
    abi: rewardAbi,
    eventName: "ClaimRewards",
    args: { from: ALICE, reward: MUSD },
  }) as Hex[]
  return {
    block,
    logIndex: 2,
    address,
    topics,
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
  }
}

// Real blocks, epochs and amounts of the sMUSD deposits before the checkpoint.
const BRIBE_E0 = notify(5_407_624, SMUSD_BRIBE, {
  from: ALICE,
  reward: BTC,
  epoch: E0,
  amount: 300_000_000_000_000n,
})
const FEES_E17 = notify(8_087_942, SMUSD_FEES, {
  from: SMUSD_GAUGE,
  reward: MUSD,
  epoch: E17,
  amount: 12_321_012_573_765_001_959_551n,
})
const FEES_E18 = notify(8_255_530, SMUSD_FEES, {
  from: SMUSD_GAUGE,
  reward: MUSD,
  epoch: E18,
  amount: 479_752_365_427_488_167_616n,
})
const CLAIM = claim(8_100_000, SMUSD_FEES, 7n * MUSD_UNIT)
// After the checkpoint: the cron's to project, not this.
const LATER = notify(8_425_170, SMUSD_FEES, {
  from: SMUSD_GAUGE,
  reward: MUSD,
  epoch: E18 + 604_800n,
  amount: 10_000n * MUSD_UNIT,
})

function rpcFor(logs: ChainLog[]): RpcClient {
  const chain = new FakeChain({ head: 9_000_000, logs })
  return new RpcClient({
    network: "mezo",
    endpoints: [
      { url: "https://rpc.test", maxAddresses: 100, maxBlockRange: 1_000_000 },
    ],
    fetch: chain.fetch,
    sleep: async () => {},
  })
}

const OPTIONS = {
  network: "mezo" as const,
  contracts: [SMUSD_BRIBE, SMUSD_FEES],
  windowSize: 1_000_000n,
  concurrency: 2,
}

async function count(db: PGlite, sql: string): Promise<number> {
  const result = await db.query<{ n: number }>(sql)
  return Number(result.rows[0]?.n ?? 0)
}

describe("reprojectLegacyRewards", { timeout: 60_000 }, () => {
  let db: PGlite

  beforeAll(async () => {
    db = new PGlite()
    await applyMigrations(db, () => true)
  })

  it("refuses a database with no projection", async () => {
    await expect(
      reprojectLegacyRewards(pgPool(db), rpcFor([]), {
        ...OPTIONS,
        apply: false,
      }),
    ).rejects.toThrow(/no projection yet/)
    await db.exec(`
      INSERT INTO matchbox.projection_state (network, decoder_version)
      VALUES ('mezo', 3);
      INSERT INTO matchbox.indexer_checkpoints (network, stream, last_block)
      VALUES ('mezo', 'projection', ${CHECKPOINT}),
             ('mezo', 'logs', ${CHECKPOINT});`)
  })

  it("refuses a contract that is not a Legacy* reward contract", async () => {
    await expect(
      reprojectLegacyRewards(pgPool(db), rpcFor([]), {
        ...OPTIONS,
        contracts: ["0x48233ccc97b87ba93bca212cbee48e3210211f03"],
        apply: false,
      }),
    ).rejects.toThrow(/not a Legacy\* reward contract/)
  })

  it("refuses a concurrency that is not a whole number of at least 1", async () => {
    for (const concurrency of [Number.NaN, 0, -1, 1.5]) {
      await expect(
        reprojectLegacyRewards(pgPool(db), rpcFor([BRIBE_E0]), {
          ...OPTIONS,
          concurrency,
          apply: true,
        }),
      ).rejects.toThrow(/concurrency must be an integer of at least 1/)
    }
  })

  it("reports the missing rows on a dry run and writes nothing", async () => {
    const result = await reprojectLegacyRewards(
      pgPool(db),
      rpcFor([BRIBE_E0, FEES_E17, LATER]),
      { ...OPTIONS, apply: false },
    )
    expect(result).toMatchObject({
      from: 5_231_392n,
      through: BigInt(CHECKPOINT),
      decoderVersion: 3,
      windowsRead: 4,
      logsFetched: 2,
      logsFetchedByContract: { [SMUSD_BRIBE]: 1, [SMUSD_FEES]: 1 },
      alreadyProjected: 0,
      logsHandled: 2,
      activities: 2,
      applied: false,
    })
    expect(result.deposits.map((deposit) => deposit.epochStart)).toEqual([
      E0,
      E17,
    ])
    expect(
      await count(
        db,
        "SELECT count(*)::int AS n FROM matchbox.reward_deposits",
      ),
    ).toBe(0)
  })

  it("writes the rows once, warehouse-only, with the built version", async () => {
    // As if the cron had run: one deposit already has its rows.
    const first = await reprojectLegacyRewards(pgPool(db), rpcFor([FEES_E17]), {
      ...OPTIONS,
      apply: true,
    })
    expect(first).toMatchObject({ logsHandled: 1, applied: true })

    const result = await reprojectLegacyRewards(
      pgPool(db),
      rpcFor([BRIBE_E0, FEES_E17, CLAIM, FEES_E18, LATER]),
      { ...OPTIONS, apply: true },
    )
    expect(result).toMatchObject({
      logsFetched: 4,
      alreadyProjected: 1,
      logsHandled: 3,
      activities: 3,
      applied: true,
    })

    const deposits = await db.query<{
      reward_contract: string
      reward_type: string
      gauge: string
      pool: string
      epoch_start: string
      amount: string
      decoder_version: number
    }>(
      `SELECT reward_contract, reward_type, gauge, pool,
              epoch_start::text AS epoch_start, amount::text AS amount,
              decoder_version
       FROM matchbox.reward_deposits ORDER BY block_number`,
    )
    expect(deposits.rows).toEqual([
      {
        reward_contract: SMUSD_BRIBE,
        reward_type: "Bribe",
        gauge: SMUSD_GAUGE,
        pool: SMUSD_POOL,
        epoch_start: E0.toString(),
        amount: "300000000000000",
        decoder_version: 3,
      },
      {
        reward_contract: SMUSD_FEES,
        reward_type: "Fee",
        gauge: SMUSD_GAUGE,
        pool: SMUSD_POOL,
        epoch_start: E17.toString(),
        amount: "12321012573765001959551",
        decoder_version: 3,
      },
      {
        reward_contract: SMUSD_FEES,
        reward_type: "Fee",
        gauge: SMUSD_GAUGE,
        pool: SMUSD_POOL,
        epoch_start: E18.toString(),
        amount: "479752365427488167616",
        decoder_version: 3,
      },
    ])

    const activities = await db.query<{
      action_type: string
      explorer_parity: boolean
      gauge: string
    }>(
      `SELECT action_type, explorer_parity, gauge
       FROM matchbox.activity_events ORDER BY block_number`,
    )
    expect(activities.rows).toEqual([
      {
        action_type: "INCENTIVE_ADDED",
        explorer_parity: false,
        gauge: SMUSD_GAUGE,
      },
      {
        action_type: "INCENTIVE_ADDED",
        explorer_parity: false,
        gauge: SMUSD_GAUGE,
      },
      {
        action_type: "VOTE_FEE_CLAIMED",
        explorer_parity: false,
        gauge: SMUSD_GAUGE,
      },
      {
        action_type: "INCENTIVE_ADDED",
        explorer_parity: false,
        gauge: SMUSD_GAUGE,
      },
    ])
    expect(
      await count(
        db,
        `SELECT count(*)::int AS n FROM matchbox.bribe_to_pool
         WHERE gauge_address = '${SMUSD_GAUGE}'`,
      ),
    ).toBe(2)
  })

  it("writes nothing on a re-run", async () => {
    const result = await reprojectLegacyRewards(
      pgPool(db),
      rpcFor([BRIBE_E0, FEES_E17, CLAIM, FEES_E18, LATER]),
      { ...OPTIONS, apply: true },
    )
    expect(result).toMatchObject({
      logsFetched: 4,
      alreadyProjected: 4,
      logsHandled: 0,
      applied: false,
    })
    expect(
      await count(
        db,
        "SELECT count(*)::int AS n FROM matchbox.reward_deposits",
      ),
    ).toBe(3)
  })
})

// What ingest would have stored for these logs, through `through`.
async function ingestRaw(
  db: PGlite,
  logs: ChainLog[],
  through: number,
): Promise<void> {
  const rpc = rpcFor(logs)
  const topic0s = [...new Set(logs.map((log) => log.topics[0] as Hex))]
  const raw = await rpc.getLogs(
    5_000_000n,
    BigInt(through),
    [SMUSD_BRIBE, SMUSD_FEES],
    topic0s,
  )
  for (const log of raw) {
    await db.query(
      `INSERT INTO matchbox_raw.logs (id, network, block_number, block_hash,
         block_timestamp, transaction_hash, transaction_index, log_index,
         address, topics, data)
       VALUES ($1, 'mezo', $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT DO NOTHING`,
      [
        `${log.txHash}-${log.logIndex}`,
        log.blockNumber.toString(),
        log.blockHash,
        log.blockTimestamp.toString(),
        log.txHash,
        log.txIndex,
        log.logIndex,
        log.address,
        log.topics.join(","),
        log.data,
      ],
    )
  }
  const txs = await rpc.getTransactions([
    ...new Set(raw.map((log) => log.txHash)),
  ])
  for (const tx of txs) {
    await db.query(
      `INSERT INTO matchbox_raw.transactions (network, hash, block_number,
         transaction_index, from_address, to_address, input)
       VALUES ('mezo', $1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [
        tx.hash,
        tx.blockNumber.toString(),
        tx.txIndex,
        tx.from,
        tx.to,
        storedInput(tx),
      ],
    )
  }
  await db.query(
    `INSERT INTO matchbox.indexer_checkpoints (network, stream, last_block)
     VALUES ('mezo', 'logs', $1)
     ON CONFLICT (network, stream) DO UPDATE SET last_block = EXCLUDED.last_block`,
    [through.toString()],
  )
}

// An RPC client that runs `meanwhile` once, after the logs are read and
// before the transactions are: the minutes a real run spends on RPC.
function rpcWith(logs: ChainLog[], meanwhile: () => Promise<void>): RpcClient {
  const real = rpcFor(logs)
  const rpc = Object.create(real) as RpcClient
  let ran = false
  rpc.getTransactions = async (hashes: Hex[]) => {
    if (!ran) {
      ran = true
      await meanwhile()
    }
    return real.getTransactions(hashes)
  }
  return rpc
}

const BEFORE_CHECKPOINT = [BRIBE_E0, FEES_E17, CLAIM, FEES_E18]

// Tables built by the Worker before this decoder knew the sMUSD contracts:
// the checkpoint is past their logs and none of them has rows.
async function builtBeforeTheDeploy(): Promise<PGlite> {
  const db = new PGlite()
  await applyMigrations(db, () => true)
  await ingestRaw(db, BEFORE_CHECKPOINT, CHECKPOINT)
  await db.exec(`
    INSERT INTO matchbox.projection_state (network, decoder_version)
    VALUES ('mezo', 3);
    INSERT INTO matchbox.indexer_checkpoints (network, stream, last_block)
    VALUES ('mezo', 'projection', ${CHECKPOINT});`)
  return db
}

async function rowsWritten(db: PGlite): Promise<number> {
  return (
    (await count(
      db,
      "SELECT count(*)::int AS n FROM matchbox.reward_deposits",
    )) +
    (await count(
      db,
      "SELECT count(*)::int AS n FROM matchbox.activity_events",
    )) +
    (await count(db, "SELECT count(*)::int AS n FROM matchbox.bribe_to_pool"))
  )
}

describe("reprojectLegacyRewards while the projection changes", {
  timeout: 60_000,
}, () => {
  it("writes nothing when a replay resets the projection meanwhile", async () => {
    const db = await builtBeforeTheDeploy()
    // rebuild:history -- --replay starts while this reads the chain.
    const rpc = rpcWith(BEFORE_CHECKPOINT, () =>
      resetProjection(pgClient(db), "mezo"),
    )
    await expect(
      reprojectLegacyRewards(pgPool(db), rpc, { ...OPTIONS, apply: true }),
    ).rejects.toThrow(ProjectionChangedError)
    expect(await rowsWritten(db)).toBe(0)

    // The replay then projects these blocks itself, with no duplicate key.
    await runProjection(pgClient(db), "mezo", BigInt(CHECKPOINT))
    expect(
      await count(
        db,
        "SELECT count(*)::int AS n FROM matchbox.reward_deposits",
      ),
    ).toBe(3)
  })

  it("writes nothing when a replay under another version passed it meanwhile", async () => {
    const db = await builtBeforeTheDeploy()
    await db.exec(
      "UPDATE matchbox.projection_state SET decoder_version = 2 WHERE network = 'mezo'",
    )
    const rpc = rpcWith(BEFORE_CHECKPOINT, async () => {
      await resetProjection(pgClient(db), "mezo")
      await runProjection(pgClient(db), "mezo", BigInt(CHECKPOINT))
    })
    await expect(
      reprojectLegacyRewards(pgPool(db), rpc, { ...OPTIONS, apply: true }),
    ).rejects.toThrow(/decoder v2 is now v3/)
    const versions = await db.query<{ decoder_version: number; n: number }>(
      `SELECT decoder_version, count(*)::int AS n
       FROM matchbox.reward_deposits GROUP BY decoder_version`,
    )
    expect(versions.rows).toEqual([{ decoder_version: 3, n: 3 }])
  })

  it("writes nothing when the checkpoint went back", async () => {
    const db = await builtBeforeTheDeploy()
    const rpc = rpcWith(BEFORE_CHECKPOINT, async () => {
      await db.exec(`UPDATE matchbox.indexer_checkpoints SET last_block = 8000000
        WHERE network = 'mezo' AND stream = 'projection'`)
    })
    await expect(
      reprojectLegacyRewards(pgPool(db), rpc, { ...OPTIONS, apply: true }),
    ).rejects.toThrow(/went back from 8300000 to 8000000/)
    expect(await rowsWritten(db)).toBe(0)
  })

  it("skips the rows another run wrote meanwhile", async () => {
    const db = await builtBeforeTheDeploy()
    const rpc = rpcWith(BEFORE_CHECKPOINT, async () => {
      await reprojectLegacyRewards(pgPool(db), rpcFor(BEFORE_CHECKPOINT), {
        ...OPTIONS,
        apply: true,
      })
    })
    const result = await reprojectLegacyRewards(pgPool(db), rpc, {
      ...OPTIONS,
      apply: true,
    })
    expect(result).toMatchObject({
      logsFetched: 4,
      alreadyProjected: 4,
      logsHandled: 0,
      applied: false,
    })
    expect(
      await count(
        db,
        "SELECT count(*)::int AS n FROM matchbox.reward_deposits",
      ),
    ).toBe(3)
  })

  it("still writes when a normal tick moves the checkpoint on meanwhile", async () => {
    const db = await builtBeforeTheDeploy()
    await ingestRaw(db, [...BEFORE_CHECKPOINT, LATER], 8_500_000)
    const rpc = rpcWith([...BEFORE_CHECKPOINT, LATER], async () => {
      await runProjection(pgClient(db), "mezo", 8_500_000n)
    })
    const result = await reprojectLegacyRewards(pgPool(db), rpc, {
      ...OPTIONS,
      apply: true,
    })
    expect(result).toMatchObject({
      through: BigInt(CHECKPOINT),
      logsHandled: 4,
      applied: true,
    })
    // Three deposits from this run, and LATER's from the tick.
    expect(
      await count(
        db,
        "SELECT count(*)::int AS n FROM matchbox.reward_deposits",
      ),
    ).toBe(4)
    expect(
      await count(db, "SELECT count(*)::int AS n FROM matchbox.bribe_to_pool"),
    ).toBe(2)
  })
})

// What Neon's server sends when it suspends an idle compute.
function terminated(): Error {
  return Object.assign(
    new Error("terminating connection due to administrator command"),
    { code: "57P01", severity: "FATAL" },
  )
}

// One connection of EndingPool. Once ended, it fails every query with 57P01,
// and the server has rolled back the transaction it had open.
class EndingConnection extends EventEmitter {
  ended = false
  checkedOut = false
  private inTransaction = false

  constructor(
    private readonly db: PGlite,
    private readonly pool: EndingPool,
  ) {
    super()
  }

  async query(text: string, values?: unknown[]): Promise<unknown> {
    if (!this.ended && this.pool.endBefore(text)) await this.end()
    if (this.ended) throw terminated()
    const result = await pgClient(this.db).query(text, values)
    const verb = text.trim().toUpperCase()
    if (verb === "BEGIN") this.inTransaction = true
    if (verb === "COMMIT" || verb === "ROLLBACK") this.inTransaction = false
    return result
  }

  async end(): Promise<void> {
    this.ended = true
    if (this.inTransaction) {
      this.inTransaction = false
      await this.db.query("ROLLBACK")
    }
    // pg emits "error" on a checked-out client whose connection ends, and an
    // "error" with no listener throws (in the script, it ends the process).
    if (this.checkedOut) {
      this.emit("error", new Error("Connection terminated unexpectedly"))
    }
  }

  release(broken?: boolean | Error): void {
    this.checkedOut = false
    this.pool.released(this, Boolean(broken))
  }
}

// A pg pool over one PGlite database whose connections the server ends, as
// Neon does when it suspends an idle compute: suspend() ends every open
// connection, and endBefore ends the one about to run a matching query. Like
// pg's pool before it notices that an idle connection died, it hands the
// same connection out again unless it was released as broken.
class EndingPool implements ConnectionPool {
  opened = 0
  private idle: EndingConnection | undefined
  private readonly open = new Set<EndingConnection>()

  constructor(
    private readonly db: PGlite,
    readonly endBefore: (text: string) => boolean = () => false,
  ) {}

  get checkedOut(): number {
    return [...this.open].filter((connection) => connection.checkedOut).length
  }

  async connect(): Promise<PoolClient> {
    let connection = this.idle
    this.idle = undefined
    if (connection === undefined) {
      connection = new EndingConnection(this.db, this)
      this.opened += 1
      this.open.add(connection)
    }
    connection.checkedOut = true
    return connection as unknown as PoolClient
  }

  async suspend(): Promise<void> {
    for (const connection of this.open) await connection.end()
  }

  released(connection: EndingConnection, broken: boolean): void {
    if (broken) this.open.delete(connection)
    else this.idle = connection
  }
}

// Ends the connection a matching query is about to run on, `times` times.
function endingBefore(
  match: (text: string) => boolean,
  times = 1,
): (text: string) => boolean {
  let left = times
  return (text) => {
    if (left === 0 || !match(text)) return false
    left -= 1
    return true
  }
}

// An RPC client that runs `meanwhile` before every read: the minutes a real
// run spends on RPC, during which Neon suspends the idle compute.
function rpcSuspending(
  logs: ChainLog[],
  meanwhile: () => Promise<void>,
): RpcClient {
  const real = rpcFor(logs)
  const rpc = Object.create(real) as RpcClient
  rpc.getLogs = async (...args: Parameters<RpcClient["getLogs"]>) => {
    await meanwhile()
    return real.getLogs(...args)
  }
  rpc.getTransactions = async (hashes: Hex[]) => {
    await meanwhile()
    return real.getTransactions(hashes)
  }
  return rpc
}

describe("reprojectLegacyRewards when the database ends its connection", {
  timeout: 60_000,
}, () => {
  it("holds no connection while it reads the chain, and reconnects after Neon suspended", async () => {
    const db = await builtBeforeTheDeploy()
    const pool = new EndingPool(db)
    const heldDuringReads: number[] = []
    const rpc = rpcSuspending(BEFORE_CHECKPOINT, async () => {
      heldDuringReads.push(pool.checkedOut)
      await pool.suspend()
    })
    const reconnects: string[] = []
    const result = await reprojectLegacyRewards(pool, rpc, {
      ...OPTIONS,
      apply: true,
      onReconnect: (step, error) => {
        expect(error).toMatchObject({ code: "57P01" })
        reconnects.push(step)
      },
    })

    expect(heldDuringReads.length).toBeGreaterThan(1)
    expect(heldDuringReads.every((held) => held === 0)).toBe(true)
    expect(result).toMatchObject({ logsHandled: 4, applied: true })
    // The idle connection the pool handed back after each suspension was
    // dead: the step after each read reconnected once.
    expect(reconnects).toEqual([
      "look for logs that already have rows",
      "write the rows",
    ])
    expect(pool.opened).toBe(3)
    expect(
      await count(
        db,
        "SELECT count(*)::int AS n FROM matchbox.reward_deposits",
      ),
    ).toBe(3)
    expect(pool.checkedOut).toBe(0)
  })

  it("runs the write transaction again, whole, when its connection ends mid-write", async () => {
    const db = await builtBeforeTheDeploy()
    // Ends after the activity rows and mappings are inserted, before the
    // deposits: the server rolls those inserts back.
    const pool = new EndingPool(
      db,
      endingBefore((text) =>
        text.includes("INSERT INTO matchbox.reward_deposits"),
      ),
    )
    const reconnects: string[] = []
    const result = await reprojectLegacyRewards(
      pool,
      rpcFor(BEFORE_CHECKPOINT),
      {
        ...OPTIONS,
        apply: true,
        onReconnect: (step) => reconnects.push(step),
      },
    )
    expect(reconnects).toEqual(["write the rows"])
    expect(result).toMatchObject({
      alreadyProjected: 0,
      logsHandled: 4,
      activities: 4,
      applied: true,
    })
    // Written once: 3 deposits, 4 activity rows, 2 mappings.
    expect(await rowsWritten(db)).toBe(9)
  })

  it("reconnects only once for a step", async () => {
    const db = await builtBeforeTheDeploy()
    const pool = new EndingPool(
      db,
      endingBefore(
        (text) =>
          text.includes("matchbox.projection_state") &&
          !text.includes("FOR SHARE"),
        2,
      ),
    )
    const reconnects: string[] = []
    await expect(
      reprojectLegacyRewards(pool, rpcFor(BEFORE_CHECKPOINT), {
        ...OPTIONS,
        apply: true,
        onReconnect: (step) => reconnects.push(step),
      }),
    ).rejects.toMatchObject({ code: "57P01" })
    expect(reconnects).toEqual(["read the projection status"])
    expect(pool.opened).toBe(2)
    expect(await rowsWritten(db)).toBe(0)
  })

  it("does not retry a COMMIT whose connection ended, and says to dry-run", async () => {
    const db = await builtBeforeTheDeploy()
    const pool = new EndingPool(
      db,
      endingBefore((text) => text.trim().toUpperCase() === "COMMIT"),
    )
    const reconnects: string[] = []
    const run = reprojectLegacyRewards(pool, rpcFor(BEFORE_CHECKPOINT), {
      ...OPTIONS,
      apply: true,
      onReconnect: (step) => reconnects.push(step),
    })
    await expect(run).rejects.toThrow(CommitOutcomeUnknownError)
    await expect(run).rejects.toThrow(
      /terminating connection due to administrator command.*Run a dry run/,
    )
    expect(reconnects).toEqual([])
    expect(pool.opened).toBe(1)

    // Here the server rolled it back; the dry run shows the rows still
    // missing.
    expect(await rowsWritten(db)).toBe(0)
    const dryRun = await reprojectLegacyRewards(
      pgPool(db),
      rpcFor(BEFORE_CHECKPOINT),
      { ...OPTIONS, apply: false },
    )
    expect(dryRun).toMatchObject({ logsHandled: 4, applied: false })
  })
})
