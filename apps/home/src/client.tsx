import { StartClient } from "@tanstack/react-start/client"
import { StrictMode, startTransition } from "react"
import { hydrateRoot } from "react-dom/client"

/**
 * The homepage's client entry: TanStack Start's default (hydrate the document
 * in a transition), started only after the first frame is painted. The
 * entry is an async module script, preloaded in the head, so on a slow CPU
 * it could run and hydrate the whole page before the browser painted the
 * server's HTML, holding the LCP element behind hydration. Two animation
 * frames let the server-rendered page paint first; hydration follows at
 * once. Without requestAnimationFrame (a background tab), it hydrates now.
 */

function hydrate(): void {
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <StartClient />
      </StrictMode>,
    )
  })
}

if (typeof requestAnimationFrame === "function" && !document.hidden) {
  requestAnimationFrame(() => requestAnimationFrame(hydrate))
} else {
  hydrate()
}
