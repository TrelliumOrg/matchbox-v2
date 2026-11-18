import { act, type ReactNode } from "react"
import { createRoot, hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"
import { useMountedAfterHydration } from "./app-ready"

function Probe(): ReactNode {
  return <p>{useMountedAfterHydration() ? "after" : "hydrating"}</p>
}

let container: HTMLElement | null = null

afterEach(() => {
  container?.remove()
  container = null
})

function mount(): HTMLElement {
  container = document.createElement("div")
  document.body.appendChild(container)
  return container
}

describe("whether a component mounted after the page hydrated", () => {
  it("says no on the server", () => {
    expect(renderToString(<Probe />)).toContain("hydrating")
  })

  it("says no while hydrating the server's HTML, however late, and keeps saying it", async () => {
    const box = mount()
    box.innerHTML = renderToString(<Probe />)
    const errors: unknown[] = []
    // Long after the document loaded, as a route's view hydrates: the old
    // flag was already set by then, and the render no longer matched.
    await act(async () => {
      hydrateRoot(box, <Probe />, {
        onRecoverableError: (error) => errors.push(error),
      })
    })
    expect(errors).toEqual([])
    expect(box.textContent).toBe("hydrating")
  })

  it("says yes for a component the browser mounts by itself", async () => {
    const box = mount()
    await act(async () => {
      createRoot(box).render(<Probe />)
    })
    expect(box.textContent).toBe("after")
  })
})
