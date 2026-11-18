import { liveQuery, useLiveQuery } from "@matchbox/app-kit/live-query"
import { useLive } from "@matchbox/live/context"
import { useHead } from "@matchbox/live/heads"
import { createContext, type ReactNode, useContext } from "react"
import { chainSeconds, epochAt, type ShellSeed } from "./shell"
import { getShell } from "./shell-fn"

/**
 * The shell's data on screen. It starts as the root loader's seed and is
 * refreshed by the query runtime every `refreshBlocks` new heads (about a
 * minute), never on a timer, so prices do not go stale.
 */
export const shellQuery = liveQuery<ShellSeed>({
  queryKey: ["shell"],
  queryFn: () => getShell(),
  staleTime: 0,
  meta: { block: true },
})

const ShellContext = createContext<ShellSeed | null>(null)

export function ShellProvider({
  seed,
  children,
}: {
  seed: ShellSeed
  children: ReactNode
}): ReactNode {
  const shell = useLiveQuery(shellQuery, seed)
  return <ShellContext.Provider value={shell}>{children}</ShellContext.Provider>
}

export function useShell(): ShellSeed {
  const shell = useContext(ShellContext)
  if (shell === null) throw new Error("useShell must be inside ShellProvider")
  return shell
}

/**
 * Chain time and the epoch from the live head, so the countdown rolls into
 * the next epoch on time instead of sitting at 0s until a reload.
 */
export function useChainClock(): {
  now: number
  epoch: { number: number; endsAt: number }
} {
  const shell = useShell()
  const head = useHead(useLive().store)
  const now = chainSeconds(shell, head.number)
  return { now, epoch: epochAt(now) }
}
