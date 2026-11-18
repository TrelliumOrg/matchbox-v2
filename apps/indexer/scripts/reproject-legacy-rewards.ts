import { parseArgs } from "node:util"
import { createLogger } from "@matchbox/logger"
import { Pool } from "pg"
import type { Address } from "viem"
import { WAREHOUSE_LEGACY_POOL_REWARDS } from "../src/decode/handlers/rewards"
import { reprojectLegacyRewards } from "../src/decode/reproject"
import { networkConfig, networkSchema } from "../src/ingest/networks"
import { lowerAddressSchema, RpcClient } from "../src/ingest/rpc"
import { parsePositiveInteger } from "./cli-args"
import { directDatabaseTarget } from "./database"
import { checkExpectedHost } from "./database-target"

// Writes the rows the projection skipped for Legacy* reward contracts it did
// not know about (src/decode/reproject.ts), without a replay. Dry run unless
// --apply, and --apply needs --expect-host naming the database host the run
// prints first. Defaults to WAREHOUSE_LEGACY_POOL_REWARDS (the sMUSD
// gauge's bribe and fees contracts); --contract names others, repeatable.
//   pnpm --filter @matchbox/indexer reproject:legacy-rewards -- \
//     --network mezo [--contract 0x...] [--concurrency 4] \
//     [--apply --expect-host <host>]
// Deploy the Worker with the same decoder first, or rows for logs after
// this run's checkpoint stay missing until a re-run (which is safe). Never
// run it beside a replay, rebuild or reset; it aborts, writing nothing, if
// one changes the projection under it (apps/indexer/README.md). It holds no
// database connection while it reads RPC (minutes), so Neon suspending the
// idle compute does not end the run; a step whose connection Neon ended runs
// once more on a new one.

const logger = createLogger({
  fields: { service: "matchbox-indexer-reproject" },
})

// pnpm 9 forwards the "--" separator to the script; drop it.
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    network: { type: "string", default: "mezo" },
    contract: { type: "string", multiple: true },
    apply: { type: "boolean", default: false },
    "expect-host": { type: "string" },
    concurrency: { type: "string", default: "4" },
  },
})

async function main(): Promise<void> {
  const network = networkSchema.parse(values.network)
  const config = networkConfig(network)
  const apply = values.apply ?? false
  const concurrency = parsePositiveInteger(
    "--concurrency",
    values.concurrency ?? "4",
  )
  const defaults = values.contract === undefined || values.contract.length === 0
  const contracts: Address[] = defaults
    ? WAREHOUSE_LEGACY_POOL_REWARDS.map(([reward]) => reward)
    : (values.contract ?? []).map((address) =>
        lowerAddressSchema.parse(address),
      )

  // Host and source only; never the URL, which holds the password.
  const target = directDatabaseTarget()
  logger.info({
    message: apply ? "Database to write to" : "Database to read",
    host: target.host,
    variable: target.variable,
    from: target.origin,
  })
  checkExpectedHost(target, values["expect-host"], apply)

  const pool = new Pool({
    connectionString: target.url,
    max: 1,
    // Closes the connection soon after each database step rather than
    // keeping it idle through the RPC reads.
    idleTimeoutMillis: 1_000,
    application_name: "matchbox-indexer-reproject",
  })
  // An idle pooled connection the server ends (Neon suspending the compute)
  // is reported here; without a listener the error would end the process.
  // The pool drops it and the next step opens a new one.
  pool.on("error", (error) => {
    logger.warn({
      message: "An idle database connection ended; the next step reconnects",
      error: error.message,
    })
  })
  const rpc = new RpcClient({ endpoints: config.endpoints, network })
  const startedAt = Date.now()
  try {
    const result = await reprojectLegacyRewards(pool, rpc, {
      network,
      contracts,
      windowSize: config.windowSize,
      concurrency,
      apply,
      onReconnect: (step, error) => {
        logger.warn({
          message:
            "The database ended the connection; running the step again on a new one",
          step,
          error: error instanceof Error ? error.message : String(error),
        })
      },
    })
    for (const deposit of result.deposits) {
      logger.info({
        message: result.applied ? "Deposit written" : "Deposit to write",
        block: deposit.blockNumber.toString(),
        txHash: deposit.txHash,
        rewardContract: deposit.rewardContract,
        rewardType: deposit.rewardType,
        gauge: deposit.gauge,
        pool: deposit.pool,
        token: deposit.token,
        epochStart: deposit.epochStart.toString(),
        amount: deposit.amount.toString(),
      })
    }

    // The default contracts have logs on chain before any checkpoint this
    // can run at, so none fetched means the reads went wrong, never that
    // the rows are already there.
    const emptyContracts = contracts.filter(
      (address) => (result.logsFetchedByContract[address] ?? 0) === 0,
    )
    const summary = {
      network,
      host: target.host,
      contracts,
      from: result.from.toString(),
      through: result.through.toString(),
      decoderVersion: result.decoderVersion,
      windowsRead: result.windowsRead,
      logsFetched: result.logsFetched,
      logsFetchedByContract: result.logsFetchedByContract,
      alreadyProjected: result.alreadyProjected,
      logsHandled: result.logsHandled,
      activities: result.activities,
      deposits: result.deposits.length,
      applied: result.applied,
      seconds: Math.round((Date.now() - startedAt) / 1000),
    }
    if (defaults && emptyContracts.length > 0) {
      logger.error({
        message:
          "Fetched no logs for a contract that has logs on chain: the RPC reads failed, so this run says nothing about what is missing",
        ...summary,
        emptyContracts,
      })
      process.exitCode = 1
      return
    }
    if (emptyContracts.length > 0) {
      logger.warn({
        message:
          "Fetched no logs for some contracts; if they have logs on chain, the RPC reads failed",
        emptyContracts,
      })
    }
    logger.info({
      message: result.applied
        ? "Reprojection applied"
        : result.logsFetched === 0
          ? "Fetched no logs, so wrote nothing"
          : result.logsHandled === 0
            ? "Nothing left to write: every fetched log already has rows"
            : "Dry run: rows to write",
      ...summary,
    })
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  logger.error({
    message: "Reprojection failed",
    error: error instanceof Error ? error.message : String(error),
  })
  process.exitCode = 1
})
