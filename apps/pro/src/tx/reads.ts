import {
  ERC20_ABI,
  VOTER_WRITE_ABI,
  VOTING_ESCROW_WRITE_ABI,
  VOTING_REWARD_WRITE_ABI,
} from "@matchbox/chain"
import { type Config, getBlock, readContracts } from "@wagmi/core"
import { type Address, getAddress, zeroAddress } from "viem"
import type { LockKind } from "../data/view-models"
import type { LockFacts } from "../locks/eligibility"
import { mezoChainId } from "../wallet/wallet-runtime"
import { type ClaimCall, escrowAddress, voterAddress, votersFor } from "./plans"
import type { VoterKind } from "./tx-store"

/**
 * Chain reads a review needs before the wallet opens, batched through
 * Multicall3. Never eth_getLogs (Mezo caps ranges at 10,000 blocks): every
 * value here is current state.
 */

/** The token each escrow locks: MEZO, and BTC's ERC-20 precompile. */
export const lockToken: Record<
  LockKind,
  { address: Address; symbol: "MEZO" | "BTC"; decimals: 18 }
> = {
  vemezo: {
    address: getAddress("0x7b7c000000000000000000000000000000000001"),
    symbol: "MEZO",
    decimals: 18,
  },
  vebtc: {
    address: getAddress("0x7b7c000000000000000000000000000000000000"),
    symbol: "BTC",
    decimals: 18,
  },
}

/** Chain time: the latest block's timestamp (an Anvil fork keeps its own). */
export async function chainTime(config: Config): Promise<number> {
  const block = await getBlock(config, { chainId: mezoChainId })
  return Number(block.timestamp)
}

function value<T>(
  result: { status: "success"; result: T } | { status: "failure" },
  fallback: T,
): T {
  return result.status === "success" ? result.result : fallback
}

export type TokenState = {
  balance: bigint
  allowance: bigint
  decimals: number
  symbol: string
}

export async function tokenState(
  config: Config,
  input: { token: Address; owner: Address; spender: Address },
): Promise<TokenState> {
  const contract = { address: input.token, abi: ERC20_ABI } as const
  const [balance, allowance, decimals, symbol] = await readContracts(config, {
    contracts: [
      { ...contract, functionName: "balanceOf", args: [input.owner] },
      {
        ...contract,
        functionName: "allowance",
        args: [input.owner, input.spender],
      },
      { ...contract, functionName: "decimals" },
      { ...contract, functionName: "symbol" },
    ],
  })
  return {
    balance: value(balance, 0n),
    allowance: value(allowance, 0n),
    decimals: Number(value(decimals, 18)),
    symbol: value(symbol, "token"),
  }
}

const voterByAddress = new Map<string, VoterKind>(
  Object.entries(voterAddress).flatMap(([kind, address]) => {
    const found = (
      ["boost", "pools", "validators", "third-party"] as const
    ).find((candidate) => candidate === kind)
    return found === undefined ? [] : [[address.toLowerCase(), found]]
  }),
)

export type LockState = {
  owner: Address
  amount: bigint
  end: bigint
  isPermanent: boolean
  /** A grant lock's vesting end (unix seconds), 0 for a normal lock. */
  vestingEnd: number
  /** `escrowType` is not normal: managed, or deposited into a managed lock. */
  managed: boolean
  /** Voters the lock has live votes on (merge and withdraw reset them). */
  votedVoters: VoterKind[]
  /** `lastVoted` on each voter the lock can vote through. */
  lastVoted: Map<VoterKind, bigint>
  now: number
}

