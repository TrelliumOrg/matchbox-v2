import {
  BOOST_VOTER_ABI,
  POOLS_VOTER_ABI,
  VALIDATORS_VOTER_ABI,
  ZERO_ADDRESS,
} from "@matchbox/chain"
import type { VoteBranch } from "@matchbox/stuart-ui/contract"
import {
  type Address,
  type ContractFunctionParameters,
  getAddress,
  keccak256,
  toHex,
} from "viem"
import { addressSchema, type MezoClient, multicallParsed } from "./rpc"
import { voterFor } from "./voting"

// Mezo RPC: the API read models name gauges but not the voters' reward
// contracts (claims pass bribe and fee contracts) or the pool behind a pool
// gauge (PoolsVoter votes take the pool). One multicall per voting domain.

export type RewardContracts = {
  bribe: Address | null
  fees: Address | null
  // The vote target for a pool gauge; null for boost and validator gauges.
  pool: Address | null
}

export type RewardContractResolver = (
  branch: VoteBranch,
  gauges: readonly Address[],
) => Promise<Map<string, RewardContracts>>

function abiFor(branch: VoteBranch) {
  if (branch === "boost") return BOOST_VOTER_ABI
  if (branch === "validators") return VALIDATORS_VOTER_ABI
  return POOLS_VOTER_ABI
}

function live(value: Address | null | undefined): Address | null {
  return value === null || value === undefined || value === ZERO_ADDRESS
    ? null
    : value
}

export function rpcRewardContracts(client: MezoClient): RewardContractResolver {
  return async function resolve(branch, gauges) {
    const voter = voterFor(branch)
    const abi = abiFor(branch)
    function call(
      functionName: "gaugeToBribe" | "gaugeToFees" | "poolForGauge",
      gauge: Address,
    ): ContractFunctionParameters {
      return { address: voter, abi, functionName, args: [gauge] }
    }
    const [bribes, fees, pools] = await Promise.all([
      multicallParsed(
        client,
        gauges.map((gauge) => call("gaugeToBribe", gauge)),
        addressSchema,
      ),
      branch === "pools"
        ? multicallParsed(
            client,
            gauges.map((gauge) => call("gaugeToFees", gauge)),
            addressSchema,
          )
        : Promise.resolve([]),
      branch === "pools"
        ? multicallParsed(
            client,
            gauges.map((gauge) => call("poolForGauge", gauge)),
            addressSchema,
          )
        : Promise.resolve([]),
    ])
    return new Map(
      gauges.map((gauge, index) => [
        gauge.toLowerCase(),
        {
          bribe: live(bribes[index]),
          fees: live(fees[index]),
          pool: live(pools[index]),
        },
      ]),
    )
  }
}

function derived(seed: string): Address {
  return getAddress(`0x${keccak256(toHex(seed)).slice(-40)}`)
}

/**
 * Demo-data stand-in: stable made-up contracts per fixture gauge, so local
 * dev without an `API` binding still drafts claims (their simulation fails
 * on mainnet, which keeps them unsignable).
 */
export function fixtureRewardContracts(): RewardContractResolver {
  return async function resolve(branch, gauges) {
    return new Map(
      gauges.map((gauge) => [
        gauge.toLowerCase(),
        {
          bribe: derived(`bribe:${gauge.toLowerCase()}`),
          fees:
            branch === "pools" ? derived(`fees:${gauge.toLowerCase()}`) : null,
          pool:
            branch === "pools" ? derived(`pool:${gauge.toLowerCase()}`) : null,
        },
      ]),
    )
  }
}
