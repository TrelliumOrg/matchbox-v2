import { enterMs, usePresenceList } from "@matchbox/motion"
import * as Toast from "@matchbox/ui/toast"
import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { groupThousands } from "../lib/format"
import { scanTxUrl } from "./steps"

/**
 * Transaction toasts (`djpvmOKrvM`): lower left, 6s, paused while hovered
 * or focused, with the block and "View on Matchscan". A transaction that
 * failed on chain mirrors it with tone "negative" (red x, red line).
 */

export { scanTxUrl }

export type ToastItem = {
  id: number
  title: string
  block: bigint | null
  hash: string | null
  tone: "positive" | "negative"
}

const toastMs = 6000
let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit(next: ToastItem[]): void {
  items = next
  for (const listener of listeners) listener()
}

export function showToast(toast: Omit<ToastItem, "id">): void {
  emit([...items.slice(-2), { ...toast, id: nextId++ }])
}

function dismiss(id: number): void {
  emit(items.filter((item) => item.id !== id))
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function TimedToast({
  item,
  leaving,
}: {
  item: ToastItem
  leaving: boolean
}): ReactNode {
  const [paused, setPaused] = useState(false)
  const left = useRef(toastMs)
  const started = useRef(Date.now())

  useEffect(() => {
    if (paused || leaving) return
    started.current = Date.now()
    const timer = setTimeout(() => dismiss(item.id), left.current)
    return () => {
      clearTimeout(timer)
      left.current -= Date.now() - started.current
    }
  }, [paused, leaving, item.id])

  return (
    <Toast.Root
      title={item.title}
      tone={item.tone}
      leaving={leaving}
      data-flip={String(item.id)}
      duration={toastMs}
      paused={paused}
      onClose={() => dismiss(item.id)}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {item.block === null ? null : (
        <span className="tabular-nums">Block {groupThousands(item.block)}</span>
      )}
      {item.hash === null ? null : (
        <a
          href={scanTxUrl(item.hash)}
          target="_blank"
          rel="noreferrer noopener"
        >
          View on Matchscan
        </a>
      )}
    </Toast.Root>
  )
}

function toastKey(item: ToastItem): string {
  return String(item.id)
}

export function Toasts(): ReactNode {
  const list = useSyncExternalStore(
    subscribe,
    () => items,
    () => items,
  )
  // Dismissed toasts slide back down before they go.
  const shown = usePresenceList(list, toastKey, enterMs)
  if (shown.length === 0) return null
  // The stack closes up when a toast goes; toasts have their own entry.
  // Where it docks on a phone is `--toast-bottom` (styles.css).
  return (
    <Toast.Viewport data-flip-list="quiet">
      {shown.map(({ item, key, leaving }) => (
        <TimedToast key={key} item={item} leaving={leaving} />
      ))}
    </Toast.Viewport>
  )
}
