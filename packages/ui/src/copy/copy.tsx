import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"

/**
 * Copying to the clipboard, with feedback everyone gets: the result is
 * announced from a live region beside the button (inside a labelled
 * button, text is folded into the button's name and may never be read),
 * and a refused clipboard says "Copy failed" instead of failing silently.
 */

export type CopyState = "idle" | "copied" | "failed"

export const copyFeedbackMs = 1500

export function useCopy(value: string): {
  state: CopyState
  copy: () => Promise<void>
} {
  const [state, setState] = useState<CopyState>("idle")
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )
  const copy = useCallback(async (): Promise<void> => {
    let next: CopyState = "copied"
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        throw new Error("No clipboard")
      }
      await navigator.clipboard.writeText(value)
    } catch {
      next = "failed"
    }
    setState(next)
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState("idle"), copyFeedbackMs)
  }, [value])
  return { state, copy }
}

const spoken: Record<CopyState, string> = {
  idle: "",
  copied: "Copied",
  failed: "Copy failed",
}

/** The live region that announces a copy. Render it beside the button. */
export function CopyStatus({ state }: { state: CopyState }): ReactNode {
  return (
    <span role="status" className="sr-only">
      {spoken[state]}
    </span>
  )
}
