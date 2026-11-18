import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { MorphText, preloadMorphText } from "./morph-text"

describe("MorphText under happy-dom", () => {
  const unhandled: unknown[] = []
  const record = (reason: unknown): void => {
    unhandled.push(reason)
  }

  afterEach(() => {
    cleanup()
    process.off("unhandledRejection", record)
    unhandled.length = 0
  })

  // What failed stuart-ui's panel test on the CI laptop: the text changes
  // and the component unmounts while torph's animations are still running,
  // and each cancelled one surfaced as an unhandled AbortError. The setup
  // file's handleCancelledAnimations is what keeps this quiet.
  it("changes and unmounts mid-morph without unhandled errors", async () => {
    process.on("unhandledRejection", record)
    await preloadMorphText()
    const view = render(<MorphText>Reading 34 gauges</MorphText>)
    view.rerender(<MorphText>Comparing incentives</MorphText>)
    view.rerender(<MorphText>Sats Collective pays most</MorphText>)
    view.unmount()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(unhandled).toEqual([])
  })
})
