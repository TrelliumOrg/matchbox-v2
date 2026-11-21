import type {
  ActivityRow,
  ClaimValue,
  RewardClaim,
  WalletActivity,
  WalletRewards,
} from "@matchbox/contracts/read-models"

// A run that could not read the daily prices (claim-prices.ts) builds its
// claims without their values when claimed. Written as built, every claim
// would read "Value when claimed pending" for a run and be rewritten back
// on the next, so the stored documents' values are kept instead: by row
// id, or by transaction (a claim transaction is one row). A document that
// changed for nothing else is then the same as before, and not rewritten.

type Documents = {
  overview: { recentActivity: ActivityRow[] }
  rewards: { history: RewardClaim[] }
  activity: { rows: ActivityRow[] }
}

function valued(
  row: Extract<ActivityRow, { type: "claim" }>,
  value: ClaimValue,
): ActivityRow {
  const { estimate: _estimate, ...rest } = row
  return { ...rest, atClaim: value }
}

/** `built` with the values when claimed the stored documents hold. */
export default function keepClaimValues<Built extends Documents>(
  built: Built,
  previous: {
    activity: WalletActivity | null | undefined
    rewards: WalletRewards | null | undefined
  },
): Built {
  const byId = new Map<string, ClaimValue>()
  const byTx = new Map<string, ClaimValue>()
  for (const row of previous.activity?.rows ?? []) {
    if (row.type !== "claim" || row.atClaim === undefined) continue
    byId.set(row.id, row.atClaim)
    byTx.set(row.txHash, row.atClaim)
  }
  for (const claim of previous.rewards?.history ?? []) {
    if (claim.atClaim !== undefined) byTx.set(claim.txHash, claim.atClaim)
  }
  if (byTx.size === 0) return built
  const keep = (row: ActivityRow): ActivityRow => {
    if (row.type !== "claim" || row.atClaim !== undefined) return row
    const value = byId.get(row.id) ?? byTx.get(row.txHash)
    return value === undefined ? row : valued(row, value)
  }
  return {
    ...built,
    overview: {
      ...built.overview,
      recentActivity: built.overview.recentActivity.map(keep),
    },
    rewards: {
      ...built.rewards,
      history: built.rewards.history.map((claim) => {
        if (claim.atClaim !== undefined) return claim
        const value = byTx.get(claim.txHash)
        if (value === undefined) return claim
        const { estimate: _estimate, ...rest } = claim
        return { ...rest, atClaim: value }
      }),
    },
    activity: { ...built.activity, rows: built.activity.rows.map(keep) },
  }
}
