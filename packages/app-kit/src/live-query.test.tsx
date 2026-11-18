import { act, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { fetchLive, liveQuery, useLiveQuery } from "./live-query"

const query = liveQuery({
  queryKey: ["market"],
  queryFn: vi.fn(async () => 7),
  staleTime: 1000,
  meta: { block: true },
})

function Figure({ seed }: { seed: number }): ReactNode {
  return <p>{useLiveQuery(query, seed)}</p>
}

describe("live queries before the runtime loads", () => {
  it("fetch directly in loaders", async () => {
    await expect(fetchLive(query)).resolves.toBe(7)
    expect(query.queryFn).toHaveBeenCalledOnce()
  })

  it("show the loader seed and follow a new one", () => {
    const { rerender } = render(<Figure seed={1} />)
    expect(screen.getByText("1")).toBeTruthy()
    act(() => rerender(<Figure seed={2} />))
    expect(screen.getByText("2")).toBeTruthy()
  })
})
