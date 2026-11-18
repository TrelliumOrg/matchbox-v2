import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { type Address, type Hex, isAddress, isHex, toHex } from "viem"
import { z } from "zod"
import { lowerAddressSchema, type RawLog } from "../../src/ingest/rpc"

// Real Mezo mainnet borrow logs (scripts/record-borrow-fixtures.ts) served
// through a fetch() for RpcClient, the way the Mezo RPC serves them: logs
// filtered by address AND topic0, blockTimestamp "0x0", headers and
// transactions by batch.

const hexSchema = z.custom<Hex>(
  (value) => typeof value === "string" && isHex(value),
)
const addressSchema = z.custom<Address>(
  (value) => typeof value === "string" && isAddress(value, { strict: false }),
)
const digitsSchema = z.string().regex(/^\d+$/)

const fixtureSchema = z.object({
  source: z.string(),
  from: digitsSchema,
  to: digitsSchema,
  logs: z.array(
    z.tuple([
      digitsSchema,
      hexSchema,
      digitsSchema,
      hexSchema,
      z.number().int(),
      z.number().int(),
      addressSchema,
      z.array(hexSchema),
      hexSchema,
    ]),
  ),
  transactions: z.record(z.string(), addressSchema),
  expected: z.object({
    markets: z.record(z.string(), z.array(digitsSchema).length(6)),
    morphoBtcBalance: digitsSchema,
    positions: z.record(
      z.string(),
      z.object({
        principal: digitsSchema,
        enclave: addressSchema,
        borrower: addressSchema,
        status: z.number().int(),
        pledgedVeBtc: z.array(digitsSchema),
      }),
    ),
    totalPrincipal: digitsSchema,
  }),
})

export type BorrowFixture = z.output<typeof fixtureSchema> & {
  rawLogs: RawLog[]
}

let cached: BorrowFixture | undefined

export function loadBorrowFixture(): BorrowFixture {
  if (cached) return cached
  const parsed = fixtureSchema.parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL("../fixtures/borrow/mainnet-borrow.json.gz", import.meta.url),
        ),
      ).toString("utf8"),
    ),
  )
  cached = {
    ...parsed,
    rawLogs: parsed.logs.map(
      ([
        block,
        blockHash,
        timestamp,
        txHash,
        txIndex,
        logIndex,
        address,
        topics,
        data,
      ]) => ({
        network: "mezo",
        blockNumber: BigInt(block),
        blockHash,
        blockTimestamp: BigInt(timestamp),
        txHash,
        txIndex,
        logIndex,
        address: lowerAddressSchema.parse(address),
        topics,
        data,
      }),
    ),
  }
  return cached
}

type JsonRpcRequest = { id: number; method: string; params: unknown[] }

const requestSchema = z.object({
  id: z.number(),
  method: z.string(),
  params: z.array(z.unknown()),
})

const filterSchema = z.object({
  fromBlock: hexSchema,
  toBlock: hexSchema,
  address: z.array(z.string()).optional(),
  topics: z
    .array(z.union([z.array(z.string()), z.string(), z.null()]))
    .optional(),
})

export class RecordedChain {
  readonly methods: string[] = []
  private readonly headers = new Map<bigint, { hash: Hex; timestamp: bigint }>()
  private readonly txBlocks = new Map<Hex, { block: bigint; index: number }>()

  constructor(
    private readonly logs: RawLog[],
    private readonly senders: Record<string, Address>,
    private readonly head: bigint,
  ) {
    for (const log of logs) {
      this.headers.set(log.blockNumber, {
        hash: log.blockHash,
        timestamp: log.blockTimestamp,
      })
      this.txBlocks.set(log.txHash, {
        block: log.blockNumber,
        index: log.txIndex,
      })
    }
  }

  get fetch(): typeof fetch {
    const chain = this
    return async function recordedFetch(
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const body: unknown = JSON.parse(String(init?.body))
      const requests = z
        .union([requestSchema, z.array(requestSchema)])
        .parse(body)
      const list = Array.isArray(requests) ? requests : [requests]
      const responses = list.map((request) => ({
        jsonrpc: "2.0",
        id: request.id,
        result: chain.answer(request),
      }))
      return Response.json(Array.isArray(requests) ? responses : responses[0])
    }
  }

  private answer(request: JsonRpcRequest): unknown {
    this.methods.push(request.method)
    switch (request.method) {
      case "eth_blockNumber":
        return toHex(this.head)
      case "eth_getLogs":
        return this.getLogs(filterSchema.parse(request.params[0]))
      case "eth_getBlockByNumber": {
        const block = BigInt(hexSchema.parse(request.params[0]))
        const header = this.headers.get(block)
        if (!header) throw new Error(`No recorded header for block ${block}`)
        return {
          number: toHex(block),
          hash: header.hash,
          timestamp: toHex(header.timestamp),
        }
      }
      case "eth_getTransactionByHash": {
        const hash = hexSchema.parse(request.params[0])
        const from = this.senders[hash]
        const position = this.txBlocks.get(hash)
        if (!from || !position) return null
        return {
          hash,
          blockNumber: toHex(position.block),
          transactionIndex: toHex(position.index),
          from,
          to: null,
          input: "0x",
        }
      }
      default:
        throw new Error(`Unexpected RPC method ${request.method}`)
    }
  }

  private getLogs(filter: z.output<typeof filterSchema>): unknown[] {
    const from = BigInt(filter.fromBlock)
    const to = BigInt(filter.toBlock)
    const addresses = new Set(
      (filter.address ?? []).map((address) => address.toLowerCase()),
    )
    // Each position is ANDed; within one, any listed topic matches; null
    // (or a missing position) matches anything, as eth_getLogs does.
    const positions = (filter.topics ?? []).map((topic) =>
      topic === null
        ? null
        : new Set(
            (Array.isArray(topic) ? topic : [topic]).map((t) =>
              t.toLowerCase(),
            ),
          ),
    )
    return this.logs
      .filter(
        (log) =>
          log.blockNumber >= from &&
          log.blockNumber <= to &&
          addresses.has(log.address) &&
          positions.every(
            (allowed, index) =>
              allowed === null ||
              allowed.has(log.topics[index]?.toLowerCase() ?? ""),
          ),
      )
      .map((log) => ({
        address: log.address,
        topics: log.topics,
        data: log.data,
        blockNumber: toHex(log.blockNumber),
        blockHash: log.blockHash,
        blockTimestamp: "0x0",
        transactionHash: log.txHash,
        transactionIndex: toHex(log.txIndex),
        logIndex: toHex(log.logIndex),
        removed: false,
      }))
  }
}
