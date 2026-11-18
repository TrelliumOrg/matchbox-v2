import type {
  TokenAmount,
  ValueBreakdown,
  WalletOverview,
  WalletRewards,
} from "@matchbox/contracts/read-models"
import { epochIndexFor } from "@matchbox/domain/epoch"
import {
  formatApy,
  formatToken,
  formatUsd,
  groupThousands,
  parseDecimal,
  roundDecimal,
} from "@matchbox/domain/format"

/**
 * A wallet's rewards and veMEZO votes as the address page draws them
 * (`eSwId--0MF`): what it can claim, what it claimed by epoch, what its
 * current votes are projected to earn, and its veMEZO votes. Built from
 * the read models Matchbox Pro reads (`/internal/pro/wallets/{a}/rewards`
 * and `/overview`, apps/api README "Internal Pro routes"), whose USD
 * values are the API's: current figures at today's prices, history at the
 * prices it was recorded with. Amounts stay decimal strings; only bar
 * heights become numbers (whole cents).
 */

/** The coins a reward bar stacks, in the design's order. */
export const rewardCoins = ["MEZO", "MUSD", "BTC", "Other"] as const

export type RewardCoin = (typeof rewardCoins)[number]

export type RewardPart = { coin: RewardCoin; cents: number; text: string }

export type RewardBar = {
  epoch: number
  /** The bar's total, "$422.62". */
  text: string
  cents: number
  parts: RewardPart[]
  /** The current epoch's projected rewards: drawn as an outline. */
  projected: boolean
}

export type RewardClaimView = {
  epoch: number
  claimedAt: number
  usd: string
  tokens: { symbol: string; amount: string }[]
  txHash: string
}

export type LockRewardsView = {
  escrow: "vebtc" | "vemezo"
  id: string
  usd: string
  tokens: { symbol: string; amount: string }[]
}

export type VeMezoVotesView = {
  /** Voting power of the wallet's veMEZO locks, whole veMEZO. */
  votes: string
  /** Share of that power cast this epoch, basis points. */
  usedBps: number
  /** The epoch the votes are in, or the current one with none cast. */
  epoch: number | null
  voted: boolean
  /**
   * This epoch's projected rewards (still moving) over the locked MEZO's
   * value, times 52: a simple annual rate, not compounded.
   */
  projectedApr: string | null
}

export type WalletView = {
  /** The current epoch, by the server's clock (the fixtures' own). */
  current: number
  claimable: {
    usd: string
    symbols: string[]
    epoch: number | null
    /** The block of stored figures, when the chain could not be read. */
    storedAt: number | null
  } | null
  /**
   * What the claims read add up to: the same bars as rewards by epoch,
   * so the two agree. `capped` when the history is Pro's last 12 claims,
   * so older claims may be missing.
   */
  claimed: { usd: string; epochs: number; capped: boolean } | null
  /** Claimed rewards by epoch, oldest first, then the projected epoch. */
  bars: RewardBar[]
  projected: { usd: string; epoch: number } | null
  /** Newest first. */
  claims: RewardClaimView[]
  byLock: LockRewardsView[]
  veMezo: VeMezoVotesView | null
}

/** Whole cents of a USD decimal string, rounded half up. */
export function centsOf(usd: string | null): bigint {
  if (usd === null) return 0n
  const parsed = parseDecimal(usd)
  if (parsed.negative) return 0n
  const { int, fraction } = roundDecimal(parsed, 2)
  return int * 100n + BigInt(fraction === "" ? "0" : fraction)
}

function usdOfCents(cents: bigint): string {
  const whole = cents / 100n
  const rest = (cents % 100n).toString().padStart(2, "0")
  return formatUsd(`${whole}.${rest}`, "cents")
}

function coinOf(symbol: string): RewardCoin {
  return symbol === "MEZO" || symbol === "MUSD" || symbol === "BTC"
    ? symbol
    : "Other"
}

function nonZero(value: string): boolean {
  return /[1-9]/.test(value)
}

function tokensOf(
  breakdown: ValueBreakdown,
): { symbol: string; amount: string }[] {
  return breakdown.tokens
    .filter((token) => nonZero(token.amount))
    .map((token) => ({
      symbol: token.token.symbol,
      amount: formatToken(token.amount, token.token.symbol),
    }))
}

