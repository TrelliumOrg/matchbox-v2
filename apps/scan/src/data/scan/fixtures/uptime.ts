import { demoGaugeDetails } from "@matchbox/contracts/read-models/fixtures"
import type {
  ScanUptime,
  ScanUptimeStatus,
  ScanUptimeWindow,
  ScanValidatorUptime,
} from "@matchbox/contracts/scan"
import {
  type FixtureRoute,
  type FixtureScenario,
  fixtureNow,
  ok,
} from "./shared"
import { matchedProposer, unmatchedProposer } from "./validators"

/**
 * `/uptime` and `/validators/{address}/uptime` (validator signing from
 * CometBFT commits, apps/api README "Validator uptime"). Northfield Nodes
 * signs every block, Harbor Stake (the matched proposer) missed 12 of the
 * last day's, the unmatched proposer is down. `filling` answers as before
 * the first count (`not_started`), `delayed` as a node that is behind.
 */

const northfield = (
  demoGaugeDetails.northfieldNodes.operator ?? ""
).toLowerCase()
const height = 13_078_795
const blocksPerDay = 22_736

function status(scenario: FixtureScenario): ScanUptimeStatus {
  if (scenario === "filling") {
    return {
      state: "not_started",
      source: null,
      height: null,
      block_time: null,
      read_at: null,
      behind_blocks: null,
    }
  }
  const behind = scenario === "delayed"
  return {
    state: behind ? "behind" : "live",
    source: "pathrock",
    height: behind ? height - 600 : height,
    block_time: behind ? fixtureNow - 2_400 : fixtureNow - 120,
    read_at: fixtureNow - 60,
    behind_blocks: behind ? 600 : 3,
  }
}

function window(
  days: number,
  missed: number,
  proposed: number,
  proposalsMissed: number,
): ScanUptimeWindow {
  const blocks = blocksPerDay * days
  return {
    blocks,
    signed: blocks - missed,
    missed,
    proposed,
    proposals_missed: proposalsMissed,
    expected_micro: Math.round((blocks * 1_000_000) / 21),
    uptime_bps: Math.floor(((blocks - missed) * 10_000) / blocks),
    from: fixtureNow - days * 86_400,
    complete: days < 30,
  }
}

const validators = [
  {
    address: northfield,
    consensus: "5C9870C6D9240761106AC0BB51C7AD2140D891AB",
    moniker: "Northfield Nodes",
    windows: {
      d1: window(1, 0, 1_090, 0),
      d7: window(7, 3, 7_620, 0),
      d30: window(30, 68, 32_660, 2),
    },
  },
  {
    address: matchedProposer,
    consensus: "DCBAD12EE8A9B0298705F8DE15726F869B8F2408",
    moniker: "Harbor Stake",
    windows: {
      d1: window(1, 12, 1_080, 1),
      d7: window(7, 40, 7_590, 2),
      d30: window(30, 160, 32_480, 5),
    },
  },
  {
    address: unmatchedProposer,
    consensus: "B287F0DA423C6AC2054FE3969B8853F4040D81A0",
    moniker: null,
    windows: {
      d1: window(1, blocksPerDay, 0, 1_083),
      d7: window(7, blocksPerDay * 7, 0, 7_580),
      d30: window(30, blocksPerDay * 30, 0, 32_480),
    },
  },
]

export function uptimeAnswer(scenario: FixtureScenario): ScanUptime {
  const current = status(scenario)
  if (current.height === null) {
    return { data: { status: current, latest: null, validators: [] } }
  }
  return {
    data: {
      status: current,
      latest: {
        height: current.height,
        time: current.block_time ?? fixtureNow,
        round: 0,
        signing: 20,
        of: 21,
      },
      validators: validators.map((each) => ({ ...each, in_set: true })),
    },
  }
}

export function validatorUptimeAnswer(
  address: string,
  scenario: FixtureScenario,
): ScanValidatorUptime {
  const current = status(scenario)
  const validator = validators.find((each) => each.address === address)
  const known = validator !== undefined && current.height !== null
  const top = current.height ?? height
  return {
    data: {
      status: current,
      address,
      consensus: validator?.consensus ?? null,
      moniker: validator?.moniker ?? null,
      in_set: validator !== undefined,
      windows: known ? validator.windows : null,
      strip: !known
        ? []
        : Array.from({ length: 100 }, (_, index) => {
            const at = top - index
            const down = address === unmatchedProposer
            const missed =
              down || (address === matchedProposer && index % 37 === 5)
            return {
              height: at,
              time: (current.block_time ?? fixtureNow) - index * 4,
              state: missed ? ("missed" as const) : ("signed" as const),
              proposed: !down && at % 21 === (address === northfield ? 3 : 7),
              missed_proposal: down && at % 21 === 11,
            }
          }),
      last_signed:
        !known || address !== unmatchedProposer
          ? known
            ? { at: fixtureNow - (fixtureNow % 3_600), precision: "hour" }
            : null
          : {
              at: fixtureNow - 9 * 86_400 - (fixtureNow % 86_400),
              precision: "day",
            },
    },
  }
}

export const uptimeFixtures: FixtureRoute[] = [
  {
    pattern: /^uptime$/,
    answer: (_match, _query, scenario) => ok(uptimeAnswer(scenario)),
  },
  {
    pattern: /^validators\/(0x[0-9a-f]{40})\/uptime$/,
    answer: (match, _query, scenario) =>
      ok(validatorUptimeAnswer(match[1] ?? "", scenario)),
  },
]
