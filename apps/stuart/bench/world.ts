import {
  logsPageSchema,
  tokenTransfersPageSchema,
} from "@matchbox/contracts/blockscout"
import { nameWithPoolType, poolTypeLabel } from "@matchbox/domain/pool-type"
import type { VoteBranch } from "@matchbox/stuart-ui/contract"
import { type Address, getAddress } from "viem"
import type { StuartProviders } from "../src/query/context"
import { fakeProviders, LOCKS, PRICES, WALLET } from "../src/query/fakes"
import {
  type ChainActivitySource,
  ESCROW_ASSET,
  normalizeNftMoves,
  normalizeTransfers,
  type OwnedLock,
  type OwnerVote,
  parseDistributorClaim,
  parseLockEvent,
  parseSafeNative,
  type RewardPayer,
} from "../src/query/providers/chainActivity"
import { wholeToBaseUnits } from "../src/query/providers/units"
import {
  assetFor,
  MAX_VOTING_NUM,
  type VoteTarget,
  type VotingDomain,
  voterFor,
  voterSource,
  type WalletLock,
} from "../src/query/providers/voting"
import payouts from "./fixtures/activity.payouts.json" with { type: "json" }
import activity from "./fixtures/activity.snf.json" with { type: "json" }
import fixture from "./fixtures/gauges.mainnet.json" with { type: "json" }

// The benchmark's world: the live gauge directory captured from Matchscan
// and Mezo RPC (fixtures/gauges.mainnet.json, see capture-gauges.mjs), a
// wallet with one veBTC lock and two veMEZO locks, and Stuart's test fakes
// for everything else (trove, claims, prices, bridge). No network.

export type FixtureGauge = (typeof fixture.gauges)[number]

export const GAUGES: readonly FixtureGauge[] = fixture.gauges
export const FIXTURE_BLOCK = BigInt(fixture.block)
export const CAPTURED_AT = fixture.capturedAt

// Friday 13 Nov 2026 12:00 UTC: mid epoch, the voting window is open.
export const BENCH_NOW = new Date("2026-11-13T12:00:00.000Z")
const WEEK = 604_800n
export const BENCH_EPOCH_START =
  (BigInt(Math.floor(BENCH_NOW.getTime() / 1000)) / WEEK) * WEEK

export const BENCH_WALLET: Address = WALLET
const E18 = 10n ** 18n
const MUSD: Address = "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186"

export const VEBTC_LOCKS: WalletLock[] = [
  {
    asset: "veBTC",
    tokenId: 6100n,
    amount: 25n * 10n ** 17n,
    end: 0n,
    isPermanent: true,
    votingPower: 125n * 10n ** 17n,
  },
]

const VOTER_OF: Record<VoteBranch, string> = {
  boost: "boost",
  pools: "pools",
  validators: "validators",
}

/** Pool type label as the directory card would carry it ("CL200"). */
function labelOf(gauge: FixtureGauge): string | null {
  const label = gauge.label
  if (label === null) return null
  if (label === "Volatile") return poolTypeLabel({ poolType: "volatile" })
  if (label === "Stable") return poolTypeLabel({ poolType: "stable" })
  const spacing = /^CL(\d+)$/.exec(label)?.[1]
  return poolTypeLabel({
    poolType: "cl",
    tickSpacing: spacing === undefined ? null : Number(spacing),
  })
}

function target(gauge: FixtureGauge, branch: VoteBranch): VoteTarget | null {
  const targetAddress =
    branch === "pools"
      ? gauge.pool === null
        ? null
        : getAddress(gauge.pool)
      : getAddress(gauge.address)
  if (targetAddress === null) return null
  const usd = gauge.incentivesUsd
  return {
    targetAddress,
    gaugeAddress: getAddress(gauge.address),
    // As the read model provider names it: "BTC/MUSD CL200".
    name: nameWithPoolType(gauge.name, labelOf(gauge)).slice(0, 80),
    nameSource: /^veBTC #\d+$/.test(gauge.name) ? "derived" : "profile",
    tokenId: gauge.tokenId,
    isAlive: gauge.isAlive,
    weight: wholeToBaseUnits(gauge.votes, 18),
    rewardContracts: [],
    incentives:
      Number(usd) > 0
        ? [
            {
              contract: getAddress(gauge.address),
              token: MUSD,
              symbol: "MUSD",
              decimals: 18,
              amount: wholeToBaseUnits(usd, 18),
            },
          ]
        : [],
  }
}

