import { useEffect, useState } from "react"
import { exitMs } from "./easing"
import { prefersReducedMotion } from "./reduced-motion"

/* Its own module, like flip.ts, so only routes with such lists load it. */

export type PresenceItem<T> = { item: T; key: string; leaving: boolean }

type ListState<T> = {
  /** The keys, joined: lists are compared by keys, not identity. */
  signature: string
  items: readonly T[]
  leaving: { item: T; key: string; index: number }[]
}

/**
 * A list whose removed items stay, marked leaving, for `ms` at their old
 * place. Render `data-leaving` on them (the UI stylesheet fades them out
 * and makes them inert) and pair with `useFlip` so the rest slide into
 * place. A list that is swapped wholesale (no key in common with a new,
 * non-empty list) drops the old items at once: only the new ones fade in.
 */
export function usePresenceList<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  ms: number = exitMs,
): PresenceItem<T>[] {
  const keys = items.map(keyOf)
  const signature = keys.join("\n")
  const [state, setState] = useState<ListState<T>>({
    signature,
    items,
    leaving: [],
  })
  if (state.signature !== signature) {
    const now = new Set(keys)
    const before = state.items.map(keyOf)
    const shared = now.size === 0 || before.some((key) => now.has(key))
    const gone = shared
      ? state.items.flatMap((item, index) => {
          const key = keyOf(item)
          return now.has(key) ? [] : [{ item, key, index }]
        })
      : []
    const still = state.leaving.filter((entry) => shared && !now.has(entry.key))
    setState({
      signature,
      items,
      leaving: prefersReducedMotion() ? [] : [...still, ...gone],
    })
  }

  useEffect(() => {
    if (state.leaving.length === 0) return
    const timer = setTimeout(
      () => setState((current) => ({ ...current, leaving: [] })),
      ms,
    )
    return () => clearTimeout(timer)
  }, [state.leaving, ms])

  const list: PresenceItem<T>[] = items.map((item, index) => ({
    item,
    key: keys[index] ?? "",
    leaving: false,
  }))
  for (const entry of [...state.leaving].sort((a, b) => a.index - b.index)) {
    list.splice(Math.min(entry.index, list.length), 0, {
      item: entry.item,
      key: entry.key,
      leaving: true,
    })
  }
  return list
}
