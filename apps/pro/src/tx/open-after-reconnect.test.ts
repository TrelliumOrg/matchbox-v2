import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { reconnectLimitMs } from "../wallet/reconnect-limit"
import { getWallet, setWallet } from "../wallet/wallet-store"
import { openAfterReconnect } from "./tx-host"
import type { TxRequest } from "./tx-store"

/**
 * Claim on your own page while your wallet reconnects: the click waits
 * for the reconnect, but never longer than the limit, and then opens the
 * drawer. Connecting there opens the sheet the click asked for.
 */

vi.mock("./flows/claim-sheet", () => ({ ClaimSheet: () => null }))
vi.mock("./flows/incentives-sheet", () => ({ IncentivesSheet: () => null }))
vi.mock("./flows/lock-sheets", () => ({
  AddSheet: () => null,
  ExtendSheet: () => null,
  MergeSheet: () => null,
  NewLockSheet: () => null,
  WithdrawSheet: () => null,
}))
vi.mock("./flows/transfer-sheet", () => ({ TransferSheet: () => null }))
vi.mock("./flows/vote-sheet", () => ({ VoteSheet: () => null }))
vi.mock("./toasts", () => ({ Toasts: () => null }))
vi.mock("../wallet/wallet-runtime", () => ({ loadedConfig: () => null }))
// The drawer's code: nothing to load in a unit test.
vi.mock("../wallet/wallet-host", () => ({ default: () => null }))

const owner = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"
const other = "0x2b0c000000000000000000000000000000000002"
const request = { flow: "claim" } as unknown as TxRequest

beforeEach(() => {
  vi.useFakeTimers()
  setWallet({ phase: "loading", account: null, drawerOpen: false, tx: null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("a click while the wallet reconnects", () => {
  it("opens the drawer after the limit, not never", () => {
    openAfterReconnect(owner, request)
    vi.advanceTimersByTime(reconnectLimitMs - 1)
    expect(getWallet().drawerOpen).toBe(false)
    vi.advanceTimersByTime(1)
    expect(getWallet().drawerOpen).toBe(true)
    expect(getWallet().tx).toBeNull()
  })

  it("opens the sheet once the owner connects from the drawer", () => {
    openAfterReconnect(owner, request)
    vi.advanceTimersByTime(reconnectLimitMs)
    setWallet({ phase: "ready", account: { address: owner, chainId: 31612 } })
    expect(getWallet().tx).toEqual({ request, owner })
  })

  it("drops the click for another wallet or a closed drawer", () => {
    openAfterReconnect(owner, request)
    vi.advanceTimersByTime(reconnectLimitMs)
    setWallet({ phase: "ready", account: { address: other, chainId: 31612 } })
    expect(getWallet().tx).toBeNull()

    setWallet({ account: null, drawerOpen: false })
    openAfterReconnect(owner, request)
    setWallet({ phase: "ready" })
    expect(getWallet().drawerOpen).toBe(true)
    setWallet({ drawerOpen: false })
    setWallet({ account: { address: owner, chainId: 31612 } })
    expect(getWallet().tx).toBeNull()
  })

  it("opens the sheet at once when the reconnect brings the owner back", () => {
    openAfterReconnect(owner, request)
    setWallet({ phase: "ready", account: { address: owner, chainId: 31612 } })
    expect(getWallet().tx).toEqual({ request, owner })
    expect(getWallet().drawerOpen).toBe(false)
  })
})
