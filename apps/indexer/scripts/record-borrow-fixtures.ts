import { writeFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { gzipSync } from "node:zlib"
import {
  BORROW_CONTRACT_KINDS,
  BORROW_CONTRACTS,
  BORROW_INDEXED_EVENTS,
  BORROW_STATIC_CONTRACTS,
  ENCLAVE_DEBT_MANAGER_ABI,
  ERC20_ABI,
  MORPHO_BLUE_ABI,
  MORPHO_MARKETS,
} from "@matchbox/chain"
import { createLogger } from "@matchbox/logger"
import {
  createPublicClient,
  decodeEventLog,
  type Hex,
  http,
  toEventSelector,
} from "viem"
import { blockWindows } from "../src/ingest/ingest"
import { RpcClient } from "../src/ingest/rpc"

// Records test/fixtures/borrow/mainnet-borrow.json.gz: every log the borrow
// stream ingests from the four static borrow contracts up to --to, the
// transactions' senders and the block headers, plus on-chain state read at
// --to to check the decoder's replay against. Read-only RPC; writes nothing
// else.
//
//   pnpm --filter @matchbox/indexer exec tsx scripts/record-borrow-fixtures.ts -- --to 13098469

const logger = createLogger({
  fields: { service: "matchbox-indexer-borrow-fixtures" },
})

const RPC_URL = "https://mainnet.mezo.public.validationcloud.io"

const { values } = parseArgs({
  options: {
    to: { type: "string" },
    out: {
      type: "string",
      default: "test/fixtures/borrow/mainnet-borrow.json.gz",
    },
  },
})

async function main(): Promise<void> {
  if (values.to === undefined) throw new Error("--to is required")
  const to = BigInt(values.to)
  const from = BORROW_STATIC_CONTRACTS.reduce(
    (first, contract) =>
      contract.fromBlock < first ? contract.fromBlock : first,
    to,
  )
  const rpc = new RpcClient({
    network: "mezo",
    endpoints: [{ url: RPC_URL, maxAddresses: 30, maxBlockRange: 10_000 }],
  })

  const windows = blockWindows(from, to, 10_000n)
  const parts: Awaited<ReturnType<RpcClient["getLogsForFilters"]>>[] = []
  let next = 0
  async function worker(): Promise<void> {
    while (next < windows.length) {
      const index = next++
      const window = windows[index]
      if (window === undefined) return
      parts[index] = await rpc.getLogsForFilters(
        window.from,
        window.to,
        BORROW_CONTRACT_KINDS.map((kind) => ({
          addresses: BORROW_STATIC_CONTRACTS.filter(
            (contract) => contract.kind === kind,
          ).map((contract) => contract.address),
          topic0s: BORROW_INDEXED_EVENTS[kind].map((signature) =>
            toEventSelector(signature),
          ),
        })),
      )
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  const logs = parts.flat()
  const transactions = await rpc.getTransactions([
    ...new Set(logs.map((log) => log.txHash)),
  ])

  const client = createPublicClient({ transport: http(RPC_URL) })
  const contracts = BORROW_CONTRACTS.mainnet
  const markets: Record<string, string[]> = {}
  for (const id of Object.values(MORPHO_MARKETS.mainnet)) {
    const market = await client.readContract({
      address: contracts.morphoBlue,
      abi: MORPHO_BLUE_ABI,
      functionName: "market",
      args: [id],
      blockNumber: to,
    })
    markets[id] = market.map((value) => value.toString())
  }
  const morphoBtc = await client.readContract({
    address: contracts.btc,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [contracts.morphoBlue],
    blockNumber: to,
  })

  const positionOpened = toEventSelector(
    BORROW_INDEXED_EVENTS.enclaveDebtManager[0] ?? "",
  )
  const positionIds = new Set<Hex>()
  for (const log of logs) {
    if (log.address !== contracts.enclaveDebtManager.toLowerCase()) continue
    if (log.topics[0] !== positionOpened) continue
    const event = decodeEventLog({
      abi: ENCLAVE_DEBT_MANAGER_ABI,
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
    })
    if (event.eventName === "PositionOpened") {
      positionIds.add(event.args.positionId)
    }
  }
  const positions: Record<string, unknown> = {}
  for (const id of positionIds) {
    const position = await client.readContract({
      address: contracts.enclaveDebtManager,
      abi: ENCLAVE_DEBT_MANAGER_ABI,
      functionName: "getPosition",
      args: [id],
      blockNumber: to,
    })
    positions[id] = {
      principal: position.principal.toString(),
      enclave: position.enclave.toLowerCase(),
      borrower: position.borrower.toLowerCase(),
      status: position.status,
      pledgedVeBtc: position.pledgedVeBtc.map((token) => token.toString()),
    }
  }
  const totalPrincipal = await client.readContract({
    address: contracts.enclaveDebtManager,
    abi: ENCLAVE_DEBT_MANAGER_ABI,
    functionName: "totalPrincipal",
    blockNumber: to,
  })

  const fixture = {
    source: RPC_URL,
    from: from.toString(),
    to: to.toString(),
    logs: logs.map((log) => [
      log.blockNumber.toString(),
      log.blockHash,
      log.blockTimestamp.toString(),
      log.txHash,
      log.txIndex,
      log.logIndex,
      log.address,
      log.topics,
      log.data,
    ]),
    transactions: Object.fromEntries(
      transactions.map((tx) => [tx.hash, tx.from]),
    ),
    expected: {
      markets,
      morphoBtcBalance: morphoBtc.toString(),
      positions,
      totalPrincipal: totalPrincipal.toString(),
    },
  }
  writeFileSync(values.out, gzipSync(JSON.stringify(fixture), { level: 9 }))
  logger.info({
    message: "Recorded borrow fixtures",
    out: values.out,
    logs: logs.length,
    transactions: transactions.length,
    positions: positionIds.size,
  })
}

main().catch((error: unknown) => {
  logger.error({
    message: "Recording borrow fixtures failed",
    error: error instanceof Error ? error.message : String(error),
  })
  process.exitCode = 1
})
