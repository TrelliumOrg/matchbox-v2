import { describe, expect, it } from "vitest"
import { rejectedWithin, settleWithin } from "./test-timing"

const sleep = (ms: number) =>
  new Promise<string>((resolve) => setTimeout(() => resolve("done"), ms))

/** Holds the event loop, as a loaded CI machine does. */
function busy(ms: number): void {
  const until = Date.now() + ms
  while (Date.now() < until) {
    // spin
  }
}

describe("a budget timer started with the work", () => {
  it("lets a shorter deadline win however long the loop was held", async () => {
    const work = sleep(50)
    const outcome = settleWithin(work, 100)
    // Both timers are overdue by the time the loop is free; the earlier
    // one still fires first, where a wall clock would read 300 ms.
    busy(300)
    expect(await outcome).toEqual({ status: "fulfilled", value: "done" })
  })

  it("says late when the work outlives the budget", async () => {
    expect(await settleWithin(sleep(200), 20)).toBe("late")
  })

  it("hands back a rejection, and refuses a value where one was expected", async () => {
    const failure = new Error("gave up")
    expect(await rejectedWithin(Promise.reject(failure), 100)).toBe(failure)
    await expect(rejectedWithin(Promise.resolve(1), 100)).rejects.toThrow(
      "expected a rejection",
    )
  })
})