/** Per coin, in whole cents. */
function coinCents(tokens: readonly TokenAmount[]): Map<RewardCoin, bigint> {
  const out = new Map<RewardCoin, bigint>()
  for (const token of tokens) {
    const coin = coinOf(token.token.symbol)
    out.set(coin, (out.get(coin) ?? 0n) + centsOf(token.usd))
  }
  return out
}

function barOf(
  epoch: number,
  coins: Map<RewardCoin, bigint>,
  projected: boolean,
): RewardBar {
  const total = [...coins.values()].reduce((sum, each) => sum + each, 0n)
  return {
    epoch,
    text: usdOfCents(total),
    cents: Number(total),
    parts: rewardCoins
      .map((coin) => ({ coin, cents: coins.get(coin) ?? 0n }))
      .filter((part) => part.cents > 0n)
      .map((part) => ({
        coin: part.coin,
        cents: Number(part.cents),
        text: usdOfCents(part.cents),
      })),
    projected,
  }
}

/** Epochs drawn at most: a bar a week, a year. */
export const maxBars = 52

/**
 * Pro's wallet history keeps the latest this many claims (the jobs'
 * `claims.slice(0, 12)`): it never holds more, so a history of exactly 12
 * may have dropped older claims, and one of fewer is whole.
 */
export const historyCap = 12

/**
 * Claims grouped by the epoch they paid for, every epoch from the first
 * claim to the current epoch's projected rewards (an epoch with no claim
 * is an empty bar). The latest `maxBars`.
 */
export function rewardBars(
  history: WalletRewards["history"],
  projected: { epoch: number; breakdown: ValueBreakdown } | null,
): RewardBar[] {
  const byEpoch = new Map<number, Map<RewardCoin, bigint>>()
  for (const claim of history) {
    const epoch = epochIndexFor(claim.epoch.start)
    const coins = byEpoch.get(epoch) ?? new Map<RewardCoin, bigint>()
    for (const [coin, cents] of coinCents(claim.rewards.tokens)) {
      coins.set(coin, (coins.get(coin) ?? 0n) + cents)
    }
    byEpoch.set(epoch, coins)
  }
  const showProjected =
    projected !== null &&
    centsOf(projected.breakdown.usd) > 0n &&
    !byEpoch.has(projected.epoch)
  const epochs = [
    ...byEpoch.keys(),
    ...(showProjected && projected !== null ? [projected.epoch] : []),
  ]
  const bars: RewardBar[] = []
  if (epochs.length === 0) return bars
  const first = Math.max(Math.min(...epochs), Math.max(...epochs) - maxBars + 1)
  const last = Math.max(...epochs)
  for (let epoch = first; epoch <= last; epoch += 1) {
    if (showProjected && projected !== null && epoch === projected.epoch) {
      bars.push(barOf(epoch, coinCents(projected.breakdown.tokens), true))
    } else {
      bars.push(barOf(epoch, byEpoch.get(epoch) ?? new Map(), false))
    }
  }
  return bars.slice(-maxBars)
}

/** The bars of the last `epochs` epochs up to `current`, or all. */
export function barsSince(
  bars: readonly RewardBar[],
  current: number,
  epochs: number | null,
): RewardBar[] {
  return epochs === null
    ? [...bars]
    : bars.filter((bar) => bar.epoch > current - epochs)
}

const whole = (value: string): bigint => parseDecimal(value).int

/**
 * The wallet's veMEZO locks' votes this epoch. Each lock votes through two
 * voters (BoostVoter and ThirdPartyVoter), each spending its whole power,
 * so the power a lock used is its largest vote through one voter.
 */
export function veMezoVotes(
  overview: WalletOverview,
  current: number,
): VeMezoVotesView | null {
  const locks = overview.locks.filter((lock) => lock.escrow === "vemezo")
  if (locks.length === 0) return null
  let power = 0n
  let used = 0n
  let locked = 0n
  let projected = 0n
  let epoch: number | null = null
  for (const lock of locks) {
    const own = whole(lock.votingPower)
    power += own
    locked += centsOf(lock.locked.usd)
    projected += centsOf(lock.projected?.usd ?? null)
    if (lock.vote.status !== "voted") continue
    epoch = epochIndexFor(lock.vote.epoch.start)
    const cast =
      lock.vote.byVoter.length > 0
        ? lock.vote.byVoter.reduce((most, each) => {
            const votes = whole(each.votes)
            return votes > most ? votes : most
          }, 0n)
        : whole(lock.vote.votes)
    used += cast > own ? own : cast
  }
  const usedBps = power === 0n ? 0 : Number((used * 10_000n) / power)
  return {
    votes: groupThousands(power),
    usedBps,
    epoch: epoch ?? current,
    voted: epoch !== null,
    // A week's projected rewards over the value locked, 52 weeks a year.
    projectedApr:
      locked === 0n || projected === 0n
        ? null
        : formatApy(Number((projected * 52n * 10_000n) / locked)),
  }
}