export async function lockState(
  config: Config,
  kind: LockKind,
  tokenId: bigint,
): Promise<LockState> {
  const escrow = {
    address: escrowAddress(kind),
    abi: VOTING_ESCROW_WRITE_ABI,
  } as const
  const voters = votersFor(kind)
  const [results, now] = await Promise.all([
    readContracts(config, {
      allowFailure: false,
      contracts: [
        { ...escrow, functionName: "ownerOf", args: [tokenId] },
        { ...escrow, functionName: "locked", args: [tokenId] },
        { ...escrow, functionName: "votedVoters", args: [tokenId] },
        { ...escrow, functionName: "vestingEnd", args: [tokenId] },
        { ...escrow, functionName: "escrowType", args: [tokenId] },
      ],
    }),
    chainTime(config),
  ])
  const [owner, locked, voted, vestingEnd, escrowType] = results
  const last = await readContracts(config, {
    allowFailure: false,
    contracts: voters.map((voter) => ({
      address: voterAddress[voter],
      abi: VOTER_WRITE_ABI,
      functionName: "lastVoted" as const,
      args: [tokenId] as const,
    })),
  })
  return {
    owner,
    amount: locked.amount < 0n ? 0n : locked.amount,
    end: locked.end,
    isPermanent: locked.isPermanent,
    vestingEnd: Number(vestingEnd),
    managed: escrowType !== 0,
    votedVoters: voted.flatMap((address) => {
      const found = voterByAddress.get(address.toLowerCase())
      return found === undefined ? [] : [found]
    }),
    lastVoted: new Map(
      voters.map((voter, index) => [voter, last[index] ?? 0n]),
    ),
    now,
  }
}

/** What `locks/eligibility` decides on, from a lock's chain state. */
export function lockFacts(
  kind: LockKind,
  tokenId: bigint,
  state: Pick<
    LockState,
    | "end"
    | "isPermanent"
    | "vestingEnd"
    | "managed"
    | "votedVoters"
    | "lastVoted"
  >,
): LockFacts {
  return {
    kind,
    tokenId: `${tokenId}`,
    end: state.isPermanent ? null : Number(state.end),
    vestingEnd: state.vestingEnd,
    managed: state.managed,
    votedAt: state.votedVoters.map((voter) =>
      Number(state.lastVoted.get(voter) ?? 0n),
    ),
  }
}

/**
 * Eligibility facts for several locks of one wallet (the merge picker), a
 * few multicalls for all of them. A lock whose reads fail is left out.
 */
export async function locksFacts(
  config: Config,
  locks: readonly { kind: LockKind; tokenId: bigint }[],
): Promise<{ facts: LockFacts[]; now: number }> {
  const target = (lock: { kind: LockKind; tokenId: bigint }) =>
    ({
      address: escrowAddress(lock.kind),
      abi: VOTING_ESCROW_WRITE_ABI,
      args: [lock.tokenId],
    }) as const
  const [locked, vesting, types, voted, now] = await Promise.all([
    readContracts(config, {
      contracts: locks.map((lock) => ({
        ...target(lock),
        functionName: "locked" as const,
      })),
    }),
    readContracts(config, {
      contracts: locks.map((lock) => ({
        ...target(lock),
        functionName: "vestingEnd" as const,
      })),
    }),
    readContracts(config, {
      contracts: locks.map((lock) => ({
        ...target(lock),
        functionName: "escrowType" as const,
      })),
    }),
    readContracts(config, {
      contracts: locks.map((lock) => ({
        ...target(lock),
        functionName: "votedVoters" as const,
      })),
    }),
    chainTime(config),
  ])
  const votedVoters = locks.map((_, index) => {
    const result = voted[index]
    const addresses = result?.status === "success" ? result.result : []
    return addresses.flatMap((address) => {
      const found = voterByAddress.get(address.toLowerCase())
      return found === undefined ? [] : [found]
    })
  })
  const lastLookups = locks.flatMap((lock, index) =>
    (votedVoters[index] ?? []).map((voter) => ({ index, voter, lock })),
  )
  const last = await readContracts(config, {
    contracts: lastLookups.map((lookup) => ({
      address: voterAddress[lookup.voter],
      abi: VOTER_WRITE_ABI,
      functionName: "lastVoted" as const,
      args: [lookup.lock.tokenId] as const,
    })),
  })
  return {
    now,
    facts: locks.flatMap((lock, index) => {
      const state = locked[index]
      const vestingEnd = vesting[index]
      const type = types[index]
      if (
        state?.status !== "success" ||
        vestingEnd?.status !== "success" ||
        type?.status !== "success"
      ) {
        return []
      }
      const lastVoted = new Map<VoterKind, bigint>()
      lastLookups.forEach((lookup, i) => {
        if (lookup.index !== index) return
        lastVoted.set(lookup.voter, value(last[i] ?? { status: "failure" }, 0n))
      })
      return [
        lockFacts(lock.kind, lock.tokenId, {
          end: state.result.end,
          isPermanent: state.result.isPermanent,
          vestingEnd: Number(vestingEnd.result),
          managed: type.result !== 0,
          votedVoters: votedVoters[index] ?? [],
          lastVoted,
        }),
      ]
    }),
  }
}

