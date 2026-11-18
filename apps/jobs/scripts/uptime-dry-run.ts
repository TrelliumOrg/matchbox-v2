import { parseArgs } from "node:util"
import { createLogger } from "@matchbox/logger"
import { z } from "zod"
import {
  type CometNode,
  cometNode,
  createCometReader,
  defaultUptimeNodes,
  maxBatch,
} from "../src/uptime/comet"
import {
  addBlock,
  type Counts,
  chainKey,
  type StoredMember,
  validatorKey,
} from "../src/uptime/counts"
import {
  type BlockRecord,
  type Commit,
  type DecodeResult,
  decodeCommit,
  type Weighted,
} from "../src/uptime/decode"

// What the uptime poller would store for the last N heights, read from the
// real nodes and decoded with the poller's own code, printed per validator.
// Nothing is written anywhere.
//
//   pnpm --filter @matchbox/jobs exec tsx scripts/uptime-dry-run.ts \
//     [--heights 200] [--rpc <url>] [--rest <url>]

const logger = createLogger()
const { values } = parseArgs({
  options: {
    heights: { type: "string", default: "200" },
    rpc: { type: "string", default: defaultUptimeNodes.rpc },
    rest: { type: "string", default: defaultUptimeNodes.rest },
  },
})
const count = z.coerce.number().int().min(2).max(2_000).parse(values.heights)
const node: CometNode = cometNode(values.rpc, values.rest)

// Gentle on a free community node: one request at a time, 400 ms apart.
let last = 0
async function paced(input: string, init?: RequestInit): Promise<Response> {
  const gap = last + 400 - Date.now()
  if (gap > 0) await new Promise((resolve) => setTimeout(resolve, gap))
  last = Date.now()
  return fetch(input, init)
}
const reader = createCometReader({
  fetcher: paced,
  timeoutMs: 20_000,
  attempts: 4,
  backoffMs: 1_000,
})

const status = await reader.status(node)
const to = status.height - 1
const from = to - count + 1
const entries = await reader.validators(node, from)
const poa = await reader.poaValidators(node)
const byConsensus = new Map(poa.map((each) => [each.consensus, each]))
const members: StoredMember[] = entries.map((entry) => ({
  c: entry.address,
  o: byConsensus.get(entry.address)?.operator ?? null,
  n: byConsensus.get(entry.address)?.moniker ?? null,
}))
const weighted: Weighted[] = entries.map(({ address, power }) => ({
  address,
  power,
  priority: 0n,
}))
const set = { id: 1, members: weighted }

const commits: Commit[] = []
for (let height = from; height <= to; height += maxBatch) {
  const batch = Array.from(
    { length: Math.min(maxBatch, to - height + 1) },
    (_, index) => height + index,
  )
  commits.push(...(await reader.commits(node, batch)))
}

const records: BlockRecord[] = []
let priorities: bigint[] | null = null
let resyncs = 0
for (const commit of commits) {
  if (commit.validatorsHash !== commits[0]?.validatorsHash) {
    throw new Error(`The set changed at ${commit.height}; rerun later`)
  }
  let decoded: DecodeResult =
    priorities === null
      ? decodeCommit(commit, set, {
          previous: null,
          current: entries.map((entry) => entry.priority),
        })
      : decodeCommit(commit, set, { previous: priorities, current: null })
  if (!("record" in decoded)) {
    resyncs += 1
    const fresh = await reader.validators(node, commit.height)
    decoded = decodeCommit(commit, set, {
      previous: null,
      current: fresh.map((entry) => entry.priority),
    })
  }
  if (!("record" in decoded)) throw new Error("Unreachable")
  records.push(decoded.record)
  priorities = decoded.record.priorities
}

const counts = new Map<string, Map<string, Counts>>()
for (const record of records) addBlock(counts, "run", record, members)

function pct(part: number, whole: number): string {
  return whole === 0 ? "n/a" : `${((part * 100) / whole).toFixed(2)}%`
}

const rows = members.map((member) => {
  const each = counts.get(validatorKey(member))?.get("run")
  return {
    moniker: member.n ?? "(unnamed)",
    operator: member.o ?? `cons:${member.c}`,
    signed: each?.signed ?? 0,
    missed: each?.missed ?? 0,
    uptime: pct(each?.signed ?? 0, each?.blocks ?? 0),
    proposed: each?.proposed ?? 0,
    proposalsMissed: each?.proposals_missed ?? 0,
    share: pct(each?.proposed ?? 0, records.length),
    expected: pct(each?.expected_micro ?? 0, records.length * 1_000_000),
  }
})
console.table(rows)
const chain = counts.get(chainKey)?.get("run")
const absent = new Map<string, number[]>()
for (const record of records) {
  members.forEach((member, index) => {
    if (((record.signed >> BigInt(index)) & 1n) === 0n) {
      const name = member.n ?? member.c
      absent.set(name, [...(absent.get(name) ?? []), record.height])
    }
  })
}
logger.info({
  message: "Uptime dry run (nothing written)",
  node: node.label,
  from,
  to,
  heights: records.length,
  setSize: members.length,
  unnamedMembers: members.filter((member) => member.o === null).length,
  lateRounds: records
    .filter((record) => record.round > 0)
    .map((record) => ({
      height: record.height,
      round: record.round,
      proposer: members[record.proposer]?.n ?? null,
      missedProposal:
        record.missed?.map((index) => members[index]?.n ?? null) ?? "unknown",
    })),
  proposerOrderReReads: resyncs,
  signaturesAbsent: chain?.missed ?? 0,
  absentBy: Object.fromEntries(
    [...absent.entries()].map(([name, heights]) => [
      name,
      heights.length > 5
        ? `${heights.length} blocks`
        : heights.map(String).join(" "),
    ]),
  ),
})
