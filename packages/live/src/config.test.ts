import { describe, expect, it } from "vitest"
import { liveConfig, publicMezoRpc, walletRpcUrl } from "./config"

describe("live config", () => {
  it("simulates heads in fixtures mode", () => {
    expect(liveConfig(true, "https://rpc.test")).toEqual({ mode: "simulated" })
  })

  it("follows BlockHub and polls a valid RPC only", () => {
    expect(liveConfig(false, "https://rpc.test")).toEqual({
      mode: "blockhub",
      rpcUrl: "https://rpc.test",
    })
    expect(liveConfig(false, "nope")).toEqual({
      mode: "blockhub",
      rpcUrl: null,
    })
  })

  it("falls back to the public RPC for the wallet", () => {
    expect(walletRpcUrl(undefined)).toBe(publicMezoRpc)
    expect(walletRpcUrl("http://127.0.0.1:8545")).toBe("http://127.0.0.1:8545")
  })
})