export function benchDomain(branch: VoteBranch): VotingDomain {
  const gauges = GAUGES.filter((gauge) => gauge.voter === VOTER_OF[branch])
  const targets: VoteTarget[] = []
  const labels = new Map<string, string>()
  const kinds = new Map<string, "vebtc" | "validator" | "pool" | "mezo">()
  for (const gauge of gauges) {
    const each = target(gauge, branch)
    if (each === null) continue
    targets.push(each)
    const key = each.targetAddress.toLowerCase()
    const label = labelOf(gauge)
    if (label !== null) labels.set(key, label)
    kinds.set(
      key,
      gauge.kind === "pool"
        ? "pool"
        : gauge.kind === "validator"
          ? "validator"
          : "vebtc",
    )
  }
  const totalWeight = targets.reduce((sum, each) => sum + each.weight, 0n)
  return {
    branch,
    voter: voterFor(branch),
    governanceAsset: assetFor(branch),
    epochStart: BENCH_EPOCH_START,
    epochNext: BENCH_EPOCH_START + WEEK,
    blockNumber: FIXTURE_BLOCK,
    fetchedAt: BENCH_NOW.toISOString(),
    totalWeight,
    maxVotingNum: MAX_VOTING_NUM,
    source: voterSource(branch),
    targets,
    pictures: new Map(),
    kinds,
    labels,
    rewardContracts: new Map(),
  }
}

// The Supernormal Foundation's chain activity (fixtures/activity.snf.json,
// see capture-activity.mjs): its voting Safe's and its Enclave's ERC-20
// transfers over the 90 days before BENCH_NOW, which senders are voting
// reward contracts, Safe signers, its locks, the 30 largest veBTC locks
// and the current votes of the top five owners' locks.

export const ACTIVITY = activity
/** Where the SNF capture's transfers start (unix seconds). */
const ACTIVITY_FROM = Math.floor(Date.parse(activity.window.since) / 1000)
export const SNF_SAFE = activity.members.safe
export const SNF_ENCLAVE = activity.members.enclave

type FixtureLock = (typeof activity.locks)[number]

function ownedLock(lock: FixtureLock): OwnedLock {
  return {
    asset: lock.asset === "veMEZO" ? "veMEZO" : "veBTC",
    tokenId: lock.tokenId,
    owner: lock.owner === null ? null : (lock.owner as Address),
    amount: BigInt(lock.amount),
    isPermanent: lock.isPermanent,
    unlockAt: lock.unlockAt,
  }
}

const ALL_LOCKS: OwnedLock[] = [...activity.locks, ...activity.topLocks]
  .map(ownedLock)
  .filter(
    (lock, index, all) =>
      all.findIndex(
        (other) => other.asset === lock.asset && other.tokenId === lock.tokenId,
      ) === index,
  )

/** "BTC/MUSD CL200" for a PoolsVoter pool, from the captured directory. */
function voteTargetName(source: string, target: string): string | null {
  const gauge = GAUGES.find((each) =>
    source === "pools"
      ? each.pool?.toLowerCase() === target
      : each.address.toLowerCase() === target,
  )
  if (gauge === undefined) return null
  return nameWithPoolType(gauge.name, labelOf(gauge))
}

/** Captured logs (distributor claims, Safe executions, deposits). */
function logs(items: unknown[] | undefined) {
  return logsPageSchema.parse({ items: items ?? [], next_page_params: null })
    .items
}

