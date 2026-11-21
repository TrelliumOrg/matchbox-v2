import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  defaultSettings,
  resetSettings,
  setSettings,
} from "../settings/settings-store"
import { setWallet } from "../wallet/wallet-store"
import { useViewingOther } from "./viewer"

const mine = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"
const theirs = "0x147379a0174780570d07d70a14fb244ee5f2d786"
const safe = "0x5afe000000000000000000000000000000000001"

/** The page's `?address=`, and the own-wallet cookie: set per test. */
const page = vi.hoisted(() => ({
  address: undefined as string | undefined,
  cookie: null as string | null,
}))

vi.mock("@tanstack/react-router", () => ({
  useSearch: () =>
    page.address === undefined ? {} : { address: page.address },
}))
vi.mock("./own-wallet", () => ({ useOwnWallet: () => page.cookie }))

function connect(address: string | null): void {
  setWallet({
    phase: "ready",
    account: address === null ? null : { address, chainId: 31612 },
  })
}

function saveSafe(address: string): void {
  setSettings({ signing: { mode: "multisig", safe: address } })
}

afterEach(() => {
  page.address = undefined
  page.cookie = null
  setWallet({ phase: "idle", account: null })
  setSettings(defaultSettings)
  window.localStorage.clear()
  resetSettings()
})

describe("useViewingOther", () => {
  it("is false for the connected wallet", () => {
    connect(mine)
    page.address = mine
    expect(renderHook(useViewingOther).result.current).toBe(false)
  })

  it("is false for this browser's wallet before it reconnects", () => {
    page.cookie = mine
    page.address = mine
    expect(renderHook(useViewingOther).result.current).toBe(false)
  })

  it("is false for the Safe saved in Signing, its owner connected", () => {
    connect(mine)
    saveSafe(safe)
    page.address = safe
    expect(renderHook(useViewingOther).result.current).toBe(false)
  })

  it("is false for the saved Safe before its owner's wallet connects", () => {
    // A wallet that does not reconnect (locked, expired session): the
    // Safe's actions stay, and go through openTx, which waits for the
    // reconnect or opens Connect wallet.
    saveSafe(safe)
    page.address = safe
    expect(renderHook(useViewingOther).result.current).toBe(false)
  })

  it("follows the Signing setting while the page is open", () => {
    connect(mine)
    page.address = safe
    const { result } = renderHook(useViewingOther)
    expect(result.current).toBe(true)
    // Saving the Safe in the account panel, on the Safe's own page: its
    // actions come back without a reload.
    act(() => saveSafe(safe))
    expect(result.current).toBe(false)
    act(() => setSettings({ signing: { mode: "wallet" } }))
    expect(result.current).toBe(true)
  })

  it("is true for any other wallet", () => {
    page.address = theirs
    expect(renderHook(useViewingOther).result.current).toBe(true)
    page.cookie = mine
    expect(renderHook(useViewingOther).result.current).toBe(true)
  })

  it("is false with no wallet on screen", () => {
    expect(renderHook(useViewingOther).result.current).toBe(false)
  })
})
