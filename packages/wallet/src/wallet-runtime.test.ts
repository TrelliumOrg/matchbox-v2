import { CHAIN_ID } from "@matchbox/chain"
import { beforeEach, describe, expect, it, vi } from "vitest"

const wagmi = vi.hoisted(() => ({
  account: { status: "disconnected" } as Record<string, unknown>,
  signed: [] as unknown[],
  connected: [] as unknown[],
}))

vi.mock("@wagmi/core", async (original) => ({
  ...(await original<typeof import("@wagmi/core")>()),
  reconnect: async () => [],
  getAccount: () => wagmi.account,
  getConnectors: () => [{ uid: "u1", id: "injected", name: "Injected" }],
  connect: async (_config: unknown, input: { chainId: number }) => {
    wagmi.connected.push(input.chainId)
    return { accounts: [`0x${"ab".repeat(20)}`], chainId: input.chainId }
  },
  signMessage: async (_config: unknown, input: unknown) => {
    wagmi.signed.push(input)
    return `0x${"11".repeat(65)}`
  },
}))

const runtime = await import("./wallet-runtime")

beforeEach(() => {
  wagmi.account = { status: "disconnected" }
  wagmi.signed.length = 0
})

describe("wallet networks", () => {
  it("defaults to Mezo mainnet and offers Mezo Testnet", () => {
    expect(runtime.chainFor(undefined).id).toBe(CHAIN_ID.mainnet)
    expect(runtime.chainFor("mainnet").id).toBe(CHAIN_ID.mainnet)
    const testnet = runtime.chainFor("testnet")
    expect(testnet.id).toBe(CHAIN_ID.testnet)
    expect(testnet.rpcUrls.default.http).toEqual(["https://rpc.test.mezo.org"])
  })

  it("connects on the network the config was made for", async () => {
    const config = await runtime.walletConfig("https://rpc.test.mezo.org", {
      app: { name: "Matchbox Developer", description: "Console" },
      walletConnectProjectId: "",
      network: "testnet",
    })
    expect(config.chains.map((chain) => chain.id)).toEqual([CHAIN_ID.testnet])
    await runtime.connectWallet(config, "u1")
    expect(wagmi.connected).toEqual([CHAIN_ID.testnet])
  })
})

describe("signMessage", () => {
  it("needs a connected wallet", async () => {
    await expect(
      runtime.signMessage(runtime.requireConfig(), "hello"),
    ).rejects.toThrow("Wallet is not connected")
  })

  it("asks the wallet to sign as the connected account", async () => {
    const address = `0x${"cd".repeat(20)}`
    wagmi.account = { status: "connected", address, chainId: CHAIN_ID.testnet }
    const signature = await runtime.signMessage(
      runtime.requireConfig(),
      "hello",
    )
    expect(signature).toMatch(/^0x[0-9a-f]+$/)
    expect(wagmi.signed).toEqual([{ account: address, message: "hello" }])
  })
})
