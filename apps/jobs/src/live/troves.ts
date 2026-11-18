import {
  MUSD_CONTRACTS,
  PRICE_FEED_ABI,
  STABILITY_POOL_ABI,
  TROVE_MANAGER_ABI,
  TROVE_STATUSES,
  type TroveStatus,
} from "@matchbox/chain"
import { type Address, getAddress, type PublicClient } from "viem"

// MUSD troves and Stability Pool totals at one block. The owner list comes
// from TroveManager's owners array (indexable, so one multicall), not a
// SortedTroves walk (one sequential call per trove).

const troveManager = {
  address: MUSD_CONTRACTS.mainnet.troveManager,
  abi: TROVE_MANAGER_ABI,
} as const

const stabilityPool = {
  address: MUSD_CONTRACTS.mainnet.stabilityPool,
  abi: STABILITY_POOL_ABI,
} as const

/**
 * The protocol's own BTC price: TroveManager and BorrowerOperations price
 * every trove with PriceFeed.fetchPrice() (a view; checked 10 Nov 2026 that
 * TroveManager.priceFeed() is this address).
 */
const priceFeed = {
  address: MUSD_CONTRACTS.mainnet.priceFeed,
  abi: PRICE_FEED_ABI,
} as const

/** fetchPrice() is USD per BTC scaled to 1e18 (PriceFeed TARGET_DIGITS). */
export const musdPriceScale = 18

/** Upper bound on troves read per run. */
const maxTroves = 5_000

export type TroveState = {
  owner: Address
  status: TroveStatus
  coll: bigint
  principal: bigint
  /** Interest including what accrued since the last checkpoint. */
  interest: bigint
  /** Basis points. */
  interestRate: number
}

export type StabilityPoolState = {
  totalMusdDeposits: bigint
  totalCollateral: bigint
}

export type TroveRead = {
  troves: TroveState[]
  stabilityPool: StabilityPoolState
  /**
   * PriceFeed.fetchPrice() at the same block, USD per BTC x 1e18; null when
   * it reverted (the oracle is older than MAX_PRICE_DELAY, so the protocol
   * itself cannot price troves at this block).
   */
  musdPrice: bigint | null
}

type CallResult<T> =
  | { status: "success"; result: T }
  | { status: "failure"; error: Error }

function required<T>(result: CallResult<T> | undefined, name: string): T {
  if (result?.status !== "success") {
    throw new Error(`${name} failed: ${result?.error.message ?? "no result"}`)
  }
  return result.result
}

/**
 * The first multicall's answers: the owner count and pool totals are
 * required (any failure fails the read), the price may revert.
 */
export function troveHeader(
  results: readonly [
    CallResult<bigint>,
    CallResult<bigint>,
    CallResult<bigint>,
    CallResult<bigint>,
  ],
): {
  count: bigint
  deposits: bigint
  collateral: bigint
  musdPrice: bigint | null
} {
  const [count, deposits, collateral, price] = results
  return {
    count: required(count, "getTroveOwnersCount"),
    deposits: required(deposits, "getTotalMUSDDeposits"),
    collateral: required(collateral, "getCollateralBalance"),
    musdPrice: price.status === "success" ? price.result : null,
  }
}

export async function readTroves(
  client: PublicClient,
  blockNumber: bigint,
): Promise<TroveRead> {
  const { count, deposits, collateral, musdPrice } = troveHeader(
    await client.multicall({
      blockNumber,
      allowFailure: true,
      contracts: [
        { ...troveManager, functionName: "getTroveOwnersCount" },
        { ...stabilityPool, functionName: "getTotalMUSDDeposits" },
        { ...stabilityPool, functionName: "getCollateralBalance" },
        { ...priceFeed, functionName: "fetchPrice" },
      ],
    }),
  )
  const total = Number(count < BigInt(maxTroves) ? count : BigInt(maxTroves))
  const owners = await client.multicall({
    blockNumber,
    allowFailure: false,
    contracts: Array.from({ length: total }, (_, index) => ({
      ...troveManager,
      functionName: "getTroveFromTroveOwnersArray" as const,
      args: [BigInt(index)] as const,
    })),
  })
  const [records, debts] = await Promise.all([
    client.multicall({
      blockNumber,
      allowFailure: false,
      contracts: owners.map((owner) => ({
        ...troveManager,
        functionName: "Troves" as const,
        args: [owner] as const,
      })),
    }),
    client.multicall({
      blockNumber,
      allowFailure: false,
      contracts: owners.map((owner) => ({
        ...troveManager,
        functionName: "getEntireDebtAndColl" as const,
        args: [owner] as const,
      })),
    }),
  ])
  const troves: TroveState[] = []
  for (const [index, owner] of owners.entries()) {
    const record = records[index]
    const debt = debts[index]
    if (record === undefined || debt === undefined) continue
    const [, , , , statusIndex, interestRate] = record
    const [coll, principal, interest] = debt
    troves.push({
      owner: getAddress(owner),
      status: TROVE_STATUSES[statusIndex] ?? "nonExistent",
      coll,
      principal,
      interest,
      interestRate,
    })
  }
  return {
    troves,
    stabilityPool: { totalMusdDeposits: deposits, totalCollateral: collateral },
    musdPrice,
  }
}
