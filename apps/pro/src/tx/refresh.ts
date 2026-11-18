import { loadQueryRuntime } from "../data/live-query"
import type { HeadStore } from "../live/heads"
import { noteWrite } from "./fresh-after"

/**
 * After a transaction lands, refetches the read models it changed once the
 * BlockHub head passes the receipt's block, without a reload, and asks the
 * API for answers that include that block (`./fresh-after`). The usual
 * block-tied refresh keeps following after that.
 *
 * It refetches more than once. The first answer is the wallet as the chain
 * has it, which is nearly always enough. The later ones pick up what
 * arrives after: an RPC node that was a block behind, the gauge directory's
 * next refresh (every minute) and the indexed Activity row.
 */

export type RefreshTarget =
  | "overview"
  | "voter"
  | "rewards"
  | "activity"
  | "gauges"
  | "gauge"
  | "home"

/** Blocks past the receipt's at which the targets are refetched. */
export const refreshAfterBlocks = [1, 4, 10, 18, 26] as const

const gaugeTargets: readonly RefreshTarget[] = ["gauges", "gauge", "home"]

export function refreshAfterBlock(input: {
  store: HeadStore
  block: bigint
  targets: readonly RefreshTarget[]
  address: string
  /** Runs the refetch; the query runtime's by default. */
  refresh?: (
    targets: readonly RefreshTarget[],
    address: string,
  ) => Promise<void> | void
}): () => void {
  noteWrite({
    address: input.address,
    block: input.block,
    gauges: input.targets.some((target) => gaugeTargets.includes(target)),
  })
  const refresh =
    input.refresh ??
    ((targets, address) =>
      loadQueryRuntime().then((runtime) =>
        runtime.refreshQueries(targets, address),
      ))
  let next = 0
  let stopped = false
  function run(): void {
    if (stopped) return
    const head = BigInt(input.store.get().number)
    let due = false
    // A head that jumped several blocks runs one refetch, not one per step.
    while (
      next < refreshAfterBlocks.length &&
      head >= input.block + BigInt(refreshAfterBlocks[next] ?? 0)
    ) {
      next += 1
      due = true
    }
    if (next >= refreshAfterBlocks.length) stop()
    if (due) void refresh(input.targets, input.address)
  }
  function stop(): void {
    stopped = true
    unsubscribe()
  }
  const unsubscribe = input.store.subscribe(run)
  run()
  return stop
}
