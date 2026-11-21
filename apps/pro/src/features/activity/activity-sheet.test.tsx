import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ActivityEvent } from "../../data/view-models"
import ActivitySheet, { tokenValue } from "./activity-sheet"

const real = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
/** Calls itself MUSD, in no registry: never priced. */
const fake = "0x1111111111111111111111111111111111111111"

const event: ActivityEvent = {
  id: "claim-1",
  status: "confirmed",
  at: 1_773_328_800,
  epoch: 12,
  block: 100,
  tx: `0x${"ab".repeat(32)}`,
  detail: {
    kind: "claim",
    usd: "9.00",
    // The fake one first: a match by symbol gave both its value.
    tokens: [
      { symbol: "MUSD", token: fake, amount: "4", usd: null },
      { symbol: "MUSD", token: real, amount: "5", usd: "5.00" },
    ],
    whenClaimed: {
      usd: "5.00",
      complete: false,
      pricedAt: 1_773_273_600,
      tokens: [
        { token: fake, symbol: "MUSD", usd: null },
        { token: real, symbol: "MUSD", usd: "5.00" },
      ],
    },
    locks: [],
    gauges: [],
  },
}

describe("activity sheet", () => {
  it("values each claimed token by address, never by symbol", () => {
    const [first, second] =
      event.detail.kind === "claim" ? event.detail.tokens : []
    if (first === undefined || second === undefined) throw new Error("tokens")
    expect(tokenValue(event.detail, first, 0)).toBe("No price")
    expect(tokenValue(event.detail, second, 1)).toBe("$5.00")
    // Out of order, the address still finds it.
    expect(tokenValue(event.detail, second, 0)).toBe("$5.00")
  })

  it("reads an estimate past its day to be final as pending", () => {
    const finalOn = Date.parse("2026-03-15T00:00:00Z") / 1000
    const settling: ActivityEvent = {
      ...event,
      detail: {
        kind: "claim",
        usd: "9.00",
        tokens: [{ symbol: "MUSD", token: real, amount: "5", usd: "4.00" }],
        estimate: {
          usd: "5.00",
          finalOn,
          tokens: [{ token: real, usd: "5.00" }],
        },
        locks: [],
        gauges: [],
      },
    }
    const { unmount } = render(
      <ActivitySheet
        event={settling}
        open
        onClose={() => {}}
        nowSeconds={finalOn + 86_399}
      />,
    )
    expect(screen.getByText("Estimate, final by 15 Mar 2026")).toBeTruthy()
    unmount()
    render(
      <ActivitySheet
        event={settling}
        open
        onClose={() => {}}
        nowSeconds={finalOn + 86_400}
      />,
    )
    expect(screen.getByText("Value when claimed pending")).toBeTruthy()
    expect(screen.queryByText(/final by/)).toBeNull()
    // Its figure is the row's own, not the old estimate.
    expect(screen.getByText("+$9.00")).toBeTruthy()
  })

  it("lists two tokens of one symbol once each, with their own values", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    render(<ActivitySheet event={event} open onClose={() => {}} />)
    const list = screen.getByRole("heading", { name: "Tokens" })
      .nextElementSibling as HTMLElement
    const items = within(list).getAllByRole("listitem")
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringMatching(/4\.00 MUSDNo price$/),
      expect.stringMatching(/5\.00 MUSD\$5\.00$/),
    ])
    expect(
      errors.mock.calls.some((call) => String(call[0]).includes("same key")),
    ).toBe(false)
    errors.mockRestore()
  })
})
