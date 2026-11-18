import { writeFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { SCAN_STREAM_TOKENS } from "@matchbox/chain"
import { createLogger } from "@matchbox/logger"
import { type Hex, toHex } from "viem"
import { z } from "zod"
import { networkConfig } from "../src/ingest/networks"
import { RpcClient } from "../src/ingest/rpc"
import { fetchScanWindow } from "../src/scan-stream/ingest"

// Records the scan stream fixtures (test/fixtures/scan-stream) from mainnet
// RPC, read-only: seven 10,000-block windows, chosen to hold every kind of
// row (the PCV bootstrap loan, which is not a fee; trove interest paid by a
// collateral-surplus claim; mbhBTC's first mint; an Enclave repayment's
// mint to PCV;
// borrowing fees with one and two PCV mints, redemptions and interest-only
// mints; a refinancing fee), fetched with the stream's own filters, plus
// each token's totalSupply() at both ends of each window. No secrets, no
// database.
//
//   pnpm --filter @matchbox/indexer exec tsx scripts/record-scan-fixtures.ts

const logger = createLogger({
  fields: { service: "matchbox-indexer-scan-fixtures" },
})

const WINDOWS = [
  170_000n,
  2_690_000n,
  7_630_000n,
  9_090_000n,
  12_820_000n,
  12_830_000n,
  13_040_000n,
]
const OUT = new URL(
  "../test/fixtures/scan-stream/mainnet-scan.json.gz",
  import.meta.url,
)

const resultSchema = z.object({ result: z.string().regex(/^0x[0-9a-f]*$/i) })

async function totalSupply(
  url: string,
  token: string,
  block: bigint,
): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: token, data: "0x18160ddd" }, toHex(block)],
    }),
  })
  const body = resultSchema.parse(await response.json())
  // "0x" before the token was deployed.
  return body.result === "0x" ? "0" : BigInt(body.result).toString()
}

async function main(): Promise<void> {
  const config = networkConfig("mezo")
  const rpc = new RpcClient({ endpoints: config.endpoints, network: "mezo" })
  const url = config.endpoints[0]?.url
  if (url === undefined) throw new Error("No mezo endpoint")
  const logs: [string, Hex, string, Hex, number, number, string, Hex[], Hex][] =
    []
  const supply: Record<string, Record<string, string>> = {}
  for (const from of WINDOWS) {
    const to = from + config.windowSize - 1n
    for (const log of await fetchScanWindow({ rpc }, { from, to })) {
      logs.push([
        log.blockNumber.toString(),
        log.blockHash,
        log.blockTimestamp.toString(),
        log.txHash,
        log.txIndex,
        log.logIndex,
        log.address,
        log.topics,
        log.data,
      ])
    }
    for (const token of SCAN_STREAM_TOKENS) {
      const bounds: Record<string, string> = supply[token.address] ?? {}
      supply[token.address] = bounds
      for (const block of [from - 1n, to]) {
        bounds[block.toString()] = await totalSupply(url, token.address, block)
      }
    }
    logger.info({
      message: "Recorded window",
      from: from.toString(),
      logs: logs.length,
    })
  }
  const fixture = {
    source: `${url}, recorded ${new Date().toISOString()}`,
    windows: WINDOWS.map((from) => from.toString()),
    windowSize: config.windowSize.toString(),
    logs,
    supply,
  }
  writeFileSync(OUT, gzipSync(JSON.stringify(fixture)))
  logger.info({ message: "Wrote scan fixtures", logs: logs.length })
}

main().catch((error: unknown) => {
  logger.error({
    message: "Recording failed",
    error: error instanceof Error ? error.message : String(error),
  })
  process.exitCode = 1
})
