import {
  ERC20_ABI,
  VOTER_WRITE_ABI,
  VOTING_ESCROW_WRITE_ABI,
} from "@matchbox/chain"
import type { Address } from "viem"
import { z } from "zod"
import { MAINNET } from "./abis"
import type { ClaimVoter } from "./claimsChain"
import {
  addressSchema,
  bigintSchema,
  type MezoClient,
  multicallParsed,
  numberSchema,
} from "./rpc"

// A lock's state on chain, everything a lock action's rules decide on
// (Decided 9 Nov, "Lock edge cases"), read at one block.

export type LockAsset = "veMEZO" | "veBTC"

export type LockChainState = {
  asset: LockAsset
  tokenId: bigint
  /** null when the token does not exist (burned, merged away). */
  owner: Address | null
  amount: bigint
  /** Unlock time, unix seconds; 0 with auto max. */
  end: bigint
  isPermanent: boolean
  /** A grant lock's vesting end, unix seconds; 0 for a normal lock. */
  vestingEnd: bigint
  /** 0 normal, 1 deposited into a managed lock, 2 the managed lock. */
  escrowType: number
  /** Voters the lock has live votes on. */
  votedVoters: ClaimVoter[]
  /** `lastVoted` on each voter it voted through (unix seconds). */
  lastVoted: Partial<Record<ClaimVoter, bigint>>
}

export type LockStates = {
  locks: LockChainState[]
  blockNumber: bigint
  /** The block's timestamp, unix seconds. */
  now: bigint
}

const lockedSchema = z.object({
  amount: z.bigint(),
  end: z.bigint(),
  isPermanent: z.boolean(),
})

const VOTER_BY_ADDRESS = new Map<string, ClaimVoter>([
  [MAINNET.boostVoter.toLowerCase(), "boost"],
  [MAINNET.thirdPartyVoter.toLowerCase(), "third-party"],
  [MAINNET.validatorsVoter.toLowerCase(), "validators"],
  [MAINNET.poolsVoter.toLowerCase(), "pools"],
])

export const VOTER_ADDRESSES: Record<ClaimVoter, Address> = {
  boost: MAINNET.boostVoter,
  "third-party": MAINNET.thirdPartyVoter,
  validators: MAINNET.validatorsVoter,
  pools: MAINNET.poolsVoter,
}

export function escrowOf(asset: LockAsset): Address {
  return asset === "veMEZO" ? MAINNET.veMEZO : MAINNET.veBTC
}

/** The voters a lock of this escrow votes through. */
export function votersOf(asset: LockAsset): ClaimVoter[] {
  return asset === "veMEZO" ? ["boost", "third-party"] : ["validators", "pools"]
}

export async function loadLockStates(
  client: MezoClient,
  asset: LockAsset,
  tokenIds: readonly bigint[],
): Promise<LockStates> {
  const block = await client.getBlock()
  const at = block.number
  const escrow = escrowOf(asset)
  const call = (functionName: string, tokenId: bigint) => ({
    address: escrow,
    abi: VOTING_ESCROW_WRITE_ABI,
    functionName,
    args: [tokenId],
  })
  const voters = votersOf(asset)
  const [owners, locked, vesting, types, voted, last] = await Promise.all([
    multicallParsed(
      client,
      tokenIds.map((id) => call("ownerOf", id)),
      addressSchema,
      at,
    ),
    multicallParsed(
      client,
      tokenIds.map((id) => call("locked", id)),
      lockedSchema,
      at,
    ),
    multicallParsed(
      client,
      tokenIds.map((id) => call("vestingEnd", id)),
      bigintSchema,
      at,
    ),
    multicallParsed(
      client,
      tokenIds.map((id) => call("escrowType", id)),
      numberSchema,
      at,
    ),
    multicallParsed(
      client,
      tokenIds.map((id) => call("votedVoters", id)),
      z.array(addressSchema),
      at,
    ),
    multicallParsed(
      client,
      tokenIds.flatMap((id) =>
        voters.map((voter) => ({
          address: VOTER_ADDRESSES[voter],
          abi: VOTER_WRITE_ABI,
          functionName: "lastVoted",
          args: [id],
        })),
      ),
      bigintSchema,
      at,
    ),
  ])
  return {
    blockNumber: at,
    now: block.timestamp,
    locks: tokenIds.map((tokenId, index) => {
      const state = locked[index]
      const lastVoted: Partial<Record<ClaimVoter, bigint>> = {}
      voters.forEach((voter, offset) => {
        const value = last[index * voters.length + offset]
        if (value !== null && value !== undefined) lastVoted[voter] = value
      })
      return {
        asset,
        tokenId,
        owner: owners[index] ?? null,
        amount: state && state.amount > 0n ? state.amount : 0n,
        end: state?.end ?? 0n,
        isPermanent: state?.isPermanent ?? false,
        vestingEnd: vesting[index] ?? 0n,
        escrowType: types[index] ?? 0,
        votedVoters: (voted[index] ?? []).flatMap((address) => {
          const voter = VOTER_BY_ADDRESS.get(address.toLowerCase())
          return voter === undefined ? [] : [voter]
        }),
        lastVoted,
      }
    }),
  }
}

export type TokenAllowance = { balance: bigint; allowance: bigint }

/** The wallet's balance of an escrow's token and its allowance to the escrow. */
export async function loadEscrowFunding(
  client: MezoClient,
  asset: LockAsset,
  owner: Address,
): Promise<TokenAllowance & { token: Address }> {
  // The escrow's own `token()`: MEZO for veMEZO, Mezo's BTC token for veBTC.
  const token = await client.readContract({
    address: escrowOf(asset),
    abi: VOTING_ESCROW_WRITE_ABI,
    functionName: "token",
  })
  const [balance, allowance] = await Promise.all([
    client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [owner],
    }),
    client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner, escrowOf(asset)],
    }),
  ])
  return { token, balance, allowance }
}
