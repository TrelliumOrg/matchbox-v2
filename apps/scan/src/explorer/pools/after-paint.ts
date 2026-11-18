import { useEffect, useState } from "react"

/**
 * A pool panel's read once the page has painted: one request per key
 * however many panels ask (`pending`, the caller's), dropped when it
 * fails so a later mount asks again. "waiting" until it answers.
 */
export function useAfterPaint<T>(
  key: string,
  pending: Map<string, Promise<T>>,
  read: () => Promise<T>,
): T | "waiting" | "failed" {
  // The answer carries its key: moving to another pool in the app keeps
  // this component, and the last pool's answer must not show for the new
  // one while its read is in flight.
  const [state, setState] = useState<{
    key: string
    value: T | "failed"
  } | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: one read per key; `pending` and `read` are the caller's, closed over it
  useEffect(() => {
    let live = true
    let request = pending.get(key)
    if (request === undefined) {
      request = read()
      pending.set(key, request)
    }
    request.then(
      (data) => {
        if (live) setState({ key, value: data })
      },
      () => {
        pending.delete(key)
        if (live) setState({ key, value: "failed" })
      },
    )
    return () => {
      live = false
    }
  }, [key])
  return state !== null && state.key === key ? state.value : "waiting"
}
