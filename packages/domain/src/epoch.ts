// Mezo Earn epochs: one week long, starting Thursday 00:00 UTC. The Unix
// epoch (1970-01-01) was a Thursday, so flooring a timestamp to a multiple of
// a week gives its epoch start. Votes open one hour into an epoch and close
// one hour before it ends (Wednesday 23:00 UTC).
//
// One module for what Matchbox had in four places: the webapp's
// lib/mezoGauges/epochs.ts and lib/academy/epoch.ts, platform-contracts'
// market.ts and Pro's lib/epoch.ts (plus the bigint helper in Pro's
// worker/history/math.ts). EPOCHS.md lists how they differed.

/** Seconds in an epoch. */
export const EPOCH_SECONDS = 604_800

/** Seconds in an epoch, for on-chain (bigint) timestamps. */
export const EPOCH_SECONDS_BIGINT = 604_800n

/** Alias kept for the webapp and academy callers. */
export const WEEK = EPOCH_SECONDS

/** Votes open this long after an epoch starts and close this long before. */
export const VOTE_WINDOW_PADDING_SECONDS = 3_600

/** Vote windows close 1h before the next epoch starts (Wed 23:00 UTC). */
export const VOTE_WINDOW_CLOSE_OFFSET_SECONDS =
  EPOCH_SECONDS - VOTE_WINDOW_PADDING_SECONDS

/**
 * Epoch 0 starts Thu 11 Dec 2025 00:00 UTC: the first full week after Mezo's
 * voters went live (BoostVoter deployed Mon 8 Dec 2025). This is the
 * community and Dune numbering: the week starting Thu 5 Nov 2026 is Epoch 47.
 */
export const EPOCH_ZERO_START = 1_765_411_200

/** EPOCH_ZERO_START for on-chain (bigint) timestamps. */
export const EPOCH_ZERO_START_BIGINT = 1_765_411_200n

/**
 * Mezo Earn's launch, Thu 3 Sep 2026 00:00 UTC (Epoch 38): the first vote
 * epoch with veMEZO boosts and the Earn incentives.
 */
export const EARN_LAUNCH_EPOCH_START = 1_788_393_600

/** EARN_LAUNCH_EPOCH_START for on-chain (bigint) timestamps. */
export const EARN_LAUNCH_EPOCH_START_BIGINT = 1_788_393_600n

/**
 * @deprecated Mezo Earn's launch, not Epoch 0. Use EARN_LAUNCH_EPOCH_START,
 * or EPOCH_ZERO_START for numbering.
 */
export const LAUNCH_EPOCH_START = EARN_LAUNCH_EPOCH_START

/** @deprecated See LAUNCH_EPOCH_START. */
export const LAUNCH_EPOCH_START_BIGINT = EARN_LAUNCH_EPOCH_START_BIGINT

export type EpochStatus = "closed" | "current" | "upcoming"

/** Unix seconds; the same on every network. */
export type Epoch = {
  start: number
  end: number
  voteStart: number
  voteEnd: number
  status: EpochStatus
}

/**
 * Start of the epoch containing `timestampSeconds`, with no validation. Use
 * {@link epochStartFor} for untrusted input.
 */
export function epochStartOf(timestampSeconds: number): number {
  return timestampSeconds - (timestampSeconds % EPOCH_SECONDS)
}

/** {@link epochStartOf} for on-chain (bigint) timestamps. */
export function epochStartOfBigint(timestamp: bigint): bigint {
  return timestamp - (timestamp % EPOCH_SECONDS_BIGINT)
}

export function isEpochStart(timestampSeconds: number): boolean {
  return (
    Number.isSafeInteger(timestampSeconds) &&
    timestampSeconds >= 0 &&
    timestampSeconds % EPOCH_SECONDS === 0
  )
}

/**
 * Snap to an epoch boundary. Non-finite and non-positive timestamps snap to
 * 0, so a bad query parameter cannot produce a negative window.
 */
export function snapToThursdayUTC(
  ts: number,
  dir: "down" | "up" = "down",
): number {
  if (!Number.isFinite(ts) || ts <= 0) return 0
  const down = Math.floor(ts / EPOCH_SECONDS) * EPOCH_SECONDS
  if (dir === "down") return down
  return down === ts ? ts : down + EPOCH_SECONDS
}

/** Start of the epoch containing `ts`; 0 for invalid or non-positive input. */
export function epochStartFor(ts: number): number {
  return snapToThursdayUTC(ts, "down")
}

/** The epoch starting at `start`, with its status at `nowSeconds`. */
export function describeEpoch(start: number, nowSeconds: number): Epoch {
  const end = start + EPOCH_SECONDS
  const status: EpochStatus =
    nowSeconds >= end ? "closed" : nowSeconds < start ? "upcoming" : "current"
  return {
    start,
    end,
    voteStart: start + VOTE_WINDOW_PADDING_SECONDS,
    voteEnd: end - VOTE_WINDOW_PADDING_SECONDS,
    status,
  }
}

