import {
  type BridgedAsset,
  type BridgedDeployment,
  bridgedAssets,
  type CrossChain,
} from "@matchbox/chain"
import { circulatingSupply } from "@matchbox/domain/market-price"
import { erc20Abi, type PublicClient } from "viem"
import type { JsonRow } from "../scan/statements"

// Supply by chain for MUSD and MEZO. Wormhole NTT is hub and spoke: Mezo's
// managers lock what leaves Mezo, every other chain's burn and mint. So a
// chain's circulating supply is totalSupply, except on Mezo, where the
// manager's balance (backing every other chain's supply) is taken out.

export type SupplyReading = {
  asset: BridgedAsset
  chain: CrossChain
  decimals: number
  totalSupply: bigint
  /** The hub manager's balance; null on burn-and-mint chains. */
  locked: bigint | null
  circulating: bigint
  block: bigint
}

export async function readDeploymentSupply(
  client: PublicClient,
  asset: BridgedAsset,
  deployment: BridgedDeployment,
): Promise<SupplyReading> {
  const block = await client.getBlockNumber()
  const [totalSupply, locked] = await Promise.all([
    client.readContract({
      address: deployment.token,
      abi: erc20Abi,
      functionName: "totalSupply",
      blockNumber: block,
    }),
    deployment.mode === "locking"
      ? client.readContract({
          address: deployment.token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [deployment.nttManager],
          blockNumber: block,
        })
      : Promise.resolve(null),
  ])
  return {
    asset,
    chain: deployment.chain,
    decimals: deployment.decimals,
    totalSupply,
    locked,
    circulating: circulatingSupply(totalSupply, locked ?? 0n, deployment.mode),
    block,
  }
}

/** Every deployment of both assets; a failed chain is reported, not thrown. */
export async function readAllSupply(
  clients: Record<CrossChain, PublicClient>,
): Promise<{
  readings: SupplyReading[]
  failed: { asset: BridgedAsset; chain: CrossChain; reason: string }[]
}> {
  const jobs = (Object.keys(bridgedAssets) as BridgedAsset[]).flatMap((asset) =>
    bridgedAssets[asset].deployments.map((deployment) => ({
      asset,
      deployment,
    })),
  )
  const settled = await Promise.allSettled(
    jobs.map(({ asset, deployment }) =>
      readDeploymentSupply(clients[deployment.chain], asset, deployment),
    ),
  )
  const readings: SupplyReading[] = []
  const failed: { asset: BridgedAsset; chain: CrossChain; reason: string }[] =
    []
  settled.forEach((result, index) => {
    const job = jobs[index]
    if (job === undefined) return
    if (result.status === "fulfilled") readings.push(result.value)
    else {
      const reason =
        result.reason instanceof Error
          ? result.reason.message.slice(0, 200)
          : "Unknown error"
      failed.push({ asset: job.asset, chain: job.deployment.chain, reason })
    }
  })
  return { readings, failed }
}

export function supplyRows(
  readings: readonly SupplyReading[],
  day: string,
  nowSeconds: number,
): JsonRow[] {
  return readings.map((reading) => ({
    asset: reading.asset,
    chain: reading.chain,
    day,
    total_supply: reading.totalSupply.toString(),
    locked: reading.locked === null ? null : reading.locked.toString(),
    circulating: reading.circulating.toString(),
    decimals: reading.decimals,
    block: reading.block.toString(),
    updated_at: nowSeconds,
  }))
}
