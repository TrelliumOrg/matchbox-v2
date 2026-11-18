import {
  mergeTokenAmounts,
  priceBreakdown,
} from "@matchbox/api/read-models/money"
import type {
  Prices,
  WalletOverview,
  WalletRewards,
} from "@matchbox/contracts/read-models"

// The stored claimable is a fallback now: the API reads claimable from the
// chain for the wallet being looked at (apps/api live-claimable.ts) and
// serves the stored figure only when that read fails, marked "as of block
// N". So the sweep no longer has to read every lock's claimable to rebuild
// a wallet. It reads what a small budget allows, and for a lock it did not
// read it carries the figure the last document had, with the block that
// figure was read at. A wallet is never held back from its rebuild (its
// locks, votes and history) because its claimable could not be read, and a
// figure that was not read is never written as zero.

export type PreviousWallet = {
  overview: WalletOverview
  rewards: WalletRewards
  /** The block the previous documents were built at. */
  block: number
}

type Documents = { overview: WalletOverview; rewards: WalletRewards }

const keyOf = (lock: { escrow: string; tokenId: string }): string =>
  `${lock.escrow}:${lock.tokenId}`

/**
 * `built` with the claimable of every lock in `unread` taken from the
 * previous documents, the totals worked out again, and `claimableAsOf`
 * set: this run's block when every lock was read, else the block the
 * carried figures were read at.
 */
export function carryClaimable<Built extends Documents>(input: {
  built: Built
  previous: PreviousWallet | null
  /** `${escrow}:${tokenId}` of the locks this run did not read. */
  unread: ReadonlySet<string>
  block: number
  prices: Prices
}): Built {
  const { built, previous, unread, block, prices } = input
  const carried = built.overview.locks.some((lock) => unread.has(keyOf(lock)))
  if (!carried || previous === null) {
    const asOf = { block, source: "stored" as const, partial: false }
    return {
      ...built,
      overview: { ...built.overview, claimableAsOf: asOf },
      rewards: { ...built.rewards, claimableAsOf: asOf },
    }
  }
  const before = new Map(
    previous.overview.locks.map((lock) => [keyOf(lock), lock]),
  )
  const locks = built.overview.locks.map((lock) => {
    const key = keyOf(lock)
    const old = before.get(key)
    // A lock the wallet did not have before has nothing to carry: it keeps
    // what this run built, which for an unread lock is empty. The API's
    // live read is what shows it.
    return unread.has(key) && old !== undefined
      ? { ...lock, claimable: old.claimable }
      : lock
  })
  const total = priceBreakdown(
    mergeTokenAmounts(locks.map((lock) => lock.claimable.tokens)),
    prices,
  )
  const byLock = [
    ...built.rewards.byLock.filter((entry) => !unread.has(keyOf(entry.lock))),
    ...previous.rewards.byLock.filter((entry) => unread.has(keyOf(entry.lock))),
  ]
  const hasClaimable = total.tokens.length > 0
  // The carried figures were read at the previous documents' block, or
  // earlier if they were carried then too.
  const asOf = {
    block: previous.overview.claimableAsOf?.block ?? previous.block,
    source: "stored" as const,
    partial: false,
  }
  return {
    ...built,
    overview: {
      ...built.overview,
      locks,
      claimable: total,
      claimableEpoch: hasClaimable
        ? (built.overview.claimableEpoch ?? previous.overview.claimableEpoch)
        : null,
      claimableAsOf: asOf,
    },
    rewards: {
      ...built.rewards,
      epoch: hasClaimable
        ? (built.rewards.epoch ?? previous.rewards.epoch)
        : null,
      readyToClaim: total,
      byLock,
      claimableAsOf: asOf,
    },
  }
}
