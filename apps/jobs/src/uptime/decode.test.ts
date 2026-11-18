import { describe, expect, it } from "vitest"
import { createCometReader } from "./comet"
import {
  addBlock,
  blockRow,
  type Counts,
  chainKey,
  type StoredMember,
  validatorKey,
} from "./counts"
import {
  type BlockRecord,
  consensusAddressOf,
  type DecodeResult,
  decodeCommit,
  incrementPriorities,
  SetMismatchError,
  signedAt,
} from "./decode"
import {
  arashausConsensus,
  fixture,
  fixtureCommits,
  fixturePoa,
  fixtureSet,
  imperator,
  imperatorConsensus,
} from "./testing"

// Decoding against real responses recorded from Pathrock's archive node
// (test/fixtures/uptime, heights 13,171,500 to 13,171,525).

const first = fixtureCommits[0]?.height ?? 0
const last = fixtureCommits.at(-1)?.height ?? 0

describe("addresses", () => {
  it("names every member of the set from the PoA module", () => {
    const set = fixtureSet(first)
    expect(set).toHaveLength(21)
    expect(fixturePoa).toHaveLength(21)
    const named = new Map(fixturePoa.map((each) => [each.consensus, each]))
    for (const member of set) {
      expect(consensusAddressOf(member.pubKey)).toBe(member.address)
      expect(named.has(member.address)).toBe(true)
    }
  })

  it("maps Imperator.co's keys to its operator, the EVM miner", () => {
    const imperatorEntry = fixturePoa.find(
      (each) => each.operator === imperator,
    )
    expect(imperatorEntry).toEqual({
      operator: imperator,
      consensus: imperatorConsensus,
      moniker: "Imperator.co",
    })
  })
})

describe("proposer selection", () => {
  it("steps each height's priorities into the next height's", () => {
    for (let height = first + 1; height <= last; height += 1) {
      const stepped = incrementPriorities(fixtureSet(height - 1), 1)
      expect(stepped.set.map((member) => member.priority)).toEqual(
        fixtureSet(height).map((member) => member.priority),
      )
    }
  })

  it("picks the header's proposer on round-0 blocks and the next pick on round 1", () => {
    let rounds = 0
    for (const commit of fixtureCommits.slice(1)) {
      const stepped = incrementPriorities(fixtureSet(commit.height - 1), 1)
      if (commit.round === 0) {
        expect(stepped.proposer).toBe(commit.proposer)
      } else {
        rounds += 1
        expect(stepped.proposer).toBe(imperatorConsensus)
        expect(incrementPriorities(stepped.set, 1).proposer).toBe(
          commit.proposer,
        )
        expect(commit.proposer).toBe(arashausConsensus)
      }
    }
    expect(rounds).toBe(2)
  })
})

function decodeAll(): BlockRecord[] {
  const weighted = fixtureSet(first).map(({ address, power }) => ({
    address,
    power,
    priority: 0n,
  }))
  const set = { id: 7, members: weighted }
  const records: BlockRecord[] = []
  let priorities: bigint[] | null = null
  for (const commit of fixtureCommits) {
    const decoded: DecodeResult =
      priorities === null
        ? decodeCommit(commit, set, {
            previous: null,
            current: fixtureSet(commit.height).map((each) => each.priority),
          })
        : decodeCommit(commit, set, { previous: priorities, current: null })
    if (!("record" in decoded)) throw new Error(`Resync at ${commit.height}`)
    records.push(decoded.record)
    priorities = decoded.record.priorities
  }
  return records
}

function members(): StoredMember[] {
  const named = new Map(fixturePoa.map((each) => [each.consensus, each]))
  return fixtureSet(first).map((entry) => ({
    c: entry.address,
    o: named.get(entry.address)?.operator ?? null,
    n: named.get(entry.address)?.moniker ?? null,
  }))
}

