import { createServerFn } from "@tanstack/react-start"
import { addressActivity, addressVotes, loanHistory } from "./address.server"
import { withMezoIds } from "./scan/mezo-names.server"
import { nameVotes } from "./scan/names"
import { knownNames } from "./scan/names.server"
import { walletRewards, walletStreak } from "./wallet.server"

/** The address page's tab reads (work in address.server). */

export type { VotesByEpoch } from "./address.server"
export type { StreakView, WalletView } from "./wallet-views"

function identity<T>(input: T): T {
  return input
}

export const getAddressVotes = createServerFn({ method: "GET" })
  .validator(identity<{ address: string }>)
  .handler(async ({ data }) => {
    const [votes, names] = await Promise.all([addressVotes(data), knownNames()])
    return votes.status === "ok"
      ? {
          ...votes,
          data: { ...votes.data, epochs: nameVotes(votes.data.epochs, names) },
        }
      : votes
  })

export const getAddressActivity = createServerFn({ method: "GET" })
  .validator(identity<{ address: string; cursor: string | null }>)
  .handler(async ({ data }) => withMezoIds(await addressActivity(data)))

export const getLoanHistory = createServerFn({ method: "GET" })
  .validator(identity<{ address: string }>)
  .handler(({ data }) => loanHistory(data))

const anAddress = /^0x[0-9a-f]{40}$/

/**
 * A lock owner's rewards, veMEZO votes and voting streak (wallet.server),
 * read beside each other.
 */
export const getWalletPanels = createServerFn({ method: "GET" })
  .validator(identity<{ address: string }>)
  .handler(async ({ data }) => {
    if (!anAddress.test(data.address)) {
      return {
        wallet: { status: "unavailable" as const },
        streak: { status: "unavailable" as const },
      }
    }
    const [wallet, streak] = await Promise.all([
      walletRewards(data.address),
      walletStreak(data.address),
    ])
    return { wallet, streak }
  })
