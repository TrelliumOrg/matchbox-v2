/**
 * Timing checks for tests whose code gives up on its own timers (a
 * deadline, a request timeout). Reading the wall clock afterwards also
 * counts how long a busy machine took to run those timers, so a loaded CI
 * run failed tests whose code was right. A budget timer started alongside
 * the work waits in the same timer queue as the code's own deadline: the
 * shorter one fires first however busy the machine is, so the check is of
 * the deadline logic, not of the machine. The margin above a deadline is
 * for the work after it (serving what is stored), as before.
 *
 * What it does not cover: work that does I/O after the deadline (D1, the
 * Cache API, a render) is not in the timer queue, so a starved loop can
 * still finish it after the budget. Tests of whole routes check the
 * deadline each read was given instead, and use this only as a hang guard.
 * It needs real timers: under `vi.useFakeTimers()` the budget never fires
 * unless time is advanced, and the race proves nothing.
 *
 * Never imported by the Worker.
 */

/** "late" when `work` had not settled once a timer of `ms` fired. */
export async function settleWithin<T>(
  work: Promise<T>,
  ms: number,
): Promise<PromiseSettledResult<T> | "late"> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const budget = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), ms)
  })
  const settled = work.then(
    (value): PromiseSettledResult<T> => ({ status: "fulfilled", value }),
    (reason: unknown): PromiseSettledResult<T> => ({
      status: "rejected",
      reason,
    }),
  )
  try {
    return await Promise.race([settled, budget])
  } finally {
    clearTimeout(timer)
  }
}

/** The work's value, failing the test if it was not in by `ms`. */
export async function fulfilledWithin<T>(
  work: Promise<T>,
  ms: number,
): Promise<T> {
  const outcome = await settleWithin(work, ms)
  if (outcome === "late") throw new Error(`not settled within ${ms} ms`)
  if (outcome.status === "rejected") throw outcome.reason
  return outcome.value
}

/** The work's rejection, failing the test if it was not in by `ms`. */
export async function rejectedWithin(
  work: Promise<unknown>,
  ms: number,
): Promise<unknown> {
  const outcome = await settleWithin(work, ms)
  if (outcome === "late") throw new Error(`not settled within ${ms} ms`)
  if (outcome.status === "fulfilled") {
    throw new Error("settled with a value, expected a rejection")
  }
  return outcome.reason
}
