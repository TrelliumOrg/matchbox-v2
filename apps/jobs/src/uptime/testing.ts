import { z } from "zod"
import fixtureJson from "../../test/fixtures/uptime/mainnet-13171500.json"
import {
  type CometNode,
  type CometReader,
  commitOf,
  commitResultSchema,
  poaValidatorsOf,
  poaValidatorsSchema,
  secondsOf,
  validatorsResultSchema,
} from "./comet"
import type { Commit } from "./decode"

// Real responses from Pathrock's archive node (heights 13,171,500 to
// 13,171,525, 12 Nov 2026), and a reader that replays them.

const fixtureSchema = z.object({
  status: z.object({
    result: z.object({
      sync_info: z.object({
        latest_block_height: z.string(),
        latest_block_time: z.string(),
        earliest_block_height: z.string(),
        catching_up: z.boolean(),
      }),
    }),
  }),
  poa: poaValidatorsSchema,
  validators: z.record(z.string(), validatorsResultSchema),
  commits: z.array(commitResultSchema),
})

export const fixture = fixtureSchema.parse(fixtureJson)
export const fixtureCommits: Commit[] = fixture.commits.map(commitOf)
export const fixturePoa = poaValidatorsOf(fixture.poa)

export function fixtureSet(height: number) {
  const body = fixture.validators[String(height)]
  if (body === undefined) throw new Error(`No set at ${height} in the fixture`)
  return body.result.validators.map((validator) => ({
    address: validator.address,
    power: BigInt(validator.voting_power),
    priority: BigInt(validator.proposer_priority),
    pubKey: validator.pub_key.value,
  }))
}

export const imperator = "0x3c67d8020bf8aa75542f65e8152f74086be71f20"
export const imperatorConsensus = "B287F0DA423C6AC2054FE3969B8853F4040D81A0"
export const arashausConsensus = "DCBAD12EE8A9B0298705F8DE15726F869B8F2408"

export type FakeReaderCalls = {
  status: number
  commits: number[][]
  validators: number[]
  poa: number
}

/** A CometReader over the fixture; `tip` is the head /status reports. */
export function fixtureReader(options: {
  tip: number
  failCommits?: (node: CometNode) => boolean
}): { reader: CometReader; calls: FakeReaderCalls } {
  const calls: FakeReaderCalls = {
    status: 0,
    commits: [],
    validators: [],
    poa: 0,
  }
  const info = fixture.status.result.sync_info
  const reader: CometReader = {
    async status() {
      calls.status += 1
      return {
        height: options.tip,
        time: secondsOf(info.latest_block_time),
        earliest: Number(info.earliest_block_height),
        catchingUp: false,
      }
    },
    async commits(node, heights) {
      calls.commits.push([...heights])
      if (options.failCommits?.(node) === true) throw new Error("node down")
      return heights.map((height) => {
        const commit = fixtureCommits.find((each) => each.height === height)
        if (commit === undefined) throw new Error(`No commit ${height}`)
        return commit
      })
    },
    async validators(_node, height) {
      calls.validators.push(height)
      return fixtureSet(height)
    },
    async poaValidators() {
      calls.poa += 1
      return fixturePoa
    },
  }
  return { reader, calls }
}
