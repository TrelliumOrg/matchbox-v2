import path from "node:path"
import { z } from "zod"
import { dayOf } from "../../src/scan/transform"
import {
  bump,
  dailyStatements,
  daysSchema,
  jsonRpc,
  logger,
  nowSeconds,
  Pacer,
  parseCommon,
  pointsOf,
  StateFile,
  writeSqlFiles,
} from "./lib"

// (d) Transfers, supply and holders for MEZO, mUSDC, mUSDT and the BTC
// wrappers on Mezo (mSolvBTC, mcbBTC, mbhBTC), from eth_getLogs for
// Transfer on those addresses, 10,000 blocks a window, in block order.
// Logs are rolled up into daily values as they arrive and never kept.
// Mezo's eth_getLogs reports blockTimestamp 0x0, so a window's two end
// headers are read, and when a day boundary falls inside the window, the
// headers of the blocks that hold logs.
//
//   pnpm --filter @matchbox/jobs exec tsx scripts/scan-backfill/erc20-logs.ts \
//     [--from 0] [--to <block>] [--rpc <url>] [--max-requests N] [--write] [--fresh]
//
// Metrics per token: token.transfers, token.transfer_volume, token.minted,
// token.burned and token.holders_replayed (addresses with a positive
// balance at day end), the last three only for tokens in `replayable`. Holders are exact only when the run starts at the
// token's first block (--from 0, the default). Replayed supply is not
// published (token.total_supply comes from totalSupply(), archive-reads);
// --verify compares it with totalSupply() at the end of every 50th window
// and of the run, and stops on a mismatch. It needs --from 0.

const tokens = [
  "0x7b7c000000000000000000000000000000000001", // MEZO
  "0x04671c72aab5ac02a03c1098314b1bb6b560c197", // mUSDC
  "0xeb5a5d39de4ea42c2aa6a57eca2894376683bb8e", // mUSDT
  "0xa10ad2570ea7b93d19fdae6bd7189ff4929bc747", // mSolvBTC
  "0x6a7cd8e1384d49f502b4a4ce9ac9eb320835c5d7", // mcbBTC
  "0xe2232789d4cf5bb1ffada1a105cc59b18d639318", // mbhBTC
] as const
/**
 * Tokens whose whole supply moves through Transfer events, so a replay can
 * give their minted, burned and holders. None of these six: --verify runs
 * on 10 Nov 2026 found MEZO (a precompile) with a genesis supply of
 * 1,000,000,000 and no Transfer for it, and mUSDC first holding supply at
 * block 402,234 with no log of any kind from the contract around it:
 * Mezo's bridge mints these tokens without events. Only their Transfer
 * counts and volume (token.transfers, token.transfer_volume) are
 * published; supply is token.total_supply (archive-reads, live) and
 * holders are Blockscout's token.holders. A token added here must pass
 * --verify from block 0 first.
 */
const replayable = new Set<string>()

const transferTopic =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
const zero = "0x0000000000000000000000000000000000000000"
const window = 10_000

const { values, common } = parseCommon({
  from: { type: "string" },
  to: { type: "string" },
  rpc: { type: "string" },
  verify: { type: "boolean" },
})
const verify = values.verify === true
// The indexer's primary (apps/indexer/src/ingest/networks.ts); all three
// listed there served archive reads in a 10 Nov 2026 probe.
const rpc = values.rpc ?? "https://rpc-internal.mezo.org"

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/)
const logSchema = z.object({
  address: hex,
  topics: z.array(hex),
  data: hex,
  blockNumber: hex,
  logIndex: hex,
})
const headerSchema = z.object({ number: hex, timestamp: hex })

const stateSchema = z.object({
  next: z.number().int(),
  to: z.number().int(),
  days: daysSchema,
  balances: z.record(z.string(), z.record(z.string(), z.string())),
  supply: z.record(z.string(), z.string()),
  openDay: z.string().nullable(),
  logs: z.number().int(),
  windows: z.number().int().default(0),
  /** The block this state's replay started from. */
  startedAt: z.number().int().default(0),
})
type State = z.infer<typeof stateSchema>

