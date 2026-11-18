import {
  ERC20_ABI,
  VOTER_WRITE_ABI,
  VOTING_REWARD_WRITE_ABI,
  ZERO_ADDRESS,
} from "@matchbox/chain"
import type {
  WalletOverview,
  WalletRewards,
} from "@matchbox/contracts/read-models"
import { type Address, type ContractFunctionParameters, getAddress } from "viem"
import { z } from "zod"
import { MAINNET } from "./abis"
import type { ClaimableEntry, ClaimableLock } from "./claims"
import {
  addressSchema,
  bigintSchema,
  type MezoClient,
  multicallParsed,
  numberSchema,
  stringSchema,
} from "./rpc"

// What every lock of a wallet can claim, read on chain: the exact
// `earned(token, tokenId)` on each reward contract, at one block. The API
// read models only say where to look (the gauges a lock voted for, this
// epoch and in its unclaimed history); the amounts are always the chain's.

export type ClaimVoter = "boost" | "validators" | "pools" | "third-party"

export type ClaimCandidate = {
  voter: ClaimVoter
  gauge: Address
  tokenId: bigint
}

export type ChainClaims = {
  locks: ClaimableLock[]
  blockNumber: bigint
}

const VOTER_ADDRESS: Record<ClaimVoter, Address> = {
  boost: MAINNET.boostVoter,
  validators: MAINNET.validatorsVoter,
  pools: MAINNET.poolsVoter,
  "third-party": MAINNET.thirdPartyVoter,
}

const SOURCE: Record<ClaimVoter, ClaimableLock["source"]> = {
  boost: "boost_bribes",
  validators: "validator_bribes",
  pools: "pool_fees_bribes",
  "third-party": "mezo_bribes",
}

// A reward contract rarely lists more than a handful of tokens; the cap
// bounds the multicall if one lists hundreds.
const MAX_REWARD_TOKENS = 16

const voterSchema = z.enum(["boost", "validators", "pools", "third-party"])

