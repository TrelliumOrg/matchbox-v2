import type {
  Prices,
  WalletOverview,
  WalletRewards,
} from "@matchbox/contracts/read-models"
import { priceBreakdown, priceTokenAmount } from "./money"

// Wallet documents are stored with the USD values of the snapshot that wrote
// them, and rewritten only when an amount changes. Values that are "worth
// now" (locked, claimable) are repriced here at request time. Historic
// values (claims, activity) keep the price they were recorded at.

export function repriceWalletOverview(
  overview: WalletOverview,
  prices: Prices,
): WalletOverview {
  const locks = overview.locks.map((lock) => ({
    ...lock,
    locked: priceTokenAmount(lock.locked, prices),
    claimable: priceBreakdown(lock.claimable.tokens, prices),
  }))
  return {
    ...overview,
    claimable: priceBreakdown(overview.claimable.tokens, prices),
    locks,
  }
}

export function repriceWalletRewards(
  rewards: WalletRewards,
  prices: Prices,
): WalletRewards {
  return {
    ...rewards,
    readyToClaim: priceBreakdown(rewards.readyToClaim.tokens, prices),
    byLock: rewards.byLock.map((lock) => {
      const gauges = lock.gauges.map((gauge) => {
        const priced = priceBreakdown(gauge.tokens, prices)
        return { ...gauge, usd: priced.usd, tokens: priced.tokens }
      })
      return {
        ...lock,
        rewards: priceBreakdown(lock.rewards.tokens, prices),
        gauges,
      }
    }),
  }
}