const pacer = new Pacer(150)

async function call<Schema extends z.ZodType>(
  method: string,
  params: unknown[],
  schema: Schema,
): Promise<z.output<Schema>> {
  const body = await jsonRpc(
    pacer,
    rpc,
    { jsonrpc: "2.0", id: 1, method, params },
    z.object({ result: schema.optional(), error: z.unknown().optional() }),
  )
  if (body.error !== undefined || body.result === undefined) {
    throw new Error(`${method} failed: ${JSON.stringify(body.error)}`)
  }
  return body.result
}

async function headers(
  blocks: readonly number[],
): Promise<Map<number, number>> {
  const result = new Map<number, number>()
  for (let index = 0; index < blocks.length; index += 50) {
    const batch = blocks.slice(index, index + 50)
    const answers = await jsonRpc(
      pacer,
      rpc,
      batch.map((block, id) => ({
        jsonrpc: "2.0",
        id,
        method: "eth_getBlockByNumber",
        params: [`0x${block.toString(16)}`, false],
      })),
      z.array(z.object({ id: z.number(), result: headerSchema })),
    )
    for (const answer of answers) {
      result.set(Number(answer.result.number), Number(answer.result.timestamp))
    }
  }
  return result
}

async function logsIn(
  from: number,
  to: number,
): Promise<z.infer<typeof logSchema>[]> {
  try {
    return await call(
      "eth_getLogs",
      [
        {
          fromBlock: `0x${from.toString(16)}`,
          toBlock: `0x${to.toString(16)}`,
          address: [...tokens],
          topics: [transferTopic],
        },
      ],
      z.array(logSchema),
    )
  } catch (error) {
    // Too many results for one call: split the range.
    if (to - from < 10) throw error
    const middle = Math.floor((from + to) / 2)
    return [...(await logsIn(from, middle)), ...(await logsIn(middle + 1, to))]
  }
}

function topicAddress(topic: string | undefined): string {
  return `0x${(topic ?? "").slice(-40)}`.toLowerCase()
}

/** Holders at a day's end: positive replayed balances (a level, set). */
function closeDay(state: State, day: string) {
  const bucket = state.days[day] ?? {}
  state.days[day] = bucket
  for (const token of replayable) {
    let holders = 0n
    for (const balance of Object.values(state.balances[token] ?? {})) {
      if (BigInt(balance) > 0n) holders += 1n
    }
    bucket[`token.holders_replayed|${token}`] = holders.toString()
  }
}

/** --verify: replayed supply equals totalSupply() at `block`, per token. */
async function verifySupply(state: State, block: number) {
  for (const token of replayable) {
    const onChain = BigInt(
      await call(
        "eth_call",
        [{ to: token, data: "0x18160ddd" }, `0x${block.toString(16)}`],
        hex,
      ),
    )
    const replayed = BigInt(state.supply[token] ?? "0")
    if (onChain !== replayed) {
      throw new Error(
        `SUPPLY MISMATCH for ${token} at block ${block}: replayed ${replayed}, totalSupply ${onChain}`,
      )
    }
  }
  logger.info({ message: "Replayed supply matches totalSupply()", block })
}

function move(state: State, token: string, holder: string, delta: bigint) {
  if (holder === zero) return
  const balances = state.balances[token] ?? {}
  state.balances[token] = balances
  const next = BigInt(balances[holder] ?? "0") + delta
  if (next === 0n) delete balances[holder]
  else balances[holder] = next.toString()
}

const head = Number(await call("eth_blockNumber", [], hex))
const store = new StateFile<State>(
  path.join(common.out, "erc20-logs"),
  stateSchema,
  () => ({
    next: Number.parseInt(values.from ?? "0", 10),
    to: Number.parseInt(values.to ?? String(head - 10), 10),
    days: {},
    balances: {},
    supply: {},
    openDay: null,
    logs: 0,
    windows: 0,
    startedAt: Number.parseInt(values.from ?? "0", 10),
  }),
)
const state = store.load(common.fresh)
const started = Date.now()
const startBlock = state.next

