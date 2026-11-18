import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { resetStuart } from "@matchbox/stuart-ui/store"
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"
import { getStuartState, StuartSearchButton } from "./index"
import { barPlaceholder, StuartBar } from "./stuart-bar"

const here = dirname(fileURLToPath(import.meta.url))

afterEach(() => resetStuart())

/** The bar navigates with Pro's router, so tests give it one. */
function withRouter(children: ReactNode): ReactNode {
  const rootRoute = createRootRoute({ component: () => children })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
  return <RouterProvider router={router} />
}

async function mountBar(): Promise<HTMLInputElement> {
  render(withRouter(<StuartBar />))
  const input = await screen.findByRole("combobox", { name: barPlaceholder })
  if (!(input instanceof HTMLInputElement)) throw new Error("input")
  return input
}

describe("Stuart's Ctrl K bar", () => {
  it("is the real input with the dog and the OS key caps", async () => {
    const input = await mountBar()
    expect(input.id).toBe("stuart-bar-input")
    expect(input.placeholder).toBe("Ask Stuart or search gauges, wallets, txs")
    const bar = document.getElementById("stuart-bar")
    expect(bar?.tagName).toBe("SEARCH")
    // Both mod caps ship; the server-stamped data-platform picks one (H7).
    expect(bar?.querySelector('[aria-label="Command"]')).not.toBeNull()
    expect(bar?.querySelector('[aria-label="Control"]')).not.toBeNull()
    expect(bar?.querySelector('path[stroke="var(--acc)"]')).not.toBeNull()
  })

  it("loads the panel on intent and asks Stuart on Enter", async () => {
    const input = await mountBar()
    fireEvent.focus(input)
    expect(getStuartState().wanted).toBe(true)
    fireEvent.change(input, { target: { value: "claim all my rewards" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() =>
      expect(getStuartState().ask?.question).toBe("claim all my rewards"),
    )
    expect(getStuartState().view).toBe("docked")
    expect(input.value).toBe("")
  })

  it("focuses on Ctrl K and on Cmd K, on every OS", async () => {
    const input = await mountBar()
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true }),
      )
    })
    expect(document.activeElement).toBe(input)
    input.blur()
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "K", metaKey: true }),
      )
    })
    expect(document.activeElement).toBe(input)
  })

  it("opens the phone search sheet from the top bar's icon", () => {
    render(<StuartSearchButton />)
    fireEvent.click(
      screen.getByRole("button", { name: "Ask Stuart or search" }),
    )
    expect(getStuartState().searchOpen).toBe(true)
  })
})

describe("Stuart's first paint", () => {
  it("server renders the bar only", async () => {
    const rootRoute = createRootRoute({ component: () => <StuartBar /> })
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    })
    await router.load()
    const html = renderToString(<RouterProvider router={router} />)
    expect(html).toContain('id="stuart-bar"')
    expect(html).not.toContain("stuart-panel")
    expect(html).not.toContain('role="listbox"')
  })

  it("keeps the panel, the search sheet and zod behind intent", () => {
    const index = readFileSync(resolve(here, "index.ts"), "utf8")
    const specifiers = [...index.matchAll(/from\s+"([^"]+)"/g)].map(
      (match) => match[1],
    )
    expect(specifiers.sort()).toEqual([
      "./search-button",
      "@matchbox/stuart-ui/store",
    ])
    const mount = readFileSync(resolve(here, "stuart-mount.tsx"), "utf8")
    expect(mount).not.toMatch(/stuart-ui\/(panel|contract|search)|from "zod"/)
    expect(mount).toContain('import("./panel-loader")')
    const bar = readFileSync(resolve(here, "stuart-bar.tsx"), "utf8")
    expect(bar).not.toMatch(
      /from "@matchbox\/stuart-ui\/(panel|contract)"|from "zod"/,
    )
    expect(bar).toMatch(
      /import type \{ SearchController \} from "@matchbox\/stuart-ui\/search"/,
    )
    expect(bar).toContain('import("./search-loader")')
  })
})
