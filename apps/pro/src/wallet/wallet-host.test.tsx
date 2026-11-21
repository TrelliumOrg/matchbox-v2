import { act, fireEvent, render, screen } from "@testing-library/react"
import type { Config } from "@wagmi/core"
import { beforeEach, describe, expect, it, vi } from "vitest"
import WalletHost from "./wallet-host"
import { getWallet, setWallet } from "./wallet-store"

/**
 * The wallet code failed to load (a tab left open across a deploy): the
 * screens stop waiting, and Connect wallet tries again, with a plain error
 * if that fails too.
 */

const walletConfig = vi.hoisted(() => vi.fn<(rpc: string) => Promise<Config>>())

vi.mock("./wallet-runtime", () => ({ walletConfig }))
vi.mock("./connect-drawer", () => ({
  ConnectDrawer: ({ open }: { open: boolean }) =>
    open ? <p>Wallet list</p> : null,
}))
vi.mock("../live/live-context", () => ({
  useLive: () => ({ rpc: "http://localhost:8545" }),
}))
vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({}),
  useNavigate: () => () => Promise.resolve(),
}))

const failed = (): Promise<Config> =>
  Promise.reject(new Error("Failed to fetch dynamically imported module"))

beforeEach(() => {
  walletConfig.mockReset()
  setWallet({ phase: "loading", account: null, drawerOpen: false })
})

describe("wallet code that did not load", () => {
  it("settles, tries again from Connect wallet, then says so", async () => {
    walletConfig.mockImplementationOnce(failed)
    render(<WalletHost />)
    await act(async () => {})
    expect(getWallet().phase).toBe("ready")
    expect(screen.queryByRole("dialog")).toBeNull()

    // Connect wallet opens the drawer, which loads the code again.
    walletConfig.mockImplementationOnce(failed)
    await act(async () => setWallet({ drawerOpen: true }))
    await act(async () => {})
    expect(walletConfig).toHaveBeenCalledTimes(2)
    expect(
      await screen.findByText(
        "Wallets did not load. Check your connection and try again.",
      ),
    ).toBeTruthy()

    walletConfig.mockResolvedValueOnce({} as Config)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    })
    expect(walletConfig).toHaveBeenCalledTimes(3)
    expect(await screen.findByText("Wallet list")).toBeTruthy()
  })
})
