import { whenIdle } from "@matchbox/motion"
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react"
import { useWelcome } from "./welcome-store"

const WelcomeDialog = lazy(() =>
  import("./welcome-dialog").then((module) => ({
    default: module.WelcomeDialog,
  })),
)

/** The dialog waits this long after load, then for an idle moment. */
const settleMs = 900

/**
 * In the shell on every page. Mounts the welcome dialog for a browser that
 * has not seen it (see `welcome-store`), after the page has painted and
 * settled, so it never delays first paint or the largest paint. The
 * dialog's code loads only then.
 */
export function WelcomeMount(): ReactNode {
  const welcome = useWelcome()
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    if (welcome !== "showing" || settled) return
    let cancelIdle: () => void = () => {}
    const timer = setTimeout(
      () => {
        cancelIdle = whenIdle(() => setSettled(true))
      },
      Math.max(0, settleMs - performance.now()),
    )
    return () => {
      clearTimeout(timer)
      cancelIdle()
    }
  }, [welcome, settled])

  if (welcome !== "showing" || !settled) return null
  return (
    <Suspense fallback={null}>
      <WelcomeDialog />
    </Suspense>
  )
}
