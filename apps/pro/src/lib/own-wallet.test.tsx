import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { setWallet } from "../wallet/wallet-store"
import { useOwnAddress } from "./viewer"
import { setOwnWallet } from "./wallet-context"

const mine = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"

// The browser's side of the isomorphic own wallet (the build picks it).
vi.mock("@tanstack/react-start", () => ({
  createIsomorphicFn: () => ({
    server: () => ({ client: (client: () => unknown) => client }),
  }),
}))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: () => null,
}))
vi.mock("@tanstack/react-router", () => ({ useSearch: () => ({}) }))

afterEach(() => {
  setOwnWallet(null)
  setWallet({ phase: "idle", account: null })
})

describe("this browser's own wallet", () => {
  it("is the connected wallet, else the one it connected last", () => {
    setOwnWallet(mine)
    const { result } = renderHook(useOwnAddress)
    expect(result.current).toBe(mine)
  })

  it("is gone once the wallet disconnects", () => {
    setOwnWallet(mine)
    act(() =>
      setWallet({ phase: "ready", account: { address: mine, chainId: 31612 } }),
    )
    const { result } = renderHook(useOwnAddress)
    expect(result.current).toBe(mine)
    // Disconnect: the wallet goes first, then the host clears the cookie
    // in an effect. The header must not keep showing the old account.
    act(() => setWallet({ account: null }))
    act(() => setOwnWallet(null))
    expect(result.current).toBe(null)
  })
})
