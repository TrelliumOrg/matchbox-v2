import { CONTRACTS, VOTING_ESCROW_ABI } from "@matchbox/chain"
import type { PublicClient } from "viem"
import type { GaugeChainExtras, GaugeChainReader } from "./gauges"

/** veBTC and veMEZO reads behind vebtcWeight, optimal votes and locked BTC. */
export function createGaugeChainReader(client: PublicClient): GaugeChainReader {
  const vebtc = { address: CONTRACTS.mainnet.veBTC, abi: VOTING_ESCROW_ABI }
  const vemezo = { address: CONTRACTS.mainnet.veMEZO, abi: VOTING_ESCROW_ABI }
  return async function readGaugeChain(tokenIds) {
    const ids = tokenIds.map((id) => BigInt(id))
    const [totals, powers, locks] = await Promise.all([
      client.multicall({
        allowFailure: true,
        contracts: [
          { ...vemezo, functionName: "totalVotingPower" },
          { ...vebtc, functionName: "unboostedTotalVotingPower" },
        ],
      }),
      client.multicall({
        allowFailure: true,
        contracts: ids.map((id) => ({
          ...vebtc,
          functionName: "unboostedVotingPowerOfNFT" as const,
          args: [id] as const,
        })),
      }),
      client.multicall({
        allowFailure: true,
        contracts: ids.map((id) => ({
          ...vebtc,
          functionName: "locked" as const,
          args: [id] as const,
        })),
      }),
    ])
    const [vemezoTotal, vebtcTotal] = totals
    const extras: GaugeChainExtras = {
      vemezoTotalVotingPower:
        vemezoTotal?.status === "success" ? vemezoTotal.result : null,
      vebtcUnboostedTotal:
        vebtcTotal?.status === "success" ? vebtcTotal.result : null,
      locks: new Map(),
      lockInfo: new Map(),
    }
    tokenIds.forEach((id, index) => {
      const power = powers[index]
      const lock = locks[index]
      if (lock?.status === "success") {
        extras.lockInfo.set(id, {
          amount: lock.result.amount < 0n ? 0n : lock.result.amount,
          end: lock.result.end,
          isPermanent: lock.result.isPermanent,
        })
      }
      if (power?.status !== "success" || lock?.status !== "success") return
      const amount = lock.result.amount
      extras.locks.set(id, {
        unboostedVotingPower: power.result,
        locked: amount < 0n ? 0n : amount,
      })
    })
    return extras
  }
}