export type VoteState = {
  lastVoted: bigint[]
  whitelisted: boolean[]
  poolOf: Map<string, Address>
  now: number
}

export async function voteState(
  config: Config,
  input: {
    tokenId: bigint
    voters: readonly VoterKind[]
    poolGauges: readonly string[]
  },
): Promise<VoteState> {
  const [results, now] = await Promise.all([
    readContracts(config, {
      allowFailure: false,
      contracts: [
        ...input.voters.flatMap((voter) => [
          {
            address: voterAddress[voter],
            abi: VOTER_WRITE_ABI,
            functionName: "lastVoted" as const,
            args: [input.tokenId] as const,
          },
          {
            address: voterAddress[voter],
            abi: VOTER_WRITE_ABI,
            functionName: "isWhitelistedNFT" as const,
            args: [input.tokenId] as const,
          },
        ]),
        ...input.poolGauges.map((gauge) => ({
          address: voterAddress.pools,
          abi: VOTER_WRITE_ABI,
          functionName: "poolForGauge" as const,
          args: [getAddress(gauge)] as const,
        })),
      ],
    }),
    chainTime(config),
  ])
  const pairs = input.voters.length * 2
  const lastVoted: bigint[] = []
  const whitelisted: boolean[] = []
  for (let index = 0; index < pairs; index += 2) {
    const last = results[index]
    const listed = results[index + 1]
    lastVoted.push(typeof last === "bigint" ? last : 0n)
    whitelisted.push(listed === true)
  }
  const poolOf = new Map<string, Address>()
  input.poolGauges.forEach((gauge, index) => {
    const pool = results[pairs + index]
    if (typeof pool === "string" && pool !== zeroAddress) {
      poolOf.set(gauge.toLowerCase(), getAddress(pool))
    }
  })
  return { lastVoted, whitelisted, poolOf, now }
}

export type EarnedToken = {
  token: Address
  symbol: string
  decimals: number
  amount: bigint
}

export type ClaimState = { calls: ClaimCall[]; earned: EarnedToken[] }

/**
 * What a set of locks can claim right now, from the reward contracts
 * themselves: each gauge's bribe (and fees, for pools), every token in its
 * reward list, and `earned(token, tokenId)`. Only non-zero rewards make it
 * into a call, so nothing is claimed for nothing.
 */
