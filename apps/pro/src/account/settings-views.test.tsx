import * as WalletDrawer from "@matchbox/ui/wallet-drawer"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getSettings,
  readRpc,
  resetSettings,
  settingsStorageKey,
} from "../settings/settings-store"
import { NetworkView, SigningView } from "./settings-views"

const matchbox = "https://matchbox.example/rpc"
const safe = "0x7a2c000000000000000000000000000000041f0e"

function inDrawer(view: ReactNode): ReactNode {
  return (
    <WalletDrawer.Root open>
      <WalletDrawer.Content>{view}</WalletDrawer.Content>
    </WalletDrawer.Root>
  )
}

function rpcAnswering(chainId: string) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body: unknown = JSON.parse(String(init.body))
    const method =
      typeof body === "object" && body !== null
        ? Reflect.get(body, "method")
        : null
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: method === "eth_chainId" ? chainId : "0xc80b40",
      }),
    )
  })
}

afterEach(() => {
  window.localStorage.clear()
  resetSettings()
  vi.unstubAllGlobals()
})

describe("Network", () => {
  it("saves a custom RPC after Test and sends reads to it", async () => {
    const fetcher = rpcAnswering("0x7b7c")
    vi.stubGlobal("fetch", fetcher)
    const onBack = vi.fn()
    const user = userEvent.setup()
    render(inDrawer(<NetworkView onBack={onBack} />))

    await user.click(screen.getByRole("radio", { name: /Custom RPC/ }))
    const save = screen.getByRole("button", { name: "Save" })
    expect(save.getAttribute("aria-disabled")).toBe("true")

    await user.type(
      screen.getByRole("textbox", { name: "RPC URL" }),
      "https://rpc.mezo.example/v1",
    )
    await user.click(screen.getByRole("button", { name: "Test" }))
    await screen.findByText(/^Mezo mainnet, block 13,110,080, \d+ ms$/)
    expect(fetcher).toHaveBeenCalledWith(
      "https://rpc.mezo.example/v1",
      expect.anything(),
    )

    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(onBack).toHaveBeenCalled()
    expect(getSettings().network).toEqual({
      mode: "custom",
      rpcUrl: "https://rpc.mezo.example/v1",
    })
    expect(readRpc(matchbox)).toBe("https://rpc.mezo.example/v1")
    expect(window.localStorage.getItem(settingsStorageKey)).toContain(
      "rpc.mezo.example",
    )
  })

  it("will not save an RPC on another chain", async () => {
    vi.stubGlobal("fetch", rpcAnswering("0x1"))
    const onBack = vi.fn()
    const user = userEvent.setup()
    render(inDrawer(<NetworkView onBack={onBack} />))
    await user.click(screen.getByRole("radio", { name: /Custom RPC/ }))
    await user.type(
      screen.getByRole("textbox", { name: "RPC URL" }),
      "https://eth.example",
    )
    await user.click(screen.getByRole("button", { name: "Test" }))
    await screen.findByText("Chain 1, not Mezo mainnet")
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(onBack).not.toHaveBeenCalled()
    expect(readRpc(matchbox)).toBe(matchbox)
  })
})

describe("Signing", () => {
  it("stores Multisig with its Safe", async () => {
    const onBack = vi.fn()
    const user = userEvent.setup()
    render(inDrawer(<SigningView onBack={onBack} />))
    await user.click(screen.getByRole("radio", { name: /Multisig/ }))
    const input = screen.getByRole("textbox", { name: "Safe on Mezo" })
    await user.type(input, "0x12")
    expect(screen.getByText("Not a valid address")).toBeTruthy()
    await user.clear(input)
    await user.type(input, safe)
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(onBack).toHaveBeenCalled())
    expect(getSettings().signing).toEqual({ mode: "multisig", safe })
  })
})
