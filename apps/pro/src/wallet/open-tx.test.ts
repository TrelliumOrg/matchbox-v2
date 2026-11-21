import { beforeEach, describe, expect, it, vi } from "vitest"
import { resetSettings, setSettings } from "../settings/settings-store"
import type { TxRequest } from "../tx/tx-store"
import { getWallet, loadTx, openTx, setWallet } from "./wallet-store"

/**
 * Claim all on the Safe saved in Signing, in a browser with no wallet:
 * the drawer opens, and once an owner connects the claim opens as the
 * Safe instead of being dropped.
 */

vi.mock("../tx/flows/claim-sheet", () => ({ ClaimSheet: () => null }))
vi.mock("../tx/flows/incentives-sheet", () => ({
  IncentivesSheet: () => null,
}))
vi.mock("../tx/flows/lock-sheets", () => ({
  AddSheet: () => null,
  ExtendSheet: () => null,
  MergeSheet: () => null,
  NewLockSheet: () => null,
  WithdrawSheet: () => null,
}))
vi.mock("../tx/flows/transfer-sheet", () => ({ TransferSheet: () => null }))
vi.mock("../tx/flows/vote-sheet", () => ({ VoteSheet: () => null }))
vi.mock("../tx/toasts", () => ({ Toasts: () => null }))
vi.mock("./wallet-runtime", () => ({ loadedConfig: () => null }))
vi.mock("./wallet-host", () => ({ default: () => null }))

const safe = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"
const ownerWallet = "0x2b0c000000000000000000000000000000000002"
const request = { flow: "claim" } as unknown as TxRequest

beforeEach(() => {
  window.localStorage.clear()
  resetSettings()
  setSettings({ signing: { mode: "multisig", safe } })
  setWallet({ phase: "idle", account: null, drawerOpen: false, tx: null })
})

describe("a claim on the saved Safe with no wallet", () => {
  it("opens as the Safe once its owner connects from the drawer", async () => {
    openTx({ kind: "viewing", address: safe }, request)
    expect(getWallet().drawerOpen).toBe(true)
    await loadTx()
    await Promise.resolve()
    setWallet({
      phase: "ready",
      account: { address: ownerWallet, chainId: 31612 },
    })
    setWallet({ drawerOpen: false })
    expect(getWallet().tx).toEqual({ request, owner: safe })
  })

  it("is dropped when the drawer closes without a wallet", async () => {
    openTx({ kind: "viewing", address: safe }, request)
    await loadTx()
    await Promise.resolve()
    setWallet({ drawerOpen: false })
    setWallet({ account: { address: ownerWallet, chainId: 31612 } })
    expect(getWallet().tx).toBeNull()
  })
})
