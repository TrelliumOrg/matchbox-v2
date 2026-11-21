import { renderHook } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { renderToString } from "react-dom/server"
import { beforeEach, describe, expect, it } from "vitest"
import { setOwnWallet } from "../lib/wallet-context"
import { setWallet, useWalletSettled } from "./wallet-store"

/**
 * Whether the header may offer Connect wallet. A browser that never
 * connected a wallet never loads wallet code on load, so its phase stays
 * "idle": on the saved Safe's page the header kept the Safe's account
 * (not connected) instead of Connect wallet.
 */

function Settled(): ReactNode {
  return useWalletSettled() ? "settled" : "waiting"
}

beforeEach(() => {
  window.localStorage.clear()
  setOwnWallet(null)
  setWallet({ phase: "idle", account: null })
})

describe("the wallet has settled", () => {
  it("with no wallet to reconnect", () => {
    expect(renderHook(useWalletSettled).result.current).toBe(true)
  })

  it("not while a remembered wallet waits to reconnect", () => {
    window.localStorage.setItem("mbx-wallet", "1")
    expect(renderHook(useWalletSettled).result.current).toBe(false)
    setWallet({ phase: "loading" })
    expect(renderHook(useWalletSettled).result.current).toBe(false)
  })

  it("not for an own-wallet cookie, whose account the header keeps", () => {
    setOwnWallet("0x7c21095156ab25e989c3c084bcb06037c6539e0b")
    expect(renderHook(useWalletSettled).result.current).toBe(false)
  })

  it("once the reconnect is done", () => {
    window.localStorage.setItem("mbx-wallet", "1")
    setWallet({ phase: "ready" })
    expect(renderHook(useWalletSettled).result.current).toBe(true)
  })

  it("never on the server, so hydration matches", () => {
    expect(renderToString(createElement(Settled))).toBe("waiting")
  })
})
