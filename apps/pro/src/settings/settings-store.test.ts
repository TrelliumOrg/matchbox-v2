import { afterEach, describe, expect, it } from "vitest"
import {
  defaultSettings,
  gaugeViewScript,
  getSettings,
  isRpcUrl,
  parseSettings,
  readRpc,
  resetSettings,
  setSettings,
  settingsStorageKey,
} from "./settings-store"

afterEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute("data-gauge-view")
  resetSettings()
})

describe("settings", () => {
  it("falls back to the defaults for anything it cannot trust", () => {
    expect(parseSettings(null)).toEqual(defaultSettings)
    expect(parseSettings("not json")).toEqual(defaultSettings)
    expect(
      parseSettings(
        JSON.stringify({
          network: { mode: "custom", rpcUrl: "javascript:alert(1)" },
          signing: { mode: "multisig", safe: "nope" },
        }),
      ),
    ).toEqual({
      network: { mode: "matchbox" },
      signing: { mode: "multisig", safe: null },
      gaugeView: "comfortable",
    })
  })

  it("stores and reads back a custom RPC and a Safe", () => {
    setSettings({
      network: { mode: "custom", rpcUrl: "https://rpc.mezo.example/v1" },
      signing: {
        mode: "multisig",
        safe: "0x7a2c000000000000000000000000000000041f0",
      },
    })
    resetSettings()
    expect(getSettings().network).toEqual({
      mode: "custom",
      rpcUrl: "https://rpc.mezo.example/v1",
    })
    expect(window.localStorage.getItem(settingsStorageKey)).toContain(
      "multisig",
    )
    expect(readRpc("https://matchbox.example")).toBe(
      "https://rpc.mezo.example/v1",
    )
  })

  it("reads through Matchbox by default", () => {
    expect(readRpc("https://matchbox.example")).toBe("https://matchbox.example")
  })

  it("remembers the gauge view and marks <html> for the compact styles", () => {
    expect(getSettings().gaugeView).toBe("comfortable")
    setSettings({ gaugeView: "compact" })
    expect(document.documentElement.getAttribute("data-gauge-view")).toBe(
      "compact",
    )
    resetSettings()
    expect(getSettings().gaugeView).toBe("compact")
    expect(getSettings().network).toEqual({ mode: "matchbox" })
    setSettings({ gaugeView: "comfortable" })
    expect(document.documentElement.hasAttribute("data-gauge-view")).toBe(false)
    expect(
      parseSettings(JSON.stringify({ gaugeView: "dense" })).gaugeView,
    ).toBe("comfortable")
  })

  it("applies a stored compact view before first paint", () => {
    const run = new Function(gaugeViewScript)
    run()
    expect(document.documentElement.hasAttribute("data-gauge-view")).toBe(false)
    window.localStorage.setItem(
      settingsStorageKey,
      JSON.stringify({ gaugeView: "compact" }),
    )
    run()
    expect(document.documentElement.getAttribute("data-gauge-view")).toBe(
      "compact",
    )
    window.localStorage.setItem(settingsStorageKey, "{broken")
    document.documentElement.removeAttribute("data-gauge-view")
    expect(() => run()).not.toThrow()
    expect(document.documentElement.hasAttribute("data-gauge-view")).toBe(false)
  })
})

describe("custom RPC URLs", () => {
  it("take https anywhere and plain http on this machine only", () => {
    for (const url of [
      "https://rpc.example.com",
      "http://localhost:8545",
      "http://node.localhost:8545",
      "http://127.0.0.1:8545",
    ]) {
      expect(isRpcUrl(url), url).toBe(true)
    }
    for (const url of [
      "http://rpc.example.com",
      // Browsers drop IPv6 sources from a CSP, so the page cannot reach it.
      "http://[::1]:8545",
      "ftp://nope",
      "not a url",
    ]) {
      expect(isRpcUrl(url), url).toBe(false)
    }
  })

  it("drop a stored plain http RPC on another host", () => {
    const stored = JSON.stringify({
      network: { mode: "custom", rpcUrl: "http://rpc.example.com" },
    })
    expect(parseSettings(stored).network).toEqual({ mode: "matchbox" })
  })
})
