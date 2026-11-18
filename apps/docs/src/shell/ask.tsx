import { lazy, type ReactNode, Suspense } from "react"
import { createToggle, search } from "./store"

/**
 * "Ask about this page": the open state and the host for the lazy panel.
 * A build without Stuart (no VITE_STUART_URL) opens search instead, and so
 * does the panel when Stuart cannot answer.
 */

const endpoint = __DOCS_STUART_ORIGIN__

function loadPanel(): Promise<unknown> {
  return import("./ask-panel")
}

const ask = createToggle(loadPanel)

/** Opens the panel with this page pinned, or search with its title. */
export function askAboutPage(path: string, title: string): void {
  if (endpoint === null) {
    search.open(title)
    return
  }
  ask.open(path)
}

export function warmAsk(): void {
  if (endpoint !== null) ask.warm()
}

function fallBackToSearch(question: string): void {
  ask.close()
  search.open(question)
}

const AskPanel = lazy(() => import("./ask-panel"))

export function AskHost(): ReactNode {
  const state = ask.use()
  if (endpoint === null || !state.requested) return null
  return (
    <Suspense fallback={null}>
      <AskPanel
        open={state.open}
        endpoint={endpoint}
        page={state.value === "/" ? null : state.value}
        onClose={ask.close}
        onFallback={fallBackToSearch}
      />
    </Suspense>
  )
}
