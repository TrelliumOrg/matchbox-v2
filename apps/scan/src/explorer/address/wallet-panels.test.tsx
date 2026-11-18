import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * The wallet panels a lock owner's page reads after it renders: never
 * another address's figures, one automatic retry, then Retry.
 */

const reads = vi.hoisted(() => ({
  answers: [] as (
    | { wallet: { status: string }; streak: { status: string } }
    | "throw"
  )[],
  addresses: [] as string[],
  gates: new Map<string, () => void>(),
}))

vi.mock("../../data/address", () => ({
  getWalletPanels: async ({ data }: { data: { address: string } }) => {
    reads.addresses.push(data.address)
    // An answer can be held back until the test lets it through.
    await new Promise<void>((resolve) => {
      if (data.address.endsWith("held")) reads.gates.set(data.address, resolve)
      else resolve()
    })
    const answer = reads.answers.shift() ?? {
      wallet: { status: "ok" },
      streak: { status: "ok" },
    }
    if (answer === "throw") throw new Error("offline")
    return answer
  },
}))

const { useWalletPanels, retryAfterMs } = await import("./wallet-panels")

afterEach(() => {
  reads.answers = []
  reads.addresses = []
  reads.gates.clear()
  vi.useRealTimers()
})

describe("a lock owner's wallet panels", () => {
  it("show placeholders, never the last address's figures", async () => {
    const { result, rerender } = renderHook(
      ({ address }) => useWalletPanels(address, true),
      { initialProps: { address: "0xaaa" } },
    )
    expect(result.current.status).toBe("loading")
    await waitFor(() => expect(result.current.status).toBe("done"))
    // Another owner's page, its answer not in yet.
    rerender({ address: "0xbbbheld" })
    expect(result.current.status).toBe("loading")
    await waitFor(() => expect(reads.gates.has("0xbbbheld")).toBe(true))
    expect(result.current.status).toBe("loading")
    act(() => reads.gates.get("0xbbbheld")?.())
    await waitFor(() => expect(result.current.status).toBe("done"))
  })

  it("are none for an address without locks, and read nothing", () => {
    const { result } = renderHook(() => useWalletPanels("0xccc", false))
    expect(result.current.status).toBe("none")
    expect(reads.addresses).toEqual([])
  })

  it("try once more after a failed read, then offer Retry", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const down = { wallet: { status: "unavailable" }, streak: { status: "ok" } }
    reads.answers = ["throw", down]
    const { result } = renderHook(() => useWalletPanels("0xddd", true))
    await waitFor(() => expect(result.current.status).toBe("done"))
    expect(reads.addresses).toHaveLength(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(retryAfterMs)
    })
    await waitFor(() => expect(reads.addresses).toHaveLength(2))
    const failed = result.current
    if (failed.status !== "done") throw new Error("not done")
    expect(failed.wallet.status).toBe("unavailable")
    // No third automatic read: Retry is the reader's.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(retryAfterMs * 2)
    })
    expect(reads.addresses).toHaveLength(2)
    expect(failed.retry).not.toBeNull()
    act(() => failed.retry?.())
    expect(result.current.status).toBe("loading")
    await waitFor(() => expect(result.current.status).toBe("done"))
    expect(reads.addresses).toHaveLength(3)
    const fine = result.current
    expect(fine.status === "done" && fine.retry).toBeNull()
  })
})
