import { CONTRACTS } from "@matchbox/chain"
import type { VoterKind } from "@matchbox/contracts/market"
import {
  type ChainDiagnostics,
  type EarnedRequest,
  earnedKey,
  gentlePace,
  type VotedGauge,
  type WalletChainReader,
} from "./chain"
import type { RewardSourceRow, VoteRow } from "./reader"

// What a lock can claim, the same way the API's live wallet path works it
// out (apps/api/src/read-models/live-wallet.ts): for every gauge the lock
// votes now, ask the gauge's own reward contracts, read from the chain.
//
// Until 12 Nov 2026 the reward contracts came from the warehouse's
// `reward_deposits`, for the gauge named on the vote row and the last four
// epochs. That lost three things at once for a veBTC lock voting a pool:
//
// - A PoolsVoter vote names the pool, not its gauge, so nothing matched.
//   (The gauge also showed as a bare address: lock #848's sMUSD vote read
//   "0xb4d4…51cc".) The pool's gauge is now read from PoolsVoter, which
//   also covers gauges created before the indexer's first block.
// - A pool gauge's fee contract is paid by the gauge, not by a depositor,
//   so it has no `reward_deposits` row. Lock #848 had 1,124.59 MUSD of
//   fees there and showed $39.98.
// - `earned` is cumulative, so rewards older than four epochs were still
//   claimable and no longer shown.
//
// What a run can afford. The jobs Worker reads from the public Mezo RPC,
// which throttles `earned` under load (see `chain.ts`); on 12 Nov 2026 the
// first two runs with these reads skipped 24 of 61 and then 75 of 114
// wallets. So a run asks for a bounded number of `earned` calls, gently,
// within a time budget, and the wallets it does not reach wait their turn:
//
//   gauges(pool), gaugeToBribe, gaugeToFees,
//   rewardsListLength, rewards(i)          400 calls a request, a handful
//   earned, wallets someone waits for      10 a request, one at a time
//   earned, the rest                       10 a request, six at a time
//   earned, retries                        5 a request, one at a time,
//                                          after 0.7 s and then 1.4 s
//
// At most `maxEarnedRequests` calls, so 60 requests plus retries, inside
// `earnedBudgetMs`. That is deliberately little: the API reads claimable
// live for the wallet being looked at, so what the sweep stores is only
// the fallback, and a lock it does not reach keeps its last figure
// (carry-claimable.ts) instead of holding its wallet back. The Worker's allowance is 1,000 subrequests per
// invocation (Cloudflare's paid plan), shared with the run's other reads
// and the live snapshot.

const poolsVoter = CONTRACTS.mainnet.poolsVoter.toLowerCase()

const voterByContract: Record<string, VoterKind> = {
  [CONTRACTS.mainnet.boostVoter.toLowerCase()]: "boost",
  [poolsVoter]: "pools",
  [CONTRACTS.mainnet.validatorsVoter.toLowerCase()]: "validators",
  [CONTRACTS.mainnet.thirdPartyVoter.toLowerCase()]: "third-party",
}

/**
 * `earned` calls per run, at most: one per lock, reward contract and token
 * it pays. Past the cap the calls of the wallets ranked last are left out,
 * their locks count as unread, and the run logs it.
 */
export const maxEarnedRequests = 600

/** The time a run gives its `earned` calls, retries included. */
export const earnedBudgetMs = 6_000

/** Calls that still failed after the retries, per read. */
export type ClaimableFailures = {
  poolGauges: number
  rewardContracts: number
  /** Reward contracts whose token list did not come back. Not "rewardTokens": the logger redacts a key that ends in "token". */
  rewardLists: number
  earned: number
}

export type ClaimableReads = {
  /** The votes, with each PoolsVoter vote named by its gauge. */
  votes: VoteRow[]
  /** PoolsVoter's gauge for every pool asked about, lower-case. */
  poolGauges: Map<string, string>
  /** Reward contract and token per voted gauge, as the build expects. */
  sources: RewardSourceRow[]
  earned: Map<string, bigint>
  /**
   * Token ids of locks with a read that did not come back, or left out by
   * the cap. Their claimable is unknown: `earned` holds less than the
   * truth for them, and a document built from it must not be written.
   */
  unread: Set<string>
  failures: ClaimableFailures
  /** `earned` calls left out by `maxEarnedRequests`. */
  dropped: number
  /** Reward contracts with more tokens than are read. */
  truncated: string[]
  /** `earned` calls sent. */
  asked: number
  /** Why requests failed, for the log. */
  diagnostics: ChainDiagnostics
}

/**
 * Names each PoolsVoter vote by its gauge. The warehouse's row carries the
 * pool; an address PoolsVoter has no gauge for is left as it is.
 */
export function withPoolGauges(
  votes: readonly VoteRow[],
  gaugeOfPool: ReadonlyMap<string, string>,
): VoteRow[] {
  return votes.map((vote) => {
    if (vote.voter_contract.toLowerCase() !== poolsVoter) return vote
    const gauge = gaugeOfPool.get(vote.gauge.toLowerCase())
    return gauge === undefined ? vote : { ...vote, gauge }
  })
}

function votedGauges(votes: readonly VoteRow[]): VotedGauge[] {
  const voted = new Map<string, VotedGauge>()
  for (const vote of votes) {
    const voter = voterByContract[vote.voter_contract.toLowerCase()]
    if (voter === undefined) continue
    const gauge = vote.gauge.toLowerCase()
    voted.set(`${voter}:${gauge}`, { gauge, voter })
  }
  return [...voted.values()]
}

