import { setWallet } from "@matchbox/wallet"
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { AccountControl } from "./account"
import AccountMenu from "./account-menu"

const address = "0x7c21a4b8f3e9d2c1b0a5968778f6e5d4c3b29e0b"

describe("account menu keyboard", () => {
  it("moves with arrows, Home and End", async () => {
    const user = userEvent.setup()
    render(<AccountMenu address={address} onClose={vi.fn()} />)
    const [appearance, id, disconnect] = screen.getAllByRole("menuitem")
    expect(document.activeElement).toBe(appearance)
    await user.keyboard("{ArrowDown}")
    expect(document.activeElement).toBe(id)
    await user.keyboard("{End}")
    expect(document.activeElement).toBe(disconnect)
    await user.keyboard("{ArrowDown}")
    expect(document.activeElement).toBe(appearance)
    await user.keyboard("{ArrowUp}")
    expect(document.activeElement).toBe(disconnect)
    await user.keyboard("{Home}")
    expect(document.activeElement).toBe(appearance)
  })

  it("keeps focus where it is when the parent re-renders", async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <AccountMenu address={address} onClose={vi.fn()} />,
    )
    await user.keyboard("{ArrowDown}")
    const second = screen.getAllByRole("menuitem")[1]
    rerender(<AccountMenu address={address} onClose={vi.fn()} />)
    expect(document.activeElement).toBe(second)
  })

  it("returns focus to the trigger on Escape", async () => {
    const user = userEvent.setup()
    act(() => setWallet({ account: { address, chainId: 31612 } }))
    render(<AccountControl />)
    const trigger = screen.getByRole("button", { name: /^Account/ })
    await user.click(trigger)
    expect(await screen.findByRole("menu", { name: "Account" })).toBeTruthy()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("menu")).toBeNull()
    expect(document.activeElement).toBe(trigger)
    act(() => setWallet({ account: null }))
  })
})