function voterOf(value: string): ClaimVoter | null {
  const parsed = voterSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * Where to look: the gauges each of the wallet's locks voted for this epoch
 * (overview) and the gauges its unclaimed rewards came from (rewards).
 */
export function claimCandidates(input: {
  overview: WalletOverview | null
  rewards: WalletRewards | null
  tokenIds: ReadonlySet<string> | null
}): ClaimCandidate[] {
  const seen = new Map<string, ClaimCandidate>()
  function add(voterText: string, gauge: string, tokenId: string): void {
    const voter = voterOf(voterText)
    if (voter === null) return
    if (input.tokenIds !== null && !input.tokenIds.has(tokenId)) return
    const key = `${voter}:${gauge.toLowerCase()}:${tokenId}`
    if (seen.has(key)) return
    seen.set(key, { voter, gauge: getAddress(gauge), tokenId: BigInt(tokenId) })
  }
  for (const lock of input.overview?.locks ?? []) {
    if (lock.vote?.status !== "voted") continue
    for (const allocation of lock.vote.allocations) {
      add(allocation.gauge.voter, allocation.gauge.address, lock.tokenId)
    }
  }
  for (const entry of input.rewards?.byLock ?? []) {
    for (const row of entry.gauges) {
      add(row.gauge.voter, row.gauge.address, entry.lock.tokenId)
    }
  }
  return [...seen.values()]
}

function live(address: Address | null): Address | null {
  return address === null || address === ZERO_ADDRESS ? null : address
}

/** Reads every candidate's reward contracts, tokens and earned amounts. */
export async function loadChainClaims(
  client: MezoClient,
  candidates: readonly ClaimCandidate[],
): Promise<ChainClaims> {
  const blockNumber = await client.getBlockNumber()
  if (candidates.length === 0) return { locks: [], blockNumber }
  const at = blockNumber

  // 1. Each (voter, gauge): its bribe contract, and the fee contract on
  //    PoolsVoter (pool fees go to voters there).
  const gauges = [
    ...new Map(
      candidates.map((candidate) => [
        `${candidate.voter}:${candidate.gauge.toLowerCase()}`,
        candidate,
      ]),
    ).values(),
  ]
  const contractCalls: ContractFunctionParameters[] = gauges.flatMap(
    (candidate) => {
      const base = {
        address: VOTER_ADDRESS[candidate.voter],
        abi: VOTER_WRITE_ABI,
        args: [candidate.gauge],
      } as const
      return candidate.voter === "pools"
        ? [
            { ...base, functionName: "gaugeToBribe" },
            { ...base, functionName: "gaugeToFees" },
          ]
        : [{ ...base, functionName: "gaugeToBribe" }]
    },
  )
  const contractResults = await multicallParsed(
    client,
    contractCalls,
    addressSchema,
    at,
  )
  const rewardContracts = new Map<string, Address[]>()
  let cursor = 0
  for (const candidate of gauges) {
    const bribe = live(contractResults[cursor] ?? null)
    cursor += 1
    const fees =
      candidate.voter === "pools"
        ? live(contractResults[cursor++] ?? null)
        : null
    rewardContracts.set(
      `${candidate.voter}:${candidate.gauge.toLowerCase()}`,
      [bribe, fees].filter((value): value is Address => value !== null),
    )
  }

  // 2. Each reward contract's token list.
  const contracts = [
    ...new Set(
      [...rewardContracts.values()].flat().map((a) => a.toLowerCase()),
    ),
  ].map((address) => getAddress(address))
  const lengths = await multicallParsed(
    client,
    contracts.map((address) => ({
      address,
      abi: VOTING_REWARD_WRITE_ABI,
      functionName: "rewardsListLength",
    })),
    bigintSchema,
    at,
  )
  const tokenCalls: Array<{ contract: Address; index: bigint }> = []
  contracts.forEach((contract, index) => {
    const length = lengths[index] ?? 0n
    const capped =
      length > BigInt(MAX_REWARD_TOKENS) ? BigInt(MAX_REWARD_TOKENS) : length
    for (let item = 0n; item < capped; item += 1n) {
      tokenCalls.push({ contract, index: item })
    }
  })
  const tokenResults = await multicallParsed(
    client,
    tokenCalls.map((call) => ({
      address: call.contract,
      abi: VOTING_REWARD_WRITE_ABI,
      functionName: "rewards",
      args: [call.index],
    })),
    addressSchema,
    at,
  )
  const tokensOf = new Map<string, Address[]>()
  tokenCalls.forEach((call, index) => {
    const token = tokenResults[index]
    if (token === null || token === undefined) return
    const key = call.contract.toLowerCase()
    tokensOf.set(key, [...(tokensOf.get(key) ?? []), token])
  })

  // 3. earned(token, tokenId) for every candidate's contracts and tokens.
  const earnedCalls: Array<{
    candidate: ClaimCandidate
    contract: Address
    token: Address
  }> = []
  for (const candidate of candidates) {
    const key = `${candidate.voter}:${candidate.gauge.toLowerCase()}`
    for (const contract of rewardContracts.get(key) ?? []) {
      for (const token of tokensOf.get(contract.toLowerCase()) ?? []) {
        earnedCalls.push({ candidate, contract, token })
      }
    }
  }
  const earned = await multicallParsed(
    client,
    earnedCalls.map((call) => ({
      address: call.contract,
      abi: VOTING_REWARD_WRITE_ABI,
      functionName: "earned",
      args: [call.token, call.candidate.tokenId],
    })),
    bigintSchema,
    at,
  )

  // 4. Token metadata for what is actually owed.
  const owedTokens = [
    ...new Set(
      earnedCalls
        .filter((_, index) => (earned[index] ?? 0n) > 0n)
        .map((call) => call.token.toLowerCase()),
    ),
  ].map((address) => getAddress(address))
  const [symbols, decimals] = await Promise.all([
    multicallParsed(
      client,
      owedTokens.map((address) => ({
        address,
        abi: ERC20_ABI,
        functionName: "symbol",
      })),
      stringSchema,
      at,
    ),
    multicallParsed(
      client,
      owedTokens.map((address) => ({
        address,
        abi: ERC20_ABI,
        functionName: "decimals",
      })),
      numberSchema,
      at,
    ),
  ])
  const meta = new Map(
    owedTokens.map((token, index) => [
      token.toLowerCase(),
      {
        symbol: (symbols[index] ?? "TOKEN").slice(0, 16),
        decimals: decimals[index] ?? 18,
      },
    ]),
  )

  // 5. One claim per (voter, lock); a token earned twice on one contract
  //    (two gauges sharing nothing) stays two entries, never summed away.
  const byLock = new Map<string, ClaimableLock>()
  earnedCalls.forEach((call, index) => {
    const amount = earned[index] ?? 0n
    if (amount <= 0n) return
    const key = `${call.candidate.voter}:${call.candidate.tokenId}`
    const lock = byLock.get(key) ?? {
      source: SOURCE[call.candidate.voter],
      voter: VOTER_ADDRESS[call.candidate.voter],
      tokenId: call.candidate.tokenId,
      entries: [],
    }
    const exists = lock.entries.some(
      (entry) =>
        entry.contract.toLowerCase() === call.contract.toLowerCase() &&
        entry.token.toLowerCase() === call.token.toLowerCase(),
    )
    if (!exists) {
      const info = meta.get(call.token.toLowerCase())
      const entry: ClaimableEntry = {
        contract: call.contract,
        token: call.token,
        symbol: info?.symbol ?? "TOKEN",
        decimals: info?.decimals ?? 18,
        earned: amount,
      }
      lock.entries.push(entry)
    }
    byLock.set(key, lock)
  })
  return { locks: [...byLock.values()], blockNumber }
}
