import { VOTING_ESCROW_ABI } from "@matchbox/chain"
import type { ProSummaryResponse } from "@matchbox/contracts/read-models"
import { epochNumberFor } from "../versions"
import { MAINNET } from "./abis"
import type { MezoClient } from "./rpc"
import { usdToMicro, wholeToBaseUnits } from "./units"

// Protocol totals. The escrows' `supply()` (MEZO and BTC held by the locks)
// and veMEZO voting power are read on chain at one block; lockers,
// incentives and gauge counts come from the API summary. If the RPC read
// fails the summary's warehouse totals stand in and say so.

export type ProtocolSnapshot = {
  blockNumber: bigint
  fetchedAt: string
  epoch: { number: number; start: number; end: number }
  // Base units (18 decimals).
  vemezoLocked: bigint
  vebtcLocked: bigint
  // Null when the chain read failed.
  vemezoVotingPower: bigint | null
  lockedSource: "chain" | "read-model"
  vemezoLockers: number
  incentivesMicroUsd: bigint | null
  previousIncentivesMicroUsd: bigint | null
  gaugeCount: number
  fundedCount: number
  summaryBlock: bigint
  summaryUpdatedAt: string
}

type ChainTotals = {
  blockNumber: bigint
  vemezoLocked: bigint
  vebtcLocked: bigint
  vemezoVotingPower: bigint
}

export async function loadChainTotals(
  client: MezoClient,
): Promise<ChainTotals> {
  const blockNumber = await client.getBlockNumber()
  const at = { blockNumber }
  const [vemezoLocked, vebtcLocked, vemezoVotingPower] = await Promise.all([
    client.readContract({
      ...at,
      address: MAINNET.veMEZO,
      abi: VOTING_ESCROW_ABI,
      functionName: "supply",
    }),
    client.readContract({
      ...at,
      address: MAINNET.veBTC,
      abi: VOTING_ESCROW_ABI,
      functionName: "supply",
    }),
    client.readContract({
      ...at,
      address: MAINNET.veMEZO,
      abi: VOTING_ESCROW_ABI,
      functionName: "totalVotingPower",
    }),
  ])
  return { blockNumber, vemezoLocked, vebtcLocked, vemezoVotingPower }
}

function micro(value: string | null | undefined): bigint | null {
  return value === null || value === undefined ? null : usdToMicro(value)
}

/** Summary plus chain totals; `chain` null means the RPC read failed. */
export function protocolSnapshot(input: {
  summary: ProSummaryResponse
  chain: ChainTotals | null
  now: Date
}): ProtocolSnapshot {
  const { data, meta } = input.summary
  const chain = input.chain
  return {
    blockNumber: chain?.blockNumber ?? BigInt(meta.block),
    fetchedAt:
      chain === null
        ? new Date(meta.updatedAt * 1000).toISOString()
        : input.now.toISOString(),
    // Numbered from its start (Epoch 0 is Thu 11 Dec 2025), never from the
    // API's number, so Stuart says Epoch 47 wherever the pages do.
    epoch: {
      ...data.epoch,
      number: epochNumberFor(BigInt(data.epoch.start)) ?? data.epoch.number,
    },
    vemezoLocked:
      chain?.vemezoLocked ?? wholeToBaseUnits(data.stats.vemezoLocked, 18),
    vebtcLocked:
      chain?.vebtcLocked ?? wholeToBaseUnits(data.stats.vebtcLocked, 18),
    vemezoVotingPower: chain?.vemezoVotingPower ?? null,
    lockedSource: chain === null ? "read-model" : "chain",
    vemezoLockers: data.stats.vemezoLockers,
    incentivesMicroUsd: micro(data.incentives.usd),
    previousIncentivesMicroUsd: micro(data.incentives.previousUsd),
    gaugeCount: data.gaugeCount,
    fundedCount: data.fundedCount,
    summaryBlock: BigInt(meta.block),
    summaryUpdatedAt: new Date(meta.updatedAt * 1000).toISOString(),
  }
}