export async function claimState(
  config: Config,
  sources: readonly {
    kind: LockKind
    tokenId: bigint
    gauges: readonly { address: string; voter: VoterKind }[]
  }[],
): Promise<ClaimState> {
  type Reward = {
    source: number
    voter: VoterKind
    kind: "bribes" | "fees"
    contract: Address
  }
  const lookups = sources.flatMap((source, index) =>
    source.gauges.flatMap((gauge) => {
      const kinds: ("bribes" | "fees")[] =
        gauge.voter === "pools" ? ["bribes", "fees"] : ["bribes"]
      return kinds.map((kind) => ({ index, gauge, kind }))
    }),
  )
  const contracts = await readContracts(config, {
    contracts: lookups.map((lookup) => ({
      address: voterAddress[lookup.gauge.voter],
      abi: VOTER_WRITE_ABI,
      functionName:
        lookup.kind === "fees"
          ? ("gaugeToFees" as const)
          : ("gaugeToBribe" as const),
      args: [getAddress(lookup.gauge.address)] as const,
    })),
  })
  const rewards: Reward[] = []
  lookups.forEach((lookup, i) => {
    const result = contracts[i]
    if (result?.status !== "success" || result.result === zeroAddress) return
    rewards.push({
      source: lookup.index,
      voter: lookup.gauge.voter,
      kind: lookup.kind,
      contract: result.result,
    })
  })
  const lengths = await readContracts(config, {
    contracts: rewards.map((reward) => ({
      address: reward.contract,
      abi: VOTING_REWARD_WRITE_ABI,
      functionName: "rewardsListLength" as const,
    })),
  })
  const listed = rewards.flatMap((reward, i) => {
    const count = Number(value(lengths[i] ?? { status: "failure" }, 0n))
    return Array.from({ length: Math.min(count, 16) }, (_, slot) => ({
      reward,
      slot,
    }))
  })
  const tokens = await readContracts(config, {
    contracts: listed.map((entry) => ({
      address: entry.reward.contract,
      abi: VOTING_REWARD_WRITE_ABI,
      functionName: "rewards" as const,
      args: [BigInt(entry.slot)] as const,
    })),
  })
  const candidates = listed.flatMap((entry, i) => {
    const token = tokens[i]
    return token?.status === "success"
      ? [{ reward: entry.reward, token: token.result }]
      : []
  })
  const earned = await readContracts(config, {
    contracts: candidates.map((candidate) => ({
      address: candidate.reward.contract,
      abi: VOTING_REWARD_WRITE_ABI,
      functionName: "earned" as const,
      args: [
        candidate.token,
        sources[candidate.reward.source]?.tokenId ?? 0n,
      ] as const,
    })),
  })

  const byCall = new Map<string, ClaimCall>()
  const totals = new Map<string, bigint>()
  candidates.forEach((candidate, i) => {
    const amount = value(earned[i] ?? { status: "failure" }, 0n)
    if (amount <= 0n) return
    const source = sources[candidate.reward.source]
    if (source === undefined) return
    const key = `${candidate.reward.source}-${candidate.reward.voter}-${candidate.reward.kind}`
    const call = byCall.get(key) ?? {
      voter: candidate.reward.voter,
      kind: candidate.reward.kind,
      tokenId: source.tokenId,
      escrow: source.kind,
      rewards: [],
    }
    const existing = call.rewards.find(
      (reward) => reward.contract === candidate.reward.contract,
    )
    if (existing === undefined) {
      call.rewards.push({
        contract: candidate.reward.contract,
        tokens: [candidate.token],
      })
    } else if (!existing.tokens.includes(candidate.token)) {
      existing.tokens.push(candidate.token)
    }
    byCall.set(key, call)
    const token = candidate.token.toLowerCase()
    totals.set(token, (totals.get(token) ?? 0n) + amount)
  })

  const tokenList = [...totals.keys()].map((token) => getAddress(token))
  const [symbols, decimals] = await Promise.all([
    readContracts(config, {
      contracts: tokenList.map((token) => ({
        address: token,
        abi: ERC20_ABI,
        functionName: "symbol" as const,
      })),
    }),
    readContracts(config, {
      contracts: tokenList.map((token) => ({
        address: token,
        abi: ERC20_ABI,
        functionName: "decimals" as const,
      })),
    }),
  ])
  return {
    calls: [...byCall.values()],
    earned: tokenList.map((token, i) => ({
      token,
      symbol: value(symbols[i] ?? { status: "failure" }, "token"),
      decimals: Number(value(decimals[i] ?? { status: "failure" }, 18)),
      amount: totals.get(token.toLowerCase()) ?? 0n,
    })),
  }
}

export type IncentiveState = {
  bribe: Address
  whitelisted: boolean
  token: TokenState
}

export async function incentiveState(
  config: Config,
  input: { voter: VoterKind; gauge: string; token: Address; owner: Address },
): Promise<IncentiveState> {
  const voter = voterAddress[input.voter]
  const [bribe, whitelisted] = await readContracts(config, {
    allowFailure: false,
    contracts: [
      {
        address: voter,
        abi: VOTER_WRITE_ABI,
        functionName: "gaugeToBribe",
        args: [getAddress(input.gauge)],
      },
      {
        address: voter,
        abi: VOTER_WRITE_ABI,
        functionName: "isWhitelistedToken",
        args: [input.token],
      },
    ],
  })
  const spender = input.voter === "pools" ? bribe : voter
  const token = await tokenState(config, {
    token: input.token,
    owner: input.owner,
    spender,
  })
  return { bribe, whitelisted, token }
}
