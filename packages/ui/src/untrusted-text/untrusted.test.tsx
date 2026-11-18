import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as RawViewer from "../raw-viewer"
import { cleanUntrusted, plainUntrusted, Root } from "./index"

afterEach(cleanup)

/**
 * Room for the two timing tests on a slow runner: they clean a megabyte a
 * dozen times, which took 8.8 s on the CI laptop against vitest's default
 * 5 s. What they assert is a ratio, so how long they take does not matter.
 */
const timingTestMs = 60_000

/** The best of several timings, after one warm-up run, in ms. */
function fastest(work: () => void, runs = 5): number {
  work()
  let best = Number.POSITIVE_INFINITY
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now()
    work()
    best = Math.min(best, performance.now() - started)
  }
  return best
}

/**
 * The hidden characters, built from code points so this file holds none
 * of them literally (a source full of invisible characters is its own
 * Trojan Source risk).
 */
const char = (point: number): string => String.fromCodePoint(point)
const rlo = char(0x202e)
const lri = char(0x2066)
const pdi = char(0x2069)
const zwsp = char(0x200b)
const rlm = char(0x200f)
const bom = char(0xfeff)
const bell = char(0x07)

/** True when any character of `text` would have been escaped. */
function hasHidden(text: string): boolean {
  return [...text].some((each) =>
    [0x202e, 0x2066, 0x2069, 0x200b, 0x200f, 0xfeff, 0x07].includes(
      each.codePointAt(0) ?? 0,
    ),
  )
}

describe("untrusted text", () => {
  it("escapes bidi overrides, isolates, marks and zero-width characters", () => {
    // "USDC" spelt backwards behind a right-to-left override.
    expect(plainUntrusted(`${rlo}CDSU`)).toBe("[U+202E]CDSU")
    expect(plainUntrusted(`a${lri}b${pdi}c`)).toBe("a[U+2066]b[U+2069]c")
    expect(plainUntrusted(`MU${zwsp}SD`)).toBe("MU[U+200B]SD")
    expect(plainUntrusted(`x${rlm}y${bom}`)).toBe("x[U+200F]y[U+FEFF]")
    expect(plainUntrusted(`line\nbreak${bell}`)).toBe(
      "line[U+000A]break[U+0007]",
    )
    expect(plainUntrusted("Mezo USD")).toBe("Mezo USD")
    expect(plainUntrusted("比特币 🪙")).toBe("比特币 🪙")
  })

  it("cuts long values and says so", () => {
    expect(cleanUntrusted("a".repeat(300), 10)).toEqual({
      segments: [{ kind: "text", text: "a".repeat(10) }],
      truncated: true,
    })
    expect(plainUntrusted("abcdef", 3)).toBe("abc…")
  })

  // Timing is compared within one run, never against a fixed number of
  // milliseconds: a loaded machine slows both sides alike.
  it(
    "reads no further than its limit on a megabyte",
    () => {
      const huge = rlo.repeat(500_000) + "x".repeat(500_000)
      const capped = fastest(() => cleanUntrusted(huge, 200))
      const whole = fastest(() => cleanUntrusted(huge, huge.length))
      // Reading only the first 200 characters costs a sliver of reading all
      // of them; reading everything first would cost about the same.
      expect(capped * 20).toBeLessThan(whole)
    },
    timingTestMs,
  )

  it(
    "grows linearly with what it reads",
    () => {
      // One hidden character in every 32: escapes all through, without an
      // object per character dominating the timing.
      const hostile = (length: number) =>
        `${rlo}${"a".repeat(31)}`.repeat(length / 32)
      // Each size's best of several runs, so one slow run (a collection,
      // another process on the runner) cannot make a size look slower.
      const time = (length: number) => {
        const text = hostile(length)
        return fastest(() => cleanUntrusted(text, text.length), 7)
      }
      const small = time(10_240)
      const large = time(1_024_000)
      // A hundred times the input: about 100 times the time if linear,
      // about 10,000 if quadratic. The limit sits ten times clear of both.
      expect(large / small).toBeLessThan(1_000)
    },
    timingTestMs,
  )

  it("renders inside an isolating bdi with visible escapes", () => {
    const html = renderToStaticMarkup(<Root value={`${rlo}evil`} />)
    expect(html.startsWith("<bdi")).toBe(true)
    expect(html).toContain("unicode-bidi:isolate")
    expect(html).toContain(">U+202E<")
    expect(hasHidden(html)).toBe(false)
  })
})

describe("raw viewer with big and hostile values", () => {
  it("shows the first 8 KB, the rest on request, and copies it all", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    const data = `0x${"ab".repeat(512 * 1024)}`
    const { container } = render(
      <RawViewer.Root
        title="Input"
        decoded={null}
        raw={{ kind: "input", data }}
      />,
    )
    const pre = container.querySelector("pre")
    expect(pre?.textContent?.length).toBeLessThan(RawViewer.previewChars + 40)
    await user.click(screen.getByRole("button", { name: /Show all/ }))
    expect(container.querySelector("pre")?.textContent).toContain(data)
    await user.click(screen.getByRole("button", { name: "Copy" }))
    expect(writeText).toHaveBeenCalledWith(data)
  })

  it("escapes control characters in decoded names and values", () => {
    const { container } = render(
      <RawViewer.Root
        title="Input"
        decoded={{
          name: `transfer${rlo}(address to)`,
          params: [
            { name: `to${zwsp}`, type: "string", value: `gpj.exe${rlo}txt` },
          ],
        }}
        raw={{ kind: "input", data: "0x" }}
      />,
    )
    expect(hasHidden(container.textContent ?? "")).toBe(false)
    expect(container.textContent).toContain("U+202E")
    expect(container.querySelectorAll("bdi").length).toBeGreaterThanOrEqual(3)
  })
})
