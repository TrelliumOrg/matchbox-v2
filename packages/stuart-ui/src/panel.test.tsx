import { act, fireEvent, render, screen, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  askAboutThis,
  askStuart,
  getStuartState,
  minimizeStuart,
  openStuart,
} from "./api"
import { fixtureTransport, type StuartTransport } from "./client"
import type { StuartRequest } from "./contract"
import { barId, barInputId } from "./launcher"
import { StuartPanel, type StuartPanelProps } from "./panel"
import type { StorageLike } from "./persistence"

function memoryStorage(): StorageLike {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

/** The host's Ctrl K bar, as far as the panel cares: where to dock. */
function FakeBar(): ReactNode {
  return (
    <div id={barId}>
      <input id={barInputId} aria-label="Ask Stuart or search" />
    </div>
  )
}

// These tests wait for a condition, never for a deadline. testing-library's
// findBy and waitFor give up after one second of real time, and the work
// behind an answer (the fixtures import, rendering the table) took up to
// 2.6 s on the CI laptop under load, about 0.3 s when it is idle. So a test
// waits for the transport's turn to end inside act(), which flushes what
// React does with it, and the panel's exit and focus timers run on a fake
// clock that the test advances.

/**
 * Wraps a transport so a test can wait for every turn it started to end.
 */
function tracked(inner: StuartTransport = fixtureTransport(0)): {
  transport: StuartTransport
  settled: () => Promise<void>
} {
  const turns: Promise<void>[] = []
  return {
    transport: (request, signal, onEvent) => {
      const turn = inner(request, signal, onEvent)
      turns.push(turn.catch(() => {}))
      return turn
    },
    settled: () =>
      act(async () => {
        let waited = -1
        while (waited !== turns.length) {
          waited = turns.length
          await Promise.all(turns)
        }
      }),
  }
}

/** How long a closing panel may stay mounted (its exit plays 220 ms). */
const EXIT_WITHIN_MS = 1_000

/** The panel's exit (220 ms) and pill (180 ms) timers, and its focus frame. */
const PANEL_TIMERS = [
  "setTimeout",
  "clearTimeout",
  "requestAnimationFrame",
  "cancelAnimationFrame",
] as const

afterEach(() => {
  vi.useRealTimers()
})

function inDialog(): ReturnType<typeof within> {
  return within(screen.getByRole("dialog", { name: "Stuart" }))
}

function mount(
  props: Partial<StuartPanelProps> = {},
): ReturnType<typeof render> {
  return render(
    <>
      <FakeBar />
      <StuartPanel
        endpoint={null}
        wallet={{
          address: "0x7c21095156ab25e989c3c084bcb06037c6539e0b",
          mode: "watching",
        }}
        route="/"
        navigate={() => {}}
        transport={fixtureTransport(0)}
        storage={memoryStorage()}
        {...props}
      />
    </>,
  )
}

describe("StuartPanel", () => {
  it("opens docked as a non-modal dialog with the empty state", () => {
    act(() => openStuart())
    mount()
    const dialog = screen.getByRole("dialog", { name: "Stuart" })
    expect(dialog.getAttribute("aria-modal")).toBeNull()
    expect(dialog.className).toContain("stuart-docked")
    const suggestions = within(dialog).getByRole("list", {
      name: "Suggested questions",
    })
    expect(within(suggestions).getAllByRole("button")).toHaveLength(3)
    expect(screen.getByRole("textbox", { name: "Ask Stuart" })).toBeTruthy()
  })

  it("asks a suggested question, streams status, then announces the answer", async () => {
    const { transport, settled } = tracked()
    act(() => openStuart())
    mount({ transport })
    fireEvent.click(
      screen.getByRole("button", { name: /Which gauges pay best/ }),
    )
    await settled()
    expect(
      inDialog().getByText(/Sats Collective pays most per vote/),
    ).toBeTruthy()
    const summary = screen.getByRole("button", {
      name: "Checked 34 gauges and prices, block 13,078,795",
    })
    expect(summary.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText("Read 34 gauges")).toBeNull()
    expect(screen.getByRole("table")).toBeTruthy()
    const live = document.querySelector('[aria-live="polite"]')
    expect(live?.textContent).toMatch(/Sats Collective pays most/)
    expect(getStuartState().answering).toBe(false)
  })

  it("closes on Escape, collapsing into the bar, and returns focus to it", () => {
    act(() => openStuart())
    mount()
    const input = screen.getByRole("textbox", { name: "Ask Stuart" })
    input.focus()
    vi.useFakeTimers({ toFake: [...PANEL_TIMERS] })
    fireEvent.keyDown(input, { key: "Escape" })
    const leaving = document.getElementById("stuart-panel")
    expect(leaving?.getAttribute("data-state")).toBe("closed")
    expect(leaving?.hasAttribute("inert")).toBe(true)
    // Within a second, as the real-time wait this replaces allowed.
    act(() => vi.advanceTimersByTime(EXIT_WITHIN_MS))
    expect(document.getElementById("stuart-panel")).toBeNull()
    expect(document.activeElement?.id).toBe("stuart-bar-input")
  })

  it("restores the conversation for the same wallet after a reload", async () => {
    const storage = memoryStorage()
    const { transport, settled } = tracked()
    act(() => openStuart())
    const first = mount({ storage, transport })
    const field = screen.getByRole("textbox", { name: "Ask Stuart" })
    fireEvent.change(field, {
      target: { value: "How far is Kiln Labs from 5×?" },
    })
    fireEvent.submit(field.closest("form") as HTMLFormElement)
    await settled()
    expect(screen.getByText("To 5×")).toBeTruthy()
    first.unmount()
    mount({ storage })
    expect(screen.getByText("How far is Kiln Labs from 5×?")).toBeTruthy()
    expect(screen.getByText("To 5×")).toBeTruthy()
  })

  it("takes questions and pinned entities from the store", async () => {
    const seen: StuartRequest[] = []
    const { transport, settled } = tracked(async (request, signal, onEvent) => {
      seen.push(request)
      await fixtureTransport(0)(request, signal, onEvent)
    })
    mount({ transport })
    act(() => askAboutThis({ type: "gauge", id: "0xabc", label: "Kiln Labs" }))
    expect(screen.getByRole("dialog", { name: "Stuart" })).toBeTruthy()
    expect(
      screen.getByRole("textbox", { name: "Ask about Kiln Labs" }),
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Remove Kiln Labs" }),
    ).toBeTruthy()
    act(() => askStuart("which gauge pays best for 2207"))
    await settled()
    expect(inDialog().getByText(/Sats Collective pays most/)).toBeTruthy()
    expect(seen[0]?.surface).toBe("palette")
    expect(seen[0]?.wallet?.mode).toBe("watching")
    expect(seen[0]?.context?.page?.route).toBe("/")
    fireEvent.click(screen.getByRole("button", { name: "Remove Kiln Labs" }))
    expect(screen.getByRole("textbox", { name: "Ask Stuart" })).toBeTruthy()
  })

  it("minimizes to the pill with the status line while answering", async () => {
    const { transport, settled } = tracked(
      (_request, signal, onEvent) =>
        new Promise((_resolve, reject) => {
          onEvent({ type: "status", text: "Reading 34 gauges" })
          signal.addEventListener("abort", () => reject(signal.reason))
        }),
    )
    act(() => openStuart())
    mount({ transport })
    fireEvent.click(
      screen.getByRole("button", { name: /Which gauges pay best/ }),
    )
    expect(getStuartState().answering).toBe(true)
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy()
    vi.useFakeTimers({ toFake: [...PANEL_TIMERS] })
    act(() => minimizeStuart())
    expect(document.getElementById("stuart-panel")).not.toBeNull()
    act(() => vi.advanceTimersByTime(EXIT_WITHIN_MS))
    expect(document.getElementById("stuart-panel")).toBeNull()
    vi.useRealTimers()
    const pill = screen.getByRole("button", {
      name: /Open Stuart, Which gauges pay best/,
    })
    expect(within(pill).getByText("Reading 34 gauges")).toBeTruthy()
    fireEvent.click(pill)
    expect(screen.getByRole("dialog", { name: "Stuart" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Stop" }))
    await settled()
    expect(screen.getByText("Stopped")).toBeTruthy()
  })

  it("shows busy with a retry that asks again", async () => {
    const inner = vi.fn<StuartTransport>(async (_request, _signal, onEvent) => {
      onEvent({ type: "busy", reason: "spend_cap", retryAfterSeconds: 60 })
      onEvent({ type: "done" })
    })
    const { transport, settled } = tracked(inner)
    act(() => openStuart())
    mount({ transport })
    fireEvent.click(
      screen.getByRole("button", { name: /Which gauges pay best/ }),
    )
    await settled()
    expect(inDialog().getByText("Busy, try again")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await settled()
    expect(inner).toHaveBeenCalledTimes(2)
  })

  it("expands to history plus thread and pushes the page on wide screens", async () => {
    const { transport, settled } = tracked()
    act(() => openStuart())
    mount({ transport })
    fireEvent.click(
      screen.getByRole("button", { name: /Which gauges pay best/ }),
    )
    await settled()
    expect(inDialog().getByText(/Sats Collective pays most/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Expand" }))
    expect(screen.getByRole("dialog").className).toContain("stuart-expanded")
    expect(document.documentElement.hasAttribute("data-stuart-expanded")).toBe(
      true,
    )
    const history = screen.getByRole("navigation", { name: "Conversations" })
    expect(
      within(history).getByRole("button", { name: "New chat" }),
    ).toBeTruthy()
    fireEvent.click(within(history).getByRole("button", { name: "New chat" }))
    expect(
      screen.getByRole("list", { name: "Suggested questions" }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }))
    expect(document.documentElement.hasAttribute("data-stuart-expanded")).toBe(
      false,
    )
  })
})

describe("StuartPanel on phones", () => {
  it("is a modal half sheet with a keyboard alternative to dragging", () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({
      ...original.call(window, query),
      matches: query.includes("max-width"),
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as typeof window.matchMedia
    try {
      act(() => openStuart())
      mount()
      const dialog = screen.getByRole("dialog", { name: "Stuart" })
      expect(dialog.getAttribute("aria-modal")).toBe("true")
      expect(dialog.className).toContain("stuart-sheet-half")
      fireEvent.click(screen.getByRole("button", { name: "Full height" }))
      expect(dialog.className).toContain("stuart-sheet-full")
      fireEvent.click(screen.getByRole("button", { name: "Half height" }))
      expect(dialog.className).toContain("stuart-sheet-half")
      expect(screen.queryByRole("button", { name: "Expand" })).toBeNull()
    } finally {
      window.matchMedia = original
    }
  })
})
