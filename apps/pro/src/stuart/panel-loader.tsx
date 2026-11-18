import { lazy, type ReactNode, Suspense } from "react"

/**
 * A one-line hop between the shell and the panel: the entry chunk then
 * names only this file, and the panel's dependency list ships here instead
 * of on every route's first paint.
 */

const PanelHost = lazy(() => import("./panel-host"))

export default function PanelLoader(): ReactNode {
  return (
    <Suspense fallback={null}>
      <PanelHost />
    </Suspense>
  )
}
