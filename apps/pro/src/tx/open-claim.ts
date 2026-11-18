import { fetchLive } from "../data/live-query"
import { overviewQuery, rewardsQuery } from "../data/queries"
import type { LockRef } from "../data/view-models"
import type { Viewer } from "../lib/viewer"
import { openWallet } from "../wallet/wallet-store"
import { loadTx, openTx } from "./tx-store"

/** Opens the claim sheet with fresh rewards and locks for the wallet. */
export async function openClaim(
  viewer: Viewer,
  options: { relock: boolean; only?: LockRef },
): Promise<void> {
  if (viewer.kind === "signed-out") {
    openWallet()
    return
  }
  const [host, rewards, overview] = await Promise.all([
    loadTx(),
    fetchLive(rewardsQuery(viewer.address)),
    fetchLive(overviewQuery(viewer.address)).catch(() => null),
  ])
  openTx(viewer, host.claimRequest(rewards, overview, options))
}
