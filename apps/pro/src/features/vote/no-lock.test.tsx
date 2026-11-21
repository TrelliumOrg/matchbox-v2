import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Voter } from "../../data/view-models"
import { NoLock } from "./ballot-rail"

/** Someone else's wallet, viewed: set per test. */
const viewingOther = vi.hoisted(() => ({ current: false }))
const opened = vi.hoisted(() => ({ calls: [] as unknown[] }))

vi.mock("../../lib/viewer", () => ({
  useViewer: () => ({ kind: "viewing", address: "0x2b0c" }),
  useViewingOther: () => viewingOther.current,
}))
vi.mock("../../tx/tx-store", () => ({
  openTx: (...args: unknown[]) => opened.calls.push(args),
  txIntent: {},
}))
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }): ReactNode => children,
}))

const voter: Voter = {
  address: "0x2b0c",
  lock: null,
  locks: [],
  watching: [],
  wallet: null,
}

describe("Vote's rail without a lock", () => {
  beforeEach(() => {
    viewingOther.current = false
    opened.calls = []
  })

  it("offers your own wallet a new lock", () => {
    render(<NoLock voter={voter} escrow="vemezo" />)
    screen.getByRole("button", { name: "New lock" }).click()
    expect(opened.calls).toHaveLength(1)
  })

  it("offers someone else's wallet nothing to sign", () => {
    viewingOther.current = true
    render(<NoLock voter={voter} escrow="vemezo" />)
    expect(screen.queryByRole("button", { name: "New lock" })).toBeNull()
    const viewing = screen.getByRole("button", { name: "Viewing only" })
    expect(viewing.getAttribute("aria-disabled")).toBe("true")
    viewing.click()
    expect(opened.calls).toHaveLength(0)
  })
})