while (state.next <= state.to && pacer.requests < common.maxRequests) {
  const from = state.next
  const to = Math.min(from + window - 1, state.to)
  const logs = await logsIn(from, to)
  const ends = await headers([from, to])
  const first = dayOf(ends.get(from) ?? 0)
  const last = dayOf(ends.get(to) ?? 0)
  const exact =
    first === last
      ? new Map<number, number>()
      : await headers([...new Set(logs.map((log) => Number(log.blockNumber)))])
  logs.sort((a, b) =>
    Number(a.blockNumber) === Number(b.blockNumber)
      ? Number(a.logIndex) - Number(b.logIndex)
      : Number(a.blockNumber) - Number(b.blockNumber),
  )
  for (const log of logs) {
    const block = Number(log.blockNumber)
    const day = first === last ? first : dayOf(exact.get(block) ?? 0)
    if (state.openDay !== null && day !== state.openDay)
      closeDay(state, state.openDay)
    state.openDay = day
    const token = log.address.toLowerCase()
    const holderFrom = topicAddress(log.topics[1])
    const holderTo = topicAddress(log.topics[2])
    const value = BigInt(log.data === "0x" ? "0" : log.data)
    bump(state.days, day, "token.transfers", token, 1n)
    bump(state.days, day, "token.transfer_volume", token, value)
    if (holderFrom === zero && replayable.has(token)) {
      bump(state.days, day, "token.minted", token, value)
      state.supply[token] = (
        BigInt(state.supply[token] ?? "0") + value
      ).toString()
    }
    if (holderTo === zero && replayable.has(token)) {
      bump(state.days, day, "token.burned", token, value)
      state.supply[token] = (
        BigInt(state.supply[token] ?? "0") - value
      ).toString()
    }
    move(state, token, holderFrom, -value)
    move(state, token, holderTo, value)
  }
  if (logs.length === 0 && first !== last && state.openDay !== null) {
    closeDay(state, state.openDay)
    state.openDay = last
  }
  state.logs += logs.length
  state.next = to + 1
  state.windows = (state.windows ?? 0) + 1
  // The open day is closed (and published) only once a later day starts,
  // so the run's last, partial day is never written as finished.
  store.save(state)
  if (verify && (state.windows % 50 === 0 || state.next > state.to)) {
    if (state.startedAt !== 0) {
      throw new Error("--verify needs a run from block 0 (--from 0 --fresh)")
    }
    await verifySupply(state, to)
  }
}

// Days finished: those before the day of the last block read, whether
// the run reached --to or stopped early.
const lastRead = Math.min(state.next - 1, state.to)
const frontier = dayOf((await headers([lastRead])).get(lastRead) ?? 0)
const output = Object.fromEntries(
  Object.entries(state.days).filter(([day]) => day < frontier),
)
const windows = Math.ceil((state.next - startBlock) / window)
const elapsed = (Date.now() - started) / 1000
const rate = pacer.requests / Math.max(elapsed, 1)
logger.info({
  message:
    state.next > state.to ? "Logs complete" : "Stopped at the request budget",
  rpc,
  blocks: `${startBlock}..${state.next - 1}`,
  logs: state.logs,
  finishedDays: Object.keys(output).length,
  frontier,
  requests: pacer.requests,
  requestsPerSecond: rate.toFixed(2),
  estimatedFullRunWindows: Math.ceil(state.to / window),
  windowsThisRun: windows,
  sample: Object.keys(output)
    .sort()
    .slice(-1)
    .map((day) => ({ day, ...output[day] })),
})
if (common.write) {
  const files = writeSqlFiles(
    path.join(common.out, "erc20-logs"),
    "daily",
    dailyStatements(pointsOf(output), "backfill:erc20-logs", nowSeconds()),
  )
  logger.info({ message: "SQL written", files })
}
