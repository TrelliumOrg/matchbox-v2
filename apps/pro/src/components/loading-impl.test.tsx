import { readFileSync } from "node:fs"
import { join } from "node:path"
import { skeletonTheme } from "@matchbox/motion"
import { darkPresets } from "@matchbox/tokens"
import { act } from "react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import LoadingImpl from "./loading-impl"

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ options: { ssr: { nonce: "test-nonce" } } }),
}))

const sample = <p>Sample band</p>

let container: HTMLElement | null = null

afterEach(() => {
  container?.remove()
  container = null
  document.documentElement.removeAttribute("data-theme")
})

/** The skeleton's theme style, which carries the shimmer colours. */
function themeStyle(root: HTMLElement): string {
  const style = [...root.querySelectorAll("style")].find((element) =>
    element.textContent?.startsWith(":root { --skullet-base"),
  )
  return style?.textContent ?? ""
}

describe("the loading skeleton", () => {
  it("gives its inline scripts this response's nonce", () => {
    const html = renderToString(
      <LoadingImpl id="test-band" label="Loading boost" sample={sample} />,
    )
    const scripts = html.match(/<script[^>]*>/g) ?? []
    expect(scripts.length).toBeGreaterThan(0)
    for (const script of scripts) expect(script).toContain('nonce="test-nonce"')
  })

  it("hydrates in the dark theme without a mismatch or a switch", async () => {
    // The server cannot see the theme: it renders with no data-theme.
    container = document.createElement("div")
    document.body.appendChild(container)
    container.innerHTML = renderToString(
      <LoadingImpl id="test-band" label="Loading boost" sample={sample} />,
    )
    const served = themeStyle(container)
    expect(served).toContain(skeletonTheme.light.base)
    // The pre-paint theme script then painted a dark preset.
    document.documentElement.setAttribute("data-theme", "graphite")
    const errors: unknown[] = []
    const box = container
    await act(async () => {
      hydrateRoot(
        box,
        <LoadingImpl id="test-band" label="Loading boost" sample={sample} />,
        { onRecoverableError: (error) => errors.push(error) },
      )
    })
    expect(errors).toEqual([])
    // The style stays as served: the dark colours come from styles.css, so
    // a slow device no longer shows the light shimmer until a re-render.
    expect(themeStyle(box)).toBe(served)
  })

  it("takes the dark shimmer from the stylesheet in every dark preset", () => {
    // Read as written: Vitest does not load CSS.
    const css = readFileSync(join(__dirname, "../styles.css"), "utf8")
    const start = css.indexOf(":root:is(")
    const rule = css.slice(start, css.indexOf("}", start))
    const themes = [...rule.matchAll(/data-theme="([a-z]+)"/g)].map(
      (match) => match[1],
    )
    expect(themes).toEqual([...darkPresets])
    // The formatter writes ".08" as "0.08".
    const colour = (value: string): string => value.replace(/ \.(\d)/g, " 0.$1")
    expect(rule).toContain(
      `--skullet-base: ${colour(skeletonTheme.dark.base)};`,
    )
    expect(rule).toContain(
      `--skullet-highlight: ${colour(skeletonTheme.dark.highlight)};`,
    )
  })
})
