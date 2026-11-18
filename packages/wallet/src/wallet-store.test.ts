import { afterEach, describe, expect, it, vi } from "vitest"
import {
  connectedFlag,
  getWallet,
  openWallet,
  reconnectIfRemembered,
  resetWallet,
  setWallet,
  subscribeWallet,
  walletIntent,
} from "./wallet-store"

vi.mock("./wallet-host", () => ({ default: () => null }))

afterEach(() => {
  resetWallet()
  window.localStorage.clear()
})

describe("wallet store", () => {
  it("starts idle with no wallet code asked for", () => {
    expect(getWallet()).toEqual({
      phase: "idle",
      account: null,
      drawerOpen: false,
    })
  })

  it("starts loading on intent, once", () => {
    const listener = vi.fn()
    subscribeWallet(listener)
    walletIntent.onPointerEnter()
    walletIntent.onFocus()
    expect(getWallet().phase).toBe("loading")
    expect(listener).toHaveBeenCalledOnce()
  })

  it("opens the drawer and loads the wallet", () => {
    openWallet()
    expect(getWallet()).toMatchObject({ drawerOpen: true, phase: "loading" })
  })

  it("reconnects only a browser that connected before", () => {
    reconnectIfRemembered()
    expect(getWallet().phase).toBe("idle")
    window.localStorage.setItem(connectedFlag, "1")
    reconnectIfRemembered()
    expect(getWallet().phase).toBe("loading")
  })

  it("merges updates", () => {
    setWallet({ account: { address: "0xabc", chainId: 31612 } })
    expect(getWallet().account?.chainId).toBe(31612)
    expect(getWallet().phase).toBe("idle")
  })
})