/** The epoch containing `nowSeconds` and the one after it. */
export function currentAndNextEpoch(nowSeconds: number): {
  current: Epoch
  next: Epoch
} {
  const start = epochStartOf(nowSeconds)
  return {
    current: describeEpoch(start, nowSeconds),
    next: describeEpoch(start + EPOCH_SECONDS, nowSeconds),
  }
}

/** Epoch vote windows close 1h before the next epoch starts (Wed 23:00 UTC). */
export function voteWindowCloseFor(epochStart: number): number {
  return epochStart + VOTE_WINDOW_CLOSE_OFFSET_SECONDS
}

/**
 * E0 is the epoch starting at EPOCH_ZERO_START. Earlier epochs get negative
 * indexes; {@link epochNumberFor} returns null for them instead.
 */
export function epochIndexFor(epochStart: number): number {
  return Math.floor((epochStart - EPOCH_ZERO_START) / EPOCH_SECONDS)
}

/** Start of epoch number `index`. */
export function epochStartForIndex(index: number): number {
  return EPOCH_ZERO_START + index * EPOCH_SECONDS
}

/** Display number for the epoch starting at `epochStart`; none before E0. */
export function epochNumberFor(epochStart: bigint | undefined): number | null {
  if (epochStart === undefined || epochStart < EPOCH_ZERO_START_BIGINT) {
    return null
  }
  return Number((epochStart - EPOCH_ZERO_START_BIGINT) / EPOCH_SECONDS_BIGINT)
}

export function epochLabel(epochStart: bigint | undefined): string {
  const number = epochNumberFor(epochStart)
  return number === null ? "Epoch" : `Epoch ${number}`
}

/**
 * Vote-window closes that have passed since Mezo Earn's launch, i.e. every
 * epoch from EARN_LAUNCH_EPOCH_START whose close is <= nowTs. The currently
 * open epoch is excluded.
 */
export function epochClosesSinceLaunch(nowTs: number): number[] {
  const closes: number[] = []
  for (
    let epochStart = EARN_LAUNCH_EPOCH_START;
    voteWindowCloseFor(epochStart) <= nowTs;
    epochStart += EPOCH_SECONDS
  ) {
    closes.push(voteWindowCloseFor(epochStart))
  }
  return closes
}

/**
 * Rewards distribute at the epoch flip: a distribution event at `timestamp`
 * lands in epoch N+1's first blocks but pays for epoch N's votes. Returns the
 * vote epoch the payout belongs to.
 */
export function rewardedVoteEpochFor(timestamp: number): number {
  return epochStartFor(timestamp) - EPOCH_SECONDS
}

/** Epoch starts in [fromTs, toTs), both snapped down to a boundary. */
export function enumerateEpochs(fromTs: number, toTs: number): number[] {
  const start = snapToThursdayUTC(fromTs, "down")
  const end = snapToThursdayUTC(toTs, "down")
  if (end < start) return []
  const out: number[] = []
  for (let t = start; t < end; t += EPOCH_SECONDS) out.push(t)
  return out
}

export function enumerateEpochsForWindow(
  fromTs: number,
  toTs: number,
  opts: { includeOpenEpoch?: boolean } = {},
): number[] {
  const epochs = enumerateEpochs(fromTs, toTs)
  if (!opts.includeOpenEpoch) return epochs

  const openEpoch = snapToThursdayUTC(toTs, "down")
  if (toTs <= fromTs || openEpoch < fromTs || openEpoch === toTs) {
    return epochs
  }
  if (epochs[epochs.length - 1] === openEpoch) return epochs
  return [...epochs, openEpoch]
}

/**
 * Resolve a points window from optional `from`/`to` query parameters (unix
 * seconds, used for fixed per-semester windows); both snap to epoch
 * boundaries. When absent, defaults to the rolling last-8-epoch window ending
 * at the most recent epoch boundary.
 */
export function resolveWindow(
  fromParam: string | null,
  toParam: string | null,
  now: number,
): { fromTs: number; toTs: number } {
  const toNum = toParam === null ? Number.NaN : Number(toParam)
  const fromNum = fromParam === null ? Number.NaN : Number(fromParam)
  const toTs = Number.isFinite(toNum)
    ? snapToThursdayUTC(toNum, "down")
    : snapToThursdayUTC(now, "down")
  const fromTs = Number.isFinite(fromNum)
    ? snapToThursdayUTC(fromNum, "down")
    : toTs - 8 * EPOCH_SECONDS
  return { fromTs, toTs }
}
