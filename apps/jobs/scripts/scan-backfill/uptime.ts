import path from "node:path"
import { z } from "zod"
import { nextDay } from "../../src/scan/transform"
import {
  cometNode,
  createCometReader,
  defaultUptimeNodes,
  maxBatch,
  type SetEntry,
  secondsOf,
} from "../../src/uptime/comet"
import {
  addBlock,
  type Counts,
  countRows,
  dayOfTime,
  type StoredMember,
} from "../../src/uptime/counts"
import { decodeCommit, type Weighted } from "../../src/uptime/decode"
import { dailyStatements } from "../../src/uptime/poll"
import {
  logger,
  nowSeconds,
  Pacer,
  parseCommon,
  StateFile,
  writeSqlFiles,
} from "./lib"

// Validator uptime per day (uptime_daily) for the past --days complete UTC
// days, rebuilt from the commits of every height on Pathrock's archive
// node, decoded with the poller's own code (src/uptime). Paced gently: one
// batch of 10 commits per --interval-ms (750 ms), on a free community node
// with no stated limits.
//
//   pnpm --filter @matchbox/jobs exec tsx scripts/scan-backfill/uptime.ts \
//     [--days 30] [--rpc <url>] [--rest <url>] [--interval-ms 750] \
//     [--max-requests N] [--write] [--fresh]
//
// About 22,700 heights a day, so 30 days are about 68,000 requests, about
// 14 hours at the default pace: run it over several sittings (it resumes
// from out/uptime/state.json). The SQL only inserts days that are absent or
// incomplete (the poller's first, partial day): a complete day is never
// changed, and applying the file twice changes nothing. Members are named
// with today's PoA module; a validator that has since left is kept under
// its consensus address ('cons:<hex>').

const { values, common } = parseCommon({
  days: { type: "string", default: "30" },
  rpc: { type: "string", default: defaultUptimeNodes.rpc },
  rest: { type: "string", default: defaultUptimeNodes.rest },
  "interval-ms": { type: "string", default: "750" },
})
const days = z.coerce.number().int().min(1).max(400).parse(values.days)
const interval = z.coerce.number().int().min(200).parse(values["interval-ms"])
const node = cometNode(values.rpc, values.rest)
const pacer = new Pacer(interval)
const reader = createCometReader({
  fetcher: (input, init) => pacer.fetch(input, init),
  timeoutMs: 30_000,
  attempts: 1,
})

const headerSchema = z.object({
  result: z.object({
    header: z.object({ height: z.string(), time: z.string() }),
  }),
})

async function timeAt(height: number): Promise<number> {
  const response = await pacer.fetch(`${node.rpc}/header?height=${height}`)
  if (!response.ok) throw new Error(`header ${height}: ${response.status}`)
  return secondsOf(headerSchema.parse(await response.json()).result.header.time)
}

/** The first height whose block time is at or after `at`. */
async function firstHeightAt(
  at: number,
  low: number,
  high: number,
): Promise<number> {
  let lo = low
  let hi = high
  while (hi - lo > 1) {
    const middle = Math.floor((lo + hi) / 2)
    if ((await timeAt(middle)) < at) lo = middle
    else hi = middle
  }
  return hi
}

const countsSchema = z.object({
  blocks: z.number(),
  signed: z.number(),
  missed: z.number(),
  proposed: z.number(),
  proposals_missed: z.number(),
  expected_micro: z.number(),
  unattributed: z.number(),
  first_height: z.number().nullable(),
  last_height: z.number().nullable(),
})

const stateSchema = z.object({
  from: z.number().int(),
  to: z.number().int(),
  next: z.number().int(),
  setHash: z.string().nullable(),
  members: z.array(
    z.object({
      c: z.string(),
      o: z.string().nullable(),
      n: z.string().nullable(),
      p: z.string(),
    }),
  ),
  priorities: z.array(z.string()).nullable(),
  /** {validator key: {day: counts}} */
  counts: z.record(z.string(), z.record(z.string(), countsSchema)),
  rereads: z.number().int(),
})
type State = z.infer<typeof stateSchema>

const today = dayOfTime(nowSeconds())
const firstDay = dayOfTime(nowSeconds() - days * 86_400)
const store = new StateFile<State>(
  path.join(common.out, "uptime"),
  stateSchema,
  () => ({
    from: 0,
    to: 0,
    next: 0,
    setHash: null,
    members: [],
    priorities: null,
    counts: {},
    rereads: 0,
  }),
)
const state = store.load(common.fresh)
const started = Date.now()

