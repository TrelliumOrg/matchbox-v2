import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { createLogger } from "@matchbox/logger"
import {
  type Address,
  createPublicClient,
  type Hex,
  http,
  parseAbiItem,
  toEventSelector,
} from "viem"
import { CORE_START_BLOCK } from "../src/decode/dispatch"
import { networkConfig } from "../src/ingest/networks"
import { enumerationProblems } from "./legacy-gauges-complete"

// Records every GaugeCreated the four voters emitted before the explorer's
// start block (7,739,500), for test/decode/legacy-gauges.test.ts, which
// fails when the decoder would skip a gauge's reward contracts. Read-only:
// eth_getCode (each voter's first block with code, by bisection),
// eth_getLogs in 10,000-block windows from the network start, and each
// voter's length() at the last block, which must equal the GaugeCreated
// logs found for it, or nothing is written.
//   pnpm --filter @matchbox/indexer exec tsx scripts/record-legacy-gauges.ts \
//     [--rpc https://...]
// About five minutes on the public ValidationCloud endpoint.

const logger = createLogger({
  fields: { service: "matchbox-indexer-record-legacy-gauges" },
})

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    rpc: {
      type: "string",
      default: "https://mainnet.mezo.public.validationcloud.io",
    },
    out: {
      type: "string",
      default: fileURLToPath(
        new URL(
          "../test/fixtures/legacy-gauges/gauge-created.json",
          import.meta.url,
        ),
      ),
    },
  },
})

const VOTERS: Record<string, Address> = {
  PoolsVoter: "0x48233ccc97b87ba93bca212cbee48e3210211f03",
  BoostVoter: "0x2ba614a598cffa5a19d683cdca97bac3a49313d1",
  ThirdPartyVoter: "0x2e6d2f2cacc1d24f9f9358030674eb307397a6eb",
  ValidatorsVoter: "0xe99a9ad5ed26bd30e4db25397f378817e9b9515a",
}

const TOPICS: Hex[] = [
  toEventSelector(
    parseAbiItem(
      "event GaugeCreated(address indexed poolFactory, address indexed votingRewardsFactory, address indexed gaugeFactory, address pool, address bribeVotingReward, address feeVotingReward, address gauge, address creator)",
    ),
  ),
  toEventSelector(
    parseAbiItem(
      "event GaugeCreated(address indexed gauge, address indexed bribeVotingReward, address indexed creator)",
    ),
  ),
]

const LENGTH_ABI = [parseAbiItem("function length() view returns (uint256)")]

const WINDOW = 10_000n

async function main(): Promise<void> {
  const client = createPublicClient({
    transport: http(values.rpc, { retryCount: 6, timeout: 60_000 }),
  })
  const from = networkConfig("mezo").startBlock
  const to = CORE_START_BLOCK - 1n

  const deployBlocks: Record<string, string> = {}
  for (const [name, address] of Object.entries(VOTERS)) {
    let low = 0n
    let high = await client.getBlockNumber()
    while (low < high) {
      const mid = (low + high) / 2n
      const code = await client.getCode({ address, blockNumber: mid })
      if (code !== undefined && code !== "0x") high = mid
      else low = mid + 1n
    }
    deployBlocks[name] = low.toString()
  }

  const logs = []
  for (let start = from; start <= to; start += WINDOW) {
    // biome-ignore lint/complexity/useMathMinMax: Math.min takes no bigints.
    const end = start + WINDOW - 1n < to ? start + WINDOW - 1n : to
    const found = await client.request({
      method: "eth_getLogs",
      params: [
        {
          address: Object.values(VOTERS),
          topics: [TOPICS],
          fromBlock: `0x${start.toString(16)}`,
          toBlock: `0x${end.toString(16)}`,
        },
      ],
    })
    for (const log of found) {
      logs.push({
        address: log.address.toLowerCase(),
        blockNumber: BigInt(log.blockNumber ?? "0x0").toString(),
        txHash: log.transactionHash,
        logIndex: Number(BigInt(log.logIndex ?? "0x0")),
        topics: log.topics,
        data: log.data,
      })
    }
  }
  logs.sort(
    (left, right) =>
      Number(BigInt(left.blockNumber) - BigInt(right.blockNumber)) ||
      left.logIndex - right.logIndex,
  )

  // An independent check that the enumeration is complete
  // (legacy-gauges-complete.ts). All four voters answer length();
  // ThirdPartyVoter's is not in our ABI, but the contract has it.
  const lengths: Record<string, bigint> = {}
  for (const [name, address] of Object.entries(VOTERS)) {
    lengths[name] = await client.readContract({
      address,
      abi: LENGTH_ABI,
      functionName: "length",
      blockNumber: to,
    })
  }
  const problems = enumerationProblems({
    voters: VOTERS,
    deployBlocks: Object.fromEntries(
      Object.entries(deployBlocks).map(([name, block]) => [
        name,
        BigInt(block),
      ]),
    ),
    lengths,
    fromBlock: from,
    toBlock: to,
    logs,
  })
  if (problems.length > 0) {
    throw new Error(
      `The GaugeCreated logs found are incomplete, so the fixture was not written: ${problems.join("; ")}`,
    )
  }
  const gaugeCounts = Object.fromEntries(
    Object.entries(lengths).map(([name, length]) => [name, length.toString()]),
  )

  const fixture = {
    recordedAt: new Date().toISOString().slice(0, 10),
    rpc: values.rpc,
    fromBlock: from.toString(),
    toBlock: to.toString(),
    voters: VOTERS,
    deployBlocks,
    logs,
  }
  writeFileSync(values.out, `${JSON.stringify(fixture, null, 2)}\n`)
  logger.info({
    message: "Recorded GaugeCreated logs",
    out: values.out,
    logs: logs.length,
    deployBlocks,
    gaugeCounts,
  })
}

main().catch((error: unknown) => {
  logger.error({
    message: "Recording failed",
    error: error instanceof Error ? error.message : String(error),
  })
  process.exitCode = 1
})