export function benchChain(): ChainActivitySource {
  const transfers = activity.transfers as Record<string, unknown[]>
  const nfts = activity.nftTransfers as Record<string, unknown[]>
  const claimLogs = activity.distributorLogs as Record<string, unknown[]>
  const safeLogs = activity.safeLogs as Record<string, unknown[]>
  const safeFailures = activity.safeFailures as Record<string, unknown[]>
  const txLogs = activity.txLogs as Record<string, unknown[]>
  const balances = activity.balances as Record<string, string>
  return {
    nftMoves: async (address, since) => ({
      moves: normalizeNftMoves(
        tokenTransfersPageSchema.parse({
          items: nfts[address.toLowerCase()] ?? [],
          next_page_params: null,
        }),
      ).filter((move) => move.at >= since),
      complete: true,
    }),
    distributorClaims: async (asset, tokenId) => {
      // Locks outside the capture had no claims in it.
      const items = claimLogs[`${asset}:${tokenId}`] ?? []
      return {
        asset,
        tokenId,
        claims: logs(items)
          .map(parseDistributorClaim)
          .filter((claim) => claim !== null && claim.tokenId === tokenId)
          .flatMap((claim) => (claim === null ? [] : [claim]))
          .sort((a, b) => a.block - b.block),
        complete: true,
      }
    },
    txLockEvents: async (tx) => {
      const items = txLogs[tx.toLowerCase()]
      if (items === undefined) return null
      return logs(items).flatMap((log) => {
        const asset = ESCROW_ASSET.get(log.address.hash.toLowerCase())
        const event = asset === undefined ? null : parseLockEvent(log)
        return asset !== undefined && event !== null ? [{ asset, event }] : []
      })
    },
    safeNative: async (safe, since) => {
      const items = safeLogs[safe.toLowerCase()]
      if (items === undefined) {
        return { transfers: [], complete: true, oldest: null, pages: 1 }
      }
      const failed = new Set(
        logs(safeFailures[safe.toLowerCase()]).map((log) =>
          log.transaction_hash.toLowerCase(),
        ),
      )
      return {
        transfers: parseSafeNative(safe, logs(items), failed).filter(
          (each) => each.at >= since,
        ),
        complete: true,
        oldest: null,
        pages: 1,
      }
    },
    balances: async (pairs) =>
      new Map(
        pairs.flatMap((pair) => {
          const key = `${pair.holder.toLowerCase()}:${pair.token.toLowerCase()}`
          const value = balances[key]
          return value === undefined ? [] : [[key, BigInt(value)] as const]
        }),
      ),
    lockOwners: async () => new Map(),
    transfers: async (address, since) => {
      const key = address.toLowerCase()
      // The payouts capture holds a slice of each address's history: a
      // read that stops at the slice's start.
      const slice = (
        payouts.slices as Record<string, { from: number; to: number }>
      )[key]
      const items =
        transfers[key] ??
        (payouts.transfers as Record<string, unknown[]>)[key] ??
        []
      const page = tokenTransfersPageSchema.parse({
        items,
        next_page_params: null,
      })
      const read = normalizeTransfers(page)
      // The SNF capture starts 90 days before BENCH_NOW: a read from
      // earlier stops there, as a page-capped live read would, so a
      // question about March says what it could not read.
      const from =
        transfers[key] !== undefined ? ACTIVITY_FROM : (slice?.from ?? null)
      const short = from !== null && from > since
      return {
        transfers: read.filter((each) => each.at >= since),
        complete: !short,
        oldest: short ? (read.at(-1)?.at ?? from) : null,
        pages: 1,
      }
    },
    labels: async () => new Map(),
    labelSearch: async () => [],
    ownerLocks: async (owner) =>
      ALL_LOCKS.filter((lock) => lock.owner === owner.toLowerCase()),
    ownerVotes: async (owner) =>
      activity.votes
        .filter((vote) => vote.owner === owner.toLowerCase())
        .map(
          (vote): OwnerVote => ({
            asset: "veBTC",
            tokenId: vote.tokenId,
            epochStart: Number(BENCH_EPOCH_START),
            gauge: vote.target as Address,
            gaugeName: voteTargetName(vote.source, vote.target),
            weight: BigInt(vote.weight),
            source:
              vote.source === "pools" ? "POOLS_VOTER" : "VALIDATORS_VOTER",
          }),
        ),
    topLocks: async (asset, limit) =>
      asset === "veBTC"
        ? activity.topLocks.map(ownedLock).slice(0, limit)
        : null,
    safeOwners: async (addresses) => {
      const owners = activity.safeOwners as Record<string, string[]>
      return new Map(
        addresses.flatMap((address) => {
          const list = owners[address.toLowerCase()]
          return list ? [[address.toLowerCase(), list as Address[]]] : []
        }),
      )
    },
    rewardPayers: async (addresses) => {
      const escrows = {
        ...payouts.rewardEscrows,
        ...activity.rewardEscrows,
      } as Record<string, string>
      const gauges = { ...payouts.gauges, ...activity.gauges } as Record<
        string,
        { stakingToken: string | null; rewardToken: string }
      >
      return new Map(
        addresses.flatMap((address): Array<[string, RewardPayer]> => {
          const key = address.toLowerCase()
          const gauge = gauges[key]
          if (gauge !== undefined) {
            return [
              [
                key,
                {
                  kind: "gauge",
                  stakingToken: gauge.stakingToken as Address | null,
                  rewardToken: gauge.rewardToken as Address,
                },
              ],
            ]
          }
          const asset = escrows[key]
          return asset === "veBTC" || asset === "veMEZO"
            ? [[key, { kind: "voting", asset }]]
            : []
        }),
      )
    },
  }
}

/** Fakes with the captured directory and a veBTC lock. */
export function benchProviders(
  overrides: Partial<StuartProviders> = {},
): StuartProviders {
  const domains = new Map<VoteBranch, VotingDomain>()
  return fakeProviders({
    prices: async () => PRICES,
    votingDomain: async (branch) => {
      const cached = domains.get(branch)
      if (cached) return cached
      const domain = benchDomain(branch)
      domains.set(branch, domain)
      return domain
    },
    walletLocks: async (_owner, asset) =>
      asset === "veMEZO" ? LOCKS : VEBTC_LOCKS,
    chain: benchChain(),
    // Captured locks answer with their real owner and amount; any other
    // lock keeps the test fake's state (owned by the bench wallet).
    lockStates: async (asset, tokenIds) => {
      const fallback = await fakeProviders().lockStates(asset, tokenIds)
      return {
        ...fallback,
        locks: fallback.locks.map((state) => {
          const known = ALL_LOCKS.find(
            (lock) =>
              lock.asset === asset && lock.tokenId === state.tokenId.toString(),
          )
          if (known === undefined || known.owner === null) return state
          return {
            ...state,
            owner: getAddress(known.owner),
            amount: known.amount,
            isPermanent: known.isPermanent,
          }
        }),
      }
    },
    fundedEpochs: async (domain, window) => ({
      counts: new Map(
        domain.targets.map((each) => [
          each.targetAddress.toLowerCase(),
          each.incentives.length > 0 ? window : 0,
        ]),
      ),
      unpricedOnly: new Set<string>(),
    }),
    ...overrides,
  })
}

export { E18 }
