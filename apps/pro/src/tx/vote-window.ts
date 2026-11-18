/**
 * When a lock can vote, from the voters' ProtocolTimeLibrary: epochs flip
 * every Thursday 00:00 UTC; votes revert with DistributeWindow until 01:00,
 * and in the last hour before the flip only whitelisted locks may vote
 * (NotWhitelistedNFT). One vote per lock per voter per epoch
 * (AlreadyVotedOrDeposited), and `reset` follows the same epoch rule.
 */

export const weekSeconds = 7 * 86_400
const hourSeconds = 3_600

export function epochStart(now: number): number {
  return now - (now % weekSeconds)
}

export function epochNext(now: number): number {
  return epochStart(now) + weekSeconds
}

export type VoteWindow =
  | { kind: "distribute"; opensAt: number }
  | { kind: "open"; closesAt: number }
  | { kind: "last-hour"; flipsAt: number }

export function voteWindow(now: number): VoteWindow {
  const start = epochStart(now)
  const next = start + weekSeconds
  if (now <= start + hourSeconds)
    return { kind: "distribute", opensAt: start + hourSeconds }
  if (now > next - hourSeconds) return { kind: "last-hour", flipsAt: next }
  return { kind: "open", closesAt: next - hourSeconds }
}

/** `lastVoted` from the voter, unix seconds. */
export function votedThisEpoch(lastVoted: bigint, now: number): boolean {
  return lastVoted >= BigInt(epochStart(now))
}

export type VoteBlock =
  | "distribute-window"
  | "voted-this-epoch"
  | "last-hour"
  | null

/** Why a vote would revert now, checked before the wallet opens. */
export function voteBlock(input: {
  now: number
  /** `lastVoted` on every voter the ballot signs with. */
  lastVoted: readonly bigint[]
  /** `isWhitelistedNFT` on those voters. */
  whitelisted: readonly boolean[]
}): VoteBlock {
  const window = voteWindow(input.now)
  if (window.kind === "distribute") return "distribute-window"
  if (input.lastVoted.some((last) => votedThisEpoch(last, input.now)))
    return "voted-this-epoch"
  if (window.kind === "last-hour" && !input.whitelisted.every(Boolean))
    return "last-hour"
  return null
}

export const voteBlockCopy: Record<Exclude<VoteBlock, null>, string> = {
  "distribute-window": "Voting opens at 01:00 UTC",
  "voted-this-epoch": "Voted this epoch",
  "last-hour": "Last hour, whitelisted locks only",
}

/** Whether `reset` can run now (merge and withdraw need it after a vote). */
export function canReset(lastVoted: bigint, now: number): boolean {
  return (
    voteWindow(now).kind !== "distribute" && !votedThisEpoch(lastVoted, now)
  )
}
