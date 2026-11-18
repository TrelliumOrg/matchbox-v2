import { shapes } from "@matchbox/ui/icons"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { mezoIdOptions, PaletteRow } from "./palette-row"

const wallet = `0x7f3a${"0".repeat(32)}91c2`
const other = `0x${"ab".repeat(20)}`

describe("mezoIdOptions", () => {
  it("is nothing without a match", () => {
    expect(mezoIdOptions(null)).toEqual([])
  })

  it("offers each wallet under Addresses, the account's own first", () => {
    const options = mezoIdOptions({
      mezoId: "alice.mezo",
      wallets: [wallet, other],
    })
    expect(options.map((option) => option.path)).toEqual([
      `/address/${wallet}`,
      `/address/${other}`,
    ])
    expect(options[0]).toMatchObject({
      title: "alice.mezo",
      detail: "0x7f3a…91c2",
      group: "addresses",
      mark: "mezo-id",
      lead: { kind: "avatar", initials: "7F" },
    })
  })
})

describe("mezoIdOptions, for a Bitcoin address", () => {
  const btcAddress = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"

  it("titles the EVM address by its ID where it is the ID's own wallet", () => {
    const [option] = mezoIdOptions({
      mezoId: "alice.mezo",
      wallets: [wallet],
      btcAddress,
    })
    expect(option).toMatchObject({
      path: `/address/${wallet}`,
      title: "alice.mezo",
      mark: "mezo-id",
    })
  })

  it("titles a linked account by its address, with no key", () => {
    const [option] = mezoIdOptions({
      mezoId: null,
      wallets: [wallet],
      btcAddress,
    })
    expect(option).toMatchObject({
      path: `/address/${wallet}`,
      title: "0x7f3a…91c2",
      detail: "0x7f3a…91c2",
      mark: null,
    })
  })

  it("offers nothing when Mezo has no account for it", () => {
    expect(mezoIdOptions({ mezoId: null, wallets: [], btcAddress })).toEqual([])
  })
})

describe("PaletteRow", () => {
  it("shows a Mezo ID row as the avatar, the ID with its key and the short address", () => {
    const [option] = mezoIdOptions({ mezoId: "alice.mezo", wallets: [wallet] })
    if (option === undefined) throw new Error("no option")
    const choose = vi.fn()
    render(
      <div role="listbox" aria-label="Results">
        <PaletteRow
          option={option}
          id="row-0"
          active
          onActivate={() => undefined}
          onChoose={choose}
        />
      </div>,
    )
    const row = screen.getByRole("option", { name: /alice\.mezo/ })
    expect(row.getAttribute("aria-selected")).toBe("true")
    expect(screen.getByRole("img", { name: "Mezo ID" })).toBeTruthy()
    expect(screen.getByText("0x7f3a…91c2").className).toContain("font-mono")
    expect(screen.getByText("7F")).toBeTruthy()
    fireEvent.click(row)
    expect(choose).toHaveBeenCalledTimes(1)
  })

  it("keeps the glyph lead and no key for other rows", () => {
    render(
      <PaletteRow
        option={{
          key: "shape:/epochs/47",
          path: "/epochs/47",
          title: "Epoch 47",
          detail: "Epoch",
          lead: { kind: "glyph", shape: shapes.calendarDays },
          mark: null,
          untrusted: false,
          tag: null,
          group: "jump",
        }}
        id="row-1"
        active={false}
        onActivate={() => undefined}
        onChoose={() => undefined}
      />,
    )
    expect(screen.getByRole("option", { name: /Epoch 47/ })).toBeTruthy()
    expect(screen.queryByRole("img", { name: "Mezo ID" })).toBeNull()
  })
})
