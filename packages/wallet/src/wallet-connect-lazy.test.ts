import { getConnectors } from "@wagmi/core"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * WalletConnect's code (about 450 kB) loads when its row is tapped, not
 * with the wallet config. The module below stands in for it and counts how
 * often it is asked for.
 */
const walletConnect = vi.hoisted(() => ({ loads: 0 }))

vi.mock("@wagmi/connectors/walletConnect", () => ({
  walletConnect: () => {
    walletConnect.loads += 1
    return () => ({
      id: "walletConnect",
      name: "WalletConnect",
      type: "walletConnect",
      connect: async () => ({ accounts: [], chainId: 31612 }),
      disconnect: async () => {},
      getAccounts: async () => [],
      getChainId: async () => 31612,
      getProvider: async () => ({}),
      isAuthorized: async () => false,
      onAccountsChanged: () => {},
      onChainChanged: () => {},
      onDisconnect: () => {},
    })
  },
}))

const options = {
  app: { name: "Matchbox Pro", description: "Vote, claim and lock." },
  walletConnectProjectId: "0123456789abcdef0123456789abcdef",
}

async function freshRuntime() {
  vi.resetModules()
  return import("./wallet-runtime")
}

beforeEach(() => {
  walletConnect.loads = 0
  window.localStorage.clear()
})

describe("WalletConnect loads on demand", () => {
  it("is offered without being loaded when the wallet config is made", async () => {
    const runtime = await freshRuntime()
    const config = await runtime.walletConfig("https://rpc.example", options)
    expect(walletConnect.loads).toBe(0)
    expect(runtime.walletConnectOffered()).toBe(true)
    expect(
      getConnectors(config).some(
        (connector) => connector.type === "walletConnect",
      ),
    ).toBe(false)
  })

  it("loads once, on first use, and joins the config's connectors", async () => {
    const runtime = await freshRuntime()
    const config = await runtime.walletConfig("https://rpc.example", options)
    const [first, second] = await Promise.all([
      runtime.ensureWalletConnect(config),
      runtime.ensureWalletConnect(config),
    ])
    expect(walletConnect.loads).toBe(1)
    expect(first).toBe(second)
    const connector = getConnectors(config).find(
      (candidate) => candidate.type === "walletConnect",
    )
    expect(connector?.uid).toBe(first)
    // Already there: nothing more to load.
    expect(await runtime.ensureWalletConnect(config)).toBe(first)
    expect(walletConnect.loads).toBe(1)
  })

  it("comes with the config for a browser that last used it, to reconnect", async () => {
    window.localStorage.setItem("mbx.recentConnectorId", '"walletConnect"')
    const runtime = await freshRuntime()
    const config = await runtime.walletConfig("https://rpc.example", options)
    expect(walletConnect.loads).toBe(1)
    expect(
      getConnectors(config).some(
        (connector) => connector.type === "walletConnect",
      ),
    ).toBe(true)
  })

  it("is neither offered nor loadable without a project id", async () => {
    const runtime = await freshRuntime()
    const config = await runtime.walletConfig("https://rpc.example", {
      ...options,
      walletConnectProjectId: "",
    })
    expect(runtime.walletConnectOffered()).toBe(false)
    await expect(runtime.ensureWalletConnect(config)).rejects.toThrow(
      "Wallet not found",
    )
    expect(walletConnect.loads).toBe(0)
  })
})