export type ClaimableOptions = {
  /**
   * Orders token ids, lower first: the wallets a run most needs right.
   * The cap and the time budget cut from the far end.
   */
  rank?: (tokenId: string) => number
  /**
   * Locks of wallets someone is waiting for (the API served them live, or
   * an earlier run skipped them). Their calls go first, one request at a
   * time, before the bulk can use up the RPC's allowance, so a person
   * waiting is not starved by the sweep.
   */
  waiting?: (tokenId: string) => boolean
  /**
   * Pools named elsewhere (activity rows) whose gauge is wanted in the
   * same request; a failure there marks no lock unread.
   */
  otherPools?: readonly string[]
  now?: () => number
}

/** Reads what every voting lock can claim. */
export async function readClaimable(
  chain: WalletChainReader,
  warehouseVotes: readonly VoteRow[],
  options: ClaimableOptions = {},
): Promise<ClaimableReads> {
  const rank = options.rank ?? (() => 0)
  const waiting = options.waiting ?? (() => false)
  const otherPools = options.otherPools ?? []
  const now = options.now ?? (() => Date.now())
  const unread = new Set<string>()

  const pools = [
    ...new Set([
      ...warehouseVotes
        .filter((vote) => vote.voter_contract.toLowerCase() === poolsVoter)
        .map((vote) => vote.gauge.toLowerCase()),
      ...otherPools.map((pool) => pool.toLowerCase()),
    ]),
  ]
  const poolRead =
    pools.length === 0
      ? { gauges: new Map<string, string>(), failed: [] }
      : await chain.poolGauges(pools)
  const unreadPools = new Set(poolRead.failed)
  for (const vote of warehouseVotes) {
    if (
      vote.voter_contract.toLowerCase() === poolsVoter &&
      unreadPools.has(vote.gauge.toLowerCase())
    ) {
      unread.add(vote.token_id)
    }
  }
  const votes = withPoolGauges(warehouseVotes, poolRead.gauges)

  const contractRead = await chain.rewardContracts(votedGauges(votes))
  const tokenRead = await chain.rewardTokens([
    ...new Set(contractRead.contracts.map((entry) => entry.rewardContract)),
  ])
  const unreadContracts = new Set(tokenRead.failed)
  // A gauge is unread when its reward contracts, or any one's token list,
  // did not come back.
  const unreadGauges = new Set(contractRead.failed)
  for (const entry of contractRead.contracts) {
    if (unreadContracts.has(entry.rewardContract)) unreadGauges.add(entry.gauge)
  }
  for (const vote of votes) {
    if (unreadGauges.has(vote.gauge.toLowerCase())) unread.add(vote.token_id)
  }

  const sources: RewardSourceRow[] = contractRead.contracts.flatMap((entry) =>
    (tokenRead.tokens.get(entry.rewardContract) ?? []).map((token) => ({
      gauge: entry.gauge,
      reward_contract: entry.rewardContract,
      token,
    })),
  )
  const byGauge = new Map<string, RewardSourceRow[]>()
  for (const source of sources) {
    byGauge.set(source.gauge, [...(byGauge.get(source.gauge) ?? []), source])
  }
  const requests = new Map<string, EarnedRequest>()
  for (const vote of votes) {
    for (const source of byGauge.get(vote.gauge.toLowerCase()) ?? []) {
      const request = {
        rewardContract: source.reward_contract,
        token: source.token,
        tokenId: vote.token_id,
      }
      requests.set(earnedKey(request), request)
    }
  }
  // Waiting wallets first, then by rank. A stable sort keeps a lock's
  // calls together.
  const ordered = [...requests.values()].sort(
    (left, right) =>
      Number(waiting(right.tokenId)) - Number(waiting(left.tokenId)) ||
      rank(left.tokenId) - rank(right.tokenId),
  )
  const asked = ordered.slice(0, maxEarnedRequests)
  for (const request of ordered.slice(maxEarnedRequests)) {
    unread.add(request.tokenId)
  }
  const first = asked.filter((request) => waiting(request.tokenId))
  const rest = asked.filter((request) => !waiting(request.tokenId))
  const deadline = now() + earnedBudgetMs
  const none = { earned: new Map<string, bigint>(), failed: [] }
  const firstRead =
    first.length === 0
      ? none
      : await chain.earned(first, { pace: gentlePace, deadline })
  const restRead =
    rest.length === 0 ? none : await chain.earned(rest, { deadline })
  const earnedRead = {
    earned: new Map([...firstRead.earned, ...restRead.earned]),
    failed: [...firstRead.failed, ...restRead.failed],
  }
  for (const request of earnedRead.failed) unread.add(request.tokenId)

  return {
    votes,
    poolGauges: poolRead.gauges,
    sources,
    earned: earnedRead.earned,
    unread,
    failures: {
      poolGauges: poolRead.failed.length,
      rewardContracts: contractRead.failed.length,
      rewardLists: tokenRead.failed.length,
      earned: earnedRead.failed.length,
    },
    dropped: ordered.length - asked.length,
    truncated: tokenRead.truncated,
    asked: asked.length,
    diagnostics: chain.diagnostics(),
  }
}

export function anyFailure(failures: ClaimableFailures): boolean {
  return Object.values(failures).some((count) => count > 0)
}
