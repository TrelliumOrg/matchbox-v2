import { afterEach, describe, expect, it } from "vitest"
import { handleCancelledAnimations } from "./testing"

describe("handleCancelledAnimations", () => {
  const unhandled: unknown[] = []
  const record = (reason: unknown): void => {
    unhandled.push(reason)
  }

  afterEach(() => {
    process.off("unhandledRejection", record)
    unhandled.length = 0
  })

  it("lets an animation be cancelled mid-flight without an unhandled rejection", async () => {
    handleCancelledAnimations()
    // Applying it twice wraps cancel once.
    handleCancelledAnimations()
    process.on("unhandledRejection", record)
    const element = document.createElement("span")
    document.body.append(element)
    const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 10_000,
    })
    expect(animation.playState).toBe("running")
    animation.cancel()
    expect(animation.playState).toBe("idle")
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(unhandled).toEqual([])
    // Someone who does listen still hears the cancellation.
    const next = element.animate([{ opacity: 0 }, { opacity: 1 }], 10_000)
    const outcome = next.finished.then(
      () => "finished",
      (reason: unknown) => (reason instanceof Error ? reason.name : "other"),
    )
    next.cancel()
    expect(await outcome).toBe("AbortError")
    element.remove()
  })
})