if (state.from === 0) {
  const status = await reader.status(node)
  const start = Date.parse(`${firstDay}T00:00:00Z`) / 1000
  const end = Date.parse(`${today}T00:00:00Z`) / 1000
  // Blocks are about 3.8 s apart: start the searches near the answers.
  const guess = (at: number) =>
    Math.max(
      status.earliest,
      status.height - Math.ceil((status.time - at) / 3.8),
    )
  const window = 20_000
  state.from = await firstHeightAt(
    start,
    Math.max(status.earliest, guess(start) - window),
    Math.min(status.height, guess(start) + window),
  )
  state.to =
    (await firstHeightAt(
      end,
      Math.max(status.earliest, guess(end) - window),
      Math.min(status.height, guess(end) + window),
    )) - 1
  state.next = state.from
  store.save(state)
}

const poa = await reader.poaValidators(node)
const named = new Map(poa.map((each) => [each.consensus, each]))

function membersOf(entries: readonly SetEntry[]): State["members"] {
  return entries.map((entry) => ({
    c: entry.address,
    o: named.get(entry.address)?.operator ?? null,
    n: named.get(entry.address)?.moniker ?? null,
    p: entry.power.toString(),
  }))
}

const buckets = new Map<string, Map<string, Counts>>(
  Object.entries(state.counts).map(([key, byDay]) => [
    key,
    new Map(Object.entries(byDay)),
  ]),
)

while (state.next <= state.to && pacer.requests < common.maxRequests) {
  const heights = Array.from(
    { length: Math.min(maxBatch, state.to - state.next + 1) },
    (_, index) => state.next + index,
  )
  const commits = await reader.commits(node, heights)
  for (const commit of commits) {
    let current: bigint[] | null = null
    if (commit.validatorsHash !== state.setHash || state.priorities === null) {
      const entries = await reader.validators(node, commit.height)
      state.setHash = commit.validatorsHash
      state.members = membersOf(entries)
      current = entries.map((entry) => entry.priority)
      state.rereads += 1
    }
    const weighted: Weighted[] = state.members.map((member) => ({
      address: member.c,
      power: BigInt(member.p),
      priority: 0n,
    }))
    const set = { id: 0, members: weighted }
    let decoded =
      current === null
        ? decodeCommit(commit, set, {
            previous: (state.priorities ?? []).map(BigInt),
            current: null,
          })
        : decodeCommit(commit, set, { previous: null, current })
    if (!("record" in decoded)) {
      const entries = await reader.validators(node, commit.height)
      state.rereads += 1
      decoded = decodeCommit(commit, set, {
        previous: null,
        current: entries.map((entry) => entry.priority),
      })
    }
    if (!("record" in decoded)) throw new Error("Unreachable")
    const record = decoded.record
    const stored: StoredMember[] = state.members.map(({ c, o, n }) => ({
      c,
      o,
      n,
    }))
    addBlock(buckets, dayOfTime(record.time), record, stored)
    state.priorities =
      record.priorities?.map((priority) => priority.toString()) ?? null
  }
  state.next += heights.length
  state.counts = Object.fromEntries(
    [...buckets.entries()].map(([key, byDay]) => [
      key,
      Object.fromEntries(byDay.entries()),
    ]),
  )
  if (pacer.requests % 20 === 0 || state.next > state.to) store.save(state)
}
store.save(state)

// Days read to their end: every day before the day of the next height.
const done = state.next > state.to
const rows = countRows(buckets)
const readDays = [...new Set(rows.map((row) => row.bucket))].sort()
const lastFull = done ? (readDays.at(-1) ?? null) : (readDays.at(-2) ?? null)
const complete = rows.filter(
  (row) => lastFull !== null && row.bucket <= lastFull,
)
const chain = complete.filter((row) => row.validator === "")
logger.info({
  message: done ? "Uptime backfill complete" : "Stopped at the request budget",
  node: node.label,
  from: state.from,
  to: state.to,
  next: state.next,
  firstDay,
  lastDayToWrite: lastFull,
  daysComplete: chain.length,
  setReReads: state.rereads,
  requests: pacer.requests,
  elapsedSeconds: Math.round((Date.now() - started) / 1000),
  perDay: chain.map((row) => ({
    day: row.bucket,
    blocks: row.counts.blocks,
    absent: row.counts.missed,
    lateRounds: row.counts.proposals_missed + row.counts.unattributed,
  })),
  nextDayStarts: lastFull === null ? firstDay : nextDay(lastFull),
})
if (common.write) {
  const files = writeSqlFiles(
    path.join(common.out, "uptime"),
    "uptime",
    dailyStatements(complete, {
      complete: true,
      source: "backfill:uptime",
      nowSeconds: nowSeconds(),
    }),
  )
  logger.info({ message: "SQL written", files })
}
