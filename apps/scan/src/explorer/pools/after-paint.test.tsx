import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useAfterPaint } from "./after-paint"

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("useAfterPaint", () => {
  it("waits for the new key's answer instead of showing the last key's", async () => {
    const pending = new Map<string, Promise<string>>()
    const first = deferred<string>()
    const second = deferred<string>()
    const reads: Record<string, Promise<string>> = {
      a: first.promise,
      b: second.promise,
    }
    const { result, rerender } = renderHook(
      ({ pool }) =>
        useAfterPaint(pool, pending, () => reads[pool] ?? first.promise),
      { initialProps: { pool: "a" } },
    )
    expect(result.current).toBe("waiting")
    await act(async () => first.resolve("pool a"))
    expect(result.current).toBe("pool a")

    rerender({ pool: "b" })
    expect(result.current).toBe("waiting")
    await act(async () => second.resolve("pool b"))
    expect(result.current).toBe("pool b")
  })
})