describe("decodeCommit", () => {
  const records = decodeAll()
  const set = members()
  const imperatorIndex = set.findIndex((member) => member.o === imperator)

  it("decodes every height without re-reading the set", () => {
    expect(records).toHaveLength(26)
    for (const [index, record] of records.entries()) {
      expect(record.priorities).toEqual(
        fixtureSet(record.height).map((each) => each.priority),
      )
      expect(record.height).toBe(first + index)
    }
  })

  it("finds Imperator.co absent from every commit", () => {
    for (const record of records) {
      expect(signedAt(blockRow(record).signed, imperatorIndex)).toBe(false)
      expect(record.signers).toBeLessThanOrEqual(20)
    }
  })

  it("names Imperator.co as the round-0 proposer of the late blocks", () => {
    const late = records.filter((record) => record.round > 0)
    expect(late.map((record) => record.height)).toEqual([13171503, 13171524])
    for (const record of late) {
      expect(record.missed).toEqual([imperatorIndex])
      expect(set[record.proposer]?.n).toBe("arashaus")
      expect(blockRow(record).missed).toBe(String(imperatorIndex))
    }
    expect(
      records
        .filter((record) => record.round === 0)
        .every((record) => record.missed?.length === 0),
    ).toBe(true)
  })

  it("leaves the missed proposer unknown when the set was read at a late block", () => {
    const commit = fixtureCommits.find((each) => each.height === 13171503)
    if (commit === undefined) throw new Error("fixture")
    const weighted = fixtureSet(commit.height)
    const decoded = decodeCommit(
      commit,
      { id: 1, members: weighted },
      {
        previous: null,
        current: weighted.map((each) => each.priority),
      },
    )
    expect("record" in decoded && decoded.record.missed).toBeNull()
  })

  it("asks for a re-read when stepping disagrees with a round-0 header", () => {
    const commit = fixtureCommits.find((each) => each.height === 13171510)
    if (commit === undefined) throw new Error("fixture")
    const weighted = fixtureSet(commit.height)
    const wrong = fixtureSet(13171500).map((each) => each.priority)
    expect(
      decodeCommit(
        commit,
        { id: 1, members: weighted },
        { previous: wrong, current: null },
      ),
    ).toEqual({ resync: true })
  })

  it("refuses a set whose order differs from the signatures", () => {
    const commit = fixtureCommits[0]
    if (commit === undefined) throw new Error("fixture")
    const reversed = [...fixtureSet(first)].reverse()
    expect(() =>
      decodeCommit(
        commit,
        { id: 1, members: reversed },
        { previous: null, current: reversed.map((each) => each.priority) },
      ),
    ).toThrow(SetMismatchError)
  })
})

describe("counts", () => {
  it("adds up signatures, absences and proposals per validator", () => {
    const records = decodeAll()
    const set = members()
    const buckets = new Map<string, Map<string, Counts>>()
    for (const record of records) addBlock(buckets, "day", record, set)
    const imperatorCounts = buckets.get(imperator)?.get("day")
    expect(imperatorCounts).toMatchObject({
      blocks: 26,
      signed: 0,
      missed: 26,
      proposed: 0,
      proposals_missed: 2,
      expected_micro: 26 * 47_619,
      first_height: first,
      last_height: last,
    })
    const chain = buckets.get(chainKey)?.get("day")
    const absences = records.reduce(
      (sum, record) => sum + 21 - record.signers,
      0,
    )
    expect(chain).toMatchObject({
      blocks: 26,
      proposed: 26,
      missed: absences,
      signed: 26 * 21 - absences,
      proposals_missed: 2,
      unattributed: 0,
    })
    const proposed = set.reduce(
      (sum, member) =>
        sum + (buckets.get(validatorKey(member))?.get("day")?.proposed ?? 0),
      0,
    )
    expect(proposed).toBe(26)
  })

  it("keys an unnamed member by its consensus address", () => {
    expect(validatorKey({ c: "AB".repeat(20), o: null, n: null })).toBe(
      `cons:${"ab".repeat(20)}`,
    )
  })
})

describe("createCometReader", () => {
  function fetcher(
    respond: (url: string, init?: RequestInit) => unknown,
  ): (url: string, init?: RequestInit) => Promise<Response> {
    return async (url, init) => Response.json(respond(url, init))
  }

  it("reads a batch of commits in height order", async () => {
    const reader = createCometReader({
      fetcher: fetcher((_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          id: number
          params: { height: string }
        }[]
        return body
          .map((request) => ({
            jsonrpc: "2.0",
            id: request.id,
            result: fixture.commits.find(
              (each) =>
                each.signed_header.header.height === request.params.height,
            ),
          }))
          .reverse()
      }),
    })
    const node = { label: "pathrock", rpc: "https://x", rest: "https://y" }
    const commits = await reader.commits(node, [13171503, 13171504])
    expect(commits.map((each) => [each.height, each.round])).toEqual([
      [13171503, 1],
      [13171504, 0],
    ])
    const time = fixture.commits[3]?.signed_header.header.time ?? ""
    expect(commits[0]?.time).toBe(Date.parse(`${time.slice(0, 19)}Z`) / 1000)
  })

  it("retries a 5xx with backoff, then gives up", async () => {
    let calls = 0
    const reader = createCometReader({
      fetcher: async () => {
        calls += 1
        return new Response("busy", { status: 503 })
      },
      attempts: 3,
      backoffMs: 1,
    })
    await expect(
      reader.status({ label: "pathrock", rpc: "https://x", rest: "https://y" }),
    ).rejects.toThrow("answered 503")
    expect(calls).toBe(3)
  })

  it("reads the status, the set and the PoA validators", async () => {
    const reader = createCometReader({
      fetcher: fetcher((url) =>
        url.endsWith("/status")
          ? fixture.status
          : url.includes("/validators?height=13171500")
            ? fixture.validators["13171500"]
            : fixture.poa,
      ),
    })
    const node = { label: "pathrock", rpc: "https://x", rest: "https://y" }
    expect(await reader.status(node)).toMatchObject({
      earliest: 1,
      catchingUp: false,
    })
    expect(await reader.validators(node, 13171500)).toHaveLength(21)
    expect(await reader.poaValidators(node)).toHaveLength(21)
  })
})
