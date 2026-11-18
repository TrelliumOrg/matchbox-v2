/**
 * What Pro's screens render. The API Worker's read models
 * (`@matchbox/contracts/read-models`, validated with their zod schemas at the
 * boundary) are mapped into these by `adapters.ts` on the Pro Worker, so the
 * browser receives exactly the shape each screen draws.
 *
 * Money and token amounts are exact decimal strings in whole units. Vote
 * weights are integer strings in wei (18 decimals), the unit the optimizer
 * works in. Rates are basis points.
 */

export type TokenAmount = {
  symbol: string
  token: string | null
  amount: string
  usd: string | null
}

/** `change24hBps` is null when the API has no price from 24h ago. */
export type Price = {
  usd: string
  change24hBps: number | null
  /** Where the price was read. Absent in fixtures that predate it. */
  source?: "mezo-oracle" | "aerodrome-cl" | "coingecko"
}

/**
 * Where the claimable figures on screen come from. The API reads them from
 * the chain for the wallet in view ("live"). When that read fails it serves
 * the figures from the last time the wallet's documents were built
 * ("stored"), and the screen says "As of block N" beside them. `partial`:
 * live for the largest locks, stored for the rest.
 */
export type ClaimableAsOf = {
  block: number
  source: "live" | "stored"
  partial: boolean
}

export type Market = {
  block: { number: number; timestamp: number }
  epoch: { number: number; startsAt: number; endsAt: number }
  prices: { btc: Price | null; mezo: Price | null }
}

export type Picture =
  | { kind: "image"; url: string }
  | { kind: "initials"; initials: string; hue: number }

/**
 * Gauge types (decided 9 Nov): veBTC gauges (BoostVoter) and MEZO gauges
 * (cross-chain, ThirdPartyVoter) take veMEZO votes; validator gauges and
 * pool gauges (DEX pools and vaults such as sMUSD) take veBTC votes.
 */
export type GaugeKind = "vebtc" | "mezo" | "validator" | "pool"

/** What a gauge's votes are counted in. */
export type VoteUnit = "veMEZO" | "veBTC"

/** Each type's compact card fields. */
export type GaugeMeta =
  | {
      kind: "vebtc"
      tokenId: string | null
      /** veBTC weight behind the gauge, whole units. */
      weight: string
      /** Boost multiplier, "1" to "5", or null. */
      boost: string | null
      lock: "active" | "auto-max" | "expired" | null
    }
  | {
      kind: "validator"
      operator: string | null
      status: "active" | "jailed" | "inactive" | null
    }
  | {
      kind: "pool"
      /** Pair coins, lead token first. */
      pair: string[]
      poolKind: "cl" | "stable" | "volatile" | "vault" | null
      tvlUsd: string | null
    }
  | { kind: "mezo"; chain: string | null; protocol: string | null }

/** The voter contract a gauge belongs to, which decides who can vote on it. */
export type VoterKind = "boost" | "pools" | "validators" | "third-party"

export type GaugeRef = {
  address: string
  voter: VoterKind
  name: string
  /**
   * Pool gauges: which pool of the pair ("Volatile", "Stable", "CL200"),
   * from `@matchbox/domain/pool-type`; null otherwise. Absent in fixtures
   * written before it.
   */
  poolLabel?: string | null
  picture: Picture
  /** Allocation bar colours, light and dark. */
  color: { light: string; dark: string }
}

export type GaugeSummary = GaugeRef & {
  kind: GaugeKind
  meta: GaugeMeta
  votesUnit: VoteUnit
  /**
   * A veBTC gauge whose lock expired (weight 0): still collects veMEZO
   * votes but earns no boost. Sorted last, never optimized into.
   */
  expired: boolean
  /** The veBTC lock id behind a boost gauge ("7"). */
  tokenId: string | null
  tagline: string | null
  apyBps: number | null
  incentivesUsd: string
  incentiveTokens: string[]
  /** Boosted veBTC weight behind the gauge, whole units. */
  veBtcWeight: string
  /** Votes on the gauge this epoch in `votesUnit`, wei. */
  votes: string
  /** Votes that take the gauge to 5x, wei; null when not a boost gauge. */
  optimalVotes: string | null
}

export type GaugeList = {
  /**
   * The block every vote total is at least as new as. Absent from fixtures
   * and from documents read before it was sent.
   */
  block?: number
  epoch: number
  total: number
  funded: number
  gauges: GaugeSummary[]
}

export type GaugeKindTotals = Record<
  GaugeKind,
  { count: number; incentivesUsd: string }
>

export type GaugeProfile = {
  gauge: GaugeSummary
  about: string | null
  apyChangeBps: number | null
  strategy: { label: string; value: string }[]
  /** The facts of the gauge's kind (pool pair and fee, validator, lock). */
  details: { label: string; value: string }[]
  owner: string | null
  links: { website: string | null; x: string | null; discord: string | null }
  votesHistory: { epoch: number; votes: string }[]
  incentivesHistory: {
    epoch: number
    usd: string
    tokens: TokenAmount[]
    paysAt: number
    paid: boolean
  }[]
}

export type LockKind = "vebtc" | "vemezo"

