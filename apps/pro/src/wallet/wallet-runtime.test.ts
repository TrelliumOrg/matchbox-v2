import type { Config } from "@wagmi/core"
import { getConnectors } from "@wagmi/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { reconnectLimitMs } from "./reconnect-limit"
import { mezoChainId, resetWalletConfig, walletConfig } from "./wallet-runtime"
import { getWallet, setWallet } from "./wallet-store"

/**
 * A wallet that never answers its reconnect (wagmi asks with no time
 * limit): the screens stop waiting after `reconnectLimitMs`, and a late
 * answer still connects.
 */

const answer = vi.hoisted(() => ({ current: null as null | (() => void) }))

vi.mock("@wagmi/core", async (original) => {
  const actual = await original<typeof import("@wagmi/core")>()
  return {
    ...actual,
    // The wallet answers when the test says so, or never.
    reconnect: (config: Config) =>
      new Promise<void>((resolve) => {
        answer.current = () => {
          const connector = actual.getConnectors(config)[0]
          if (connector === undefined) throw new Error("No connector")
          config.setState((state) => ({
            ...state,
            status: "connected",
            current: connector.uid,
            connections: new Map([
              [
                connector.uid,
                {
                  accounts: [owner],
                  chainId: 31612,
                  connector,
                },
              ],
            ]),
          }))
          resolve()
        }
      }),
  }
})
vi.mock("../safe/connector", () => ({
  safeConnectors: async () => [],
  connectInsideSafe: async () => false,
}))

const owner = "0x7c21095156AB25E989c3C084BCb06037c6539E0b"

beforeEach(() => {
  vi.useFakeTimers()
  resetWalletConfig()
  answer.current = null
  setWallet({ phase: "loading", account: null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("a reconnect that does not answer", () => {
  it("settles without a wallet after the limit", async () => {
    let created: Config | null = null
    void walletConfig("http://localhost:8545").then((config) => {
      created = config
    })
    await vi.advanceTimersByTimeAsync(reconnectLimitMs - 1)
    expect(getWallet().phase).toBe("loading")
    await vi.advanceTimersByTimeAsync(1)
    expect(getWallet().phase).toBe("ready")
    expect(getWallet().account).toBeNull()
    expect(created).not.toBeNull()
  })

  it("connects when the wallet answers after the limit", async () => {
    const loaded = walletConfig("http://localhost:8545")
    await vi.advanceTimersByTimeAsync(reconnectLimitMs)
    const config = await loaded
    expect(getWallet().phase).toBe("ready")
    expect(getWallet().account).toBeNull()
    expect(getConnectors(config).length).toBeGreaterThan(0)
    answer.current?.()
    expect(getWallet().account).toEqual({
      address: owner,
      chainId: mezoChainId,
    })
  })

  it("is ready at once when the wallet answers in time", async () => {
    void walletConfig("http://localhost:8545")
    await vi.advanceTimersByTimeAsync(0)
    answer.current?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(getWallet().phase).toBe("ready")
    expect(getWallet().account?.address).toBe(owner)
  })
})
