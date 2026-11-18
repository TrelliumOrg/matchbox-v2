import { afterEach, describe, expect, it, vi } from "vitest"
import {
  resetViewTransitions,
  skipViewTransition,
  trackViewTransitions,
} from "./view-transitions"

afterEach(() => resetViewTransitions())

function fakeDocument() {
  const started: { skipTransition: ReturnType<typeof vi.fn> }[] = []
  const doc = {
    startViewTransition: vi.fn(() => {
      const transition = {
        finished: new Promise<void>(() => {}),
        skipTransition: vi.fn(),
      }
      started.push(transition)
      return transition
    }),
  }
  return { doc: doc as unknown as Document, started }
}

describe("view transitions", () => {
  it("skips the running transition when the next one starts", () => {
    const { doc, started } = fakeDocument()
    trackViewTransitions(doc)
    const start = (
      doc as unknown as { startViewTransition: (u: unknown) => unknown }
    ).startViewTransition
    start(() => {})
    start(() => {})
    expect(started[0]?.skipTransition).toHaveBeenCalledOnce()
    expect(started[1]?.skipTransition).not.toHaveBeenCalled()
  })

  it("skips the running transition when a navigation begins", () => {
    const { doc, started } = fakeDocument()
    trackViewTransitions(doc)
    ;(
      doc as unknown as { startViewTransition: (u: unknown) => unknown }
    ).startViewTransition(() => {})
    skipViewTransition()
    expect(started[0]?.skipTransition).toHaveBeenCalledOnce()
    skipViewTransition()
    expect(started[0]?.skipTransition).toHaveBeenCalledOnce()
  })

  it("leaves documents without view transitions alone", () => {
    const doc = {} as Document
    trackViewTransitions(doc)
    expect("startViewTransition" in doc).toBe(false)
  })
})