export function walletView(
  rewards: WalletRewards | null,
  overview: WalletOverview | null,
  nowSeconds: number,
): WalletView {
  const current = epochIndexFor(nowSeconds - (nowSeconds % 604_800))
  const ready = rewards?.readyToClaim ?? overview?.claimable ?? null
  const asOf = rewards?.claimableAsOf ?? overview?.claimableAsOf ?? null
  const claimEpoch = rewards?.epoch ?? overview?.claimableEpoch ?? null
  const projectedBreakdown = overview?.projected ?? null
  const projected =
    projectedBreakdown === null || centsOf(projectedBreakdown.usd) === 0n
      ? null
      : { epoch: current, breakdown: projectedBreakdown }
  const history = rewards?.history ?? []
  const bars = rewardBars(history, projected)
  const claimedBars = bars.filter((bar) => !bar.projected && bar.cents > 0)
  const claimedCents = claimedBars.reduce(
    (sum, bar) => sum + BigInt(bar.cents),
    0n,
  )
  return {
    current,
    claimable:
      ready === null || centsOf(ready.usd) === 0n
        ? null
        : {
            usd: formatUsd(ready.usd, "cents"),
            symbols: [
              ...new Set(
                ready.tokens
                  .filter((token) => nonZero(token.amount))
                  .map((token) => token.token.symbol),
              ),
            ],
            epoch: claimEpoch === null ? null : epochIndexFor(claimEpoch.start),
            storedAt: asOf?.source === "stored" ? asOf.block : null,
          },
    claimed:
      claimedCents === 0n
        ? null
        : {
            usd: usdOfCents(claimedCents),
            epochs: claimedBars.length,
            capped: history.length >= historyCap,
          },
    bars,
    projected:
      projected === null
        ? null
        : {
            usd: formatUsd(projected.breakdown.usd, "cents"),
            epoch: projected.epoch,
          },
    claims: history.map((claim) => ({
      epoch: epochIndexFor(claim.epoch.start),
      claimedAt: claim.claimedAt,
      usd: formatUsd(claim.rewards.usd, "cents"),
      tokens: tokensOf(claim.rewards),
      txHash: claim.txHash,
    })),
    byLock: (rewards?.byLock ?? [])
      .filter((entry) => centsOf(entry.rewards.usd) > 0n)
      .map((entry) => ({
        escrow: entry.lock.escrow,
        id: entry.lock.tokenId,
        usd: formatUsd(entry.rewards.usd, "cents"),
        tokens: tokensOf(entry.rewards),
      })),
    veMezo: overview === null ? null : veMezoVotes(overview, current),
  }
}

/** Epochs the voting streak tile reads and draws, the current one last. */
export const streakWindow = 9

export type StreakView = {
  /** Epochs in a row with votes, up to the current one. */
  streak: number
  /** Every epoch in the window voted: the streak may be longer. */
  more: boolean
  /** The latest epoch without votes in the window, if any. */
  missed: number | null
  squares: { epoch: number; voted: boolean; current: boolean }[]
}

/**
 * A voting streak from the epochs in which the wallet's locks had votes
 * (cast that epoch or carried over). The current epoch counts once its
 * votes are in; until then the streak runs to the epoch before.
 */
export function voteStreak(
  voted: ReadonlySet<number>,
  current: number,
): StreakView {
  const first = current - streakWindow + 1
  const squares = Array.from({ length: streakWindow }, (_, index) => {
    const epoch = first + index
    return { epoch, voted: voted.has(epoch), current: epoch === current }
  })
  let epoch = voted.has(current) ? current : current - 1
  let streak = 0
  while (epoch >= first && voted.has(epoch)) {
    streak += 1
    epoch -= 1
  }
  const missed =
    [...squares].reverse().find((square) => !square.voted && !square.current)
      ?.epoch ?? null
  return { streak, more: epoch < first, missed, squares }
}