export type Lock = {
  kind: LockKind
  tokenId: string
  amount: string
  usd: string
  /** Voting power, whole units. */
  votingPower: string
  votingPowerWei: string
  unlocksAt: number | null
  expired: boolean
  /** Auto max: never decays, cannot extend. */
  autoMax: boolean
  /**
   * Voted this epoch through either of its voters. Each voter has its own
   * once-an-epoch rule: see `votedVoters` for which.
   */
  votedThisEpoch: boolean
  /**
   * The voters the lock voted through this epoch. Absent when the read
   * model only knows the latest vote on either: then `votedThisEpoch`
   * stands for both.
   */
  votedVoters?: VoterKind[]
  /**
   * `shareBps` is the share of the votes on that gauge's voter (each voter
   * spends the lock's full power), so a lock voting on both of its voters
   * has shares adding up to 200%. From a document without per-voter votes
   * the shares are of both voters together.
   */
  votes: { gauge: GaugeRef; weight: string; shareBps: number }[]
  claimableUsd: string
  /**
   * What this epoch's votes earn when it ends (read model `projected`);
   * null before a vote. Optional so older fixtures stay valid.
   */
  projectedUsd?: string | null
  /** What a vote now would earn this epoch; null until the API serves it. */
  ifVotedUsd?: string | null
  /** A veBTC lock's boost gauge multiplier ("4.4"); null without one. */
  boost?: string | null
}

export type LockRef = { kind: LockKind; tokenId: string }

export type ActivityDetail =
  | {
      kind: "vote"
      lock: LockRef
      votes: string
      allocation: { gauge: GaugeRef; shareBps: number }[]
    }
  | {
      kind: "claim"
      usd: string
      tokens: TokenAmount[]
      locks: LockRef[]
      gauges: string[]
    }
  | {
      kind: "lock"
      action: "create" | "increase" | "extend" | "merge" | "withdraw"
      lock: LockRef
      amount: TokenAmount
      unlocksAt: number | null
    }
  | { kind: "incentive"; gauge: GaugeRef; amount: TokenAmount }
  /**
   * A transaction this browser sent that the indexer does not list yet, or
   * never will (it reverted). Only its signing step's label is known.
   */
  | { kind: "own"; label: string }

export type ActivityEvent = {
  id: string
  status: "confirmed" | "confirming" | "reverted"
  at: number
  epoch: number
  block: number | null
  tx: string
  detail: ActivityDetail
}

export type ActivityFilter = "all" | "votes" | "claims" | "locks" | "incentives"

export type ActivityPage = {
  address: string
  counts: Record<ActivityFilter, number>
  events: ActivityEvent[]
  nextCursor: string | null
}

export type Wallet = { btc: TokenAmount; mezo: TokenAmount; usd: string }

export type Overview = {
  address: string
  claimable: { epoch: number; usd: string; tokens: TokenAmount[] }
  claimableAsOf?: ClaimableAsOf
  /**
   * Where the locks come from: the chain just now ("live"), or the stored
   * document when that read failed ("stored", at its block), which can be
   * behind the wallet's latest transaction.
   */
  locksAsOf?: ClaimableAsOf
  /**
   * What this epoch's votes pay when it ends, summed over every lock; null
   * with no votes. Optional so older fixtures stay valid.
   */
  projected?: { usd: string; tokens: TokenAmount[] } | null
  locks: Lock[]
  /** Unlocked BTC and MEZO; null until the API serves wallet balances. */
  wallet: Wallet | null
  suggestion: { gauge: GaugeRef; votesToMax: string } | null
  activity: ActivityEvent[]
}

export type Home = {
  epoch: number
  incentivesUsd: string
  gaugesFunded: number
  gaugesTotal: number
  veMezoVoted: string
  veMezoLocked: string
  topGauges: GaugeSummary[]
}

export type Voter = {
  address: string
  /**
   * The block the locks were read from the chain at. Absent when they are
   * the stored ones (an API that does not read them live, or a read that
   * failed), which can be behind the wallet's latest transaction.
   */
  block?: number
  /** The lock the ballot votes with first, or null without one. */
  lock: Lock | null
  /** Every live lock, veMEZO first, largest first. */
  locks: Lock[]
  watching: string[]
  wallet: Wallet | null
}

export type Rewards = {
  address: string
  claimable: { epoch: number | null; usd: string; tokens: TokenAmount[] }
  claimableAsOf?: ClaimableAsOf
  /** Next payout, from this epoch's votes; null with no votes. */
  projected: { epoch: number; usd: string; paysAt: number } | null
  earned: { usd: string; fromEpoch: number | null; toEpoch: number | null }
  locks: {
    lock: LockRef
    usd: string
    tokens: TokenAmount[]
    gauges: { address: string; voter: VoterKind; name: string; usd: string }[]
    projectedUsd: string | null
    projectedShares: { name: string; shareBps: number }[]
  }[]
  history: ActivityEvent[]
}

export type ProtocolAction =
  | "lock-create"
  | "lock-add"
  | "lock-extend"
  | "lock-merge"
  | "lock-withdraw"
  | "vote"
  | "incentive"
  | "boost"
  | "claim"
  | "boost-refresh"

export type ProtocolEvent = {
  id: string
  at: number
  action: ProtocolAction
  actor: { kind: "vebtc" | "vemezo" | "address" | "system"; label: string }
  amount: string
  amountTokens: string[]
  where: { label: string; gauge: GaugeRef | null }
}

export type Protocol = {
  epoch: number
  latestEpoch: number
  /** Every epoch in the chart: each can be picked. */
  browsableEpochs: number[]
  incentivesUsd: string
  incentivesChangeUsd: string
  stats: {
    veMezoLocked: string
    lockers: number
    veBtcLocked: string
    veBtcLockedUsd: string | null
    veBtcVoteWeight: string
    votesThisEpoch: number
    medianApyBps: number | null
  }
  incentivesByEpoch: {
    epoch: number
    all: string
    vebtc: string
    validators: string
    pools: string
  }[]
  funded: {
    id: string
    name: string
    kind: GaugeKind
    subline: string
    picture: Picture | { kind: "pair"; tokens: string[] }
    gauge: string | null
    usd: string
    tokens: string[]
    /** Null when the count is not known. */
    deposits: number | null
  }[]
  fundedTotal: number
  events: ProtocolEvent[]
  eventsTotal: number
}
