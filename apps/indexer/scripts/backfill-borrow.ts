import { parseArgs } from "node:util"
import { createLogger } from "@matchbox/logger"
import { Pool } from "pg"
import { borrowStatus, ingestBorrowToHead } from "../src/borrow/ingest"
import { PgBorrowStore } from "../src/borrow/pg-store"
import { networkConfig, networkSchema } from "../src/ingest/networks"
import { RpcClient } from "../src/ingest/rpc"
import { loadDirectDatabaseUrl } from "./database"

// pnpm --filter @matchbox/indexer backfill:borrow -- --network mezo \
//   [--replay] [--to N] [--chunk 500000] [--concurrency 4]
//
// Catches the borrow stream (Morpho Blue and Enclaves) up from its
// checkpoint, or from the first borrow contract's creation (block 8,199,414)
// when it has none. The cron does the same 200,000 blocks per tick; this is
// for a first load or after a replay. Resumable: each window commits with
// its checkpoint.
//
// --replay clears the borrow rows, markets, decoder version and checkpoint
// first (discovered Enclaves stay registered), for a borrow decoder version
// bump. Raw logs are not involved: the borrow stream re-reads RPC.
//
// Run against a Neon development branch unless you mean production.

const logger = createLogger({
  fields: { service: "matchbox-indexer-backfill-borrow" },
})

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    network: { type: "string", default: "mezo" },
    replay: { type: "boolean", default: false },
    to: { type: "string" },
    chunk: { type: "string", default: "500000" },
    concurrency: { type: "string", default: "4" },
  },
})

async function main(): Promise<void> {
  const network = networkSchema.parse(values.network)
  const config = networkConfig(network)
  const concurrency = Number.parseInt(values.concurrency ?? "4", 10)
  const chunk = BigInt(values.chunk ?? "500000")
  const pool = new Pool({
    connectionString: loadDirectDatabaseUrl(),
    max: 1,
    application_name: "matchbox-indexer-backfill-borrow",
  })
  const deps = {
    config,
    rpc: new RpcClient({ endpoints: config.endpoints, network }),
    store: new PgBorrowStore(pool),
  }
  try {
    if (values.replay) {
      await deps.store.reset(network)
      logger.info({ message: "Borrow tables cleared for replay", network })
    }
    const head = await deps.rpc.blockNumber()
    const target = values.to ? BigInt(values.to) : head - config.confirmations
    // ingestBorrowToHead treats `head` minus confirmations as its end.
    const end = target + config.confirmations
    for (;;) {
      const summary = await ingestBorrowToHead(deps, chunk, end, concurrency)
      if (summary === null) break
      logger.info({
        message: "Borrow chunk committed",
        network,
        from: summary.from.toString(),
        to: summary.to.toString(),
        logs: summary.logs,
        morphoEvents: summary.morphoEvents,
        enclaveEvents: summary.enclaveEvents,
        contracts: summary.contracts,
      })
    }
    const status = await borrowStatus(deps, end)
    logger.info({
      message: "Borrow backfill done",
      network,
      lastBlock: status.lastBlock?.toString() ?? null,
    })
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  logger.error({
    message: "Borrow backfill failed",
    error: error instanceof Error ? error.message : String(error),
  })
  process.exitCode = 1
})
