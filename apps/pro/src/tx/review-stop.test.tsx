import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { Config } from "@wagmi/core"
import { getAddress } from "viem"
import { describe, expect, it, vi } from "vitest"
import { freshRecipient } from "../account/fresh-recipient"
import type { IdentityLookup } from "../account/identity"
import { type Review, TxSheet } from "./tx-sheet"

/**
 * A transfer to a Mezo ID whose wallet moved between typing and review:
 * TxSheet stops with the new address, offers no way to sign, and only the
 * next review (now of the new wallet) reaches Send.
 */

vi.mock("../live/live-context", () => ({
  useLive: () => ({ store: null, market: { prices: {} } }),
}))
vi.mock("../settings/settings-store", () => ({
  useSettings: () => ({ signing: "wallet" }),
  getSettings: () => ({ signing: "wallet" }),
}))
vi.mock("../safe/route", () => ({
  signingRoute: async () => ({ kind: "wallet" }),
  isSafeRoute: () => false,
}))
vi.mock("./tx-store", () => ({ useTx: () => null, closeTx: () => {} }))
vi.mock("@wagmi/core", () => ({
  getGasPrice: async () => 1n,
  estimateGas: async () => 21_000n,
  getAccount: () => ({ address: undefined }),
}))
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
  // The review's loading skeleton reads the response's nonce from the router.
  useRouter: () => ({ options: {} }),
}))
vi.mock("@matchbox/motion/haptics", () => ({
  fireHaptic: () => {},
  preloadHaptics: async () => {},
}))

const account = getAddress("0x1f3a000000000000000000000000000000000001")
const shown = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"
const moved = "0x00000000000000000000000000000000000000a1"

function found(address: string): IdentityLookup {
  return { status: "found", identity: { address, mezoId: "pyke.mezo" } }
}

describe("a review that stops", () => {
  it("shows the moved wallet, blocks signing, and confirms it next time", async () => {
    const answers = [found(moved), found(moved)]
    const read = async () => answers.shift() ?? { status: "unavailable" }
    let current = shown
    const sent: string[] = []
    async function prepare(): Promise<Review> {
      const to = await freshRecipient(
        "pyke.mezo",
        current,
        (address) => {
          current = address
        },
        read,
      )
      sent.push(to)
      return {
        headline: { label: "You send", figure: "1 MUSD" },
        rows: [{ label: "To", value: "pyke.mezo" }],
        steps: [],
        blocked: null,
        done: { rows: [] },
      }
    }
    render(
      <TxSheet
        config={{} as Config}
        account={account}
        titles={{ form: "Send", review: "Review", sign: "Sign", done: "Sent" }}
        form={{ content: <p>Form</p>, cta: "Review", ready: true }}
        prepare={prepare}
        reviewCta="Send"
        success={{ toast: "Sent", refresh: [] }}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Review" }))
    await screen.findByText(
      "pyke.mezo now points to a different address. Check it before you send.",
    )
    expect(screen.getByText(getAddress(moved))).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull()
    expect(sent).toEqual([])
    fireEvent.click(screen.getByRole("button", { name: "Review again" }))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeTruthy(),
    )
    expect(sent).toEqual([getAddress(moved)])
  })

  it("blocks with Try again when the lookup fails, and Edit goes back", async () => {
    async function prepare(): Promise<Review> {
      await freshRecipient(
        "pyke.mezo",
        shown,
        () => {},
        async () => ({
          status: "unavailable",
        }),
      )
      throw new Error("unreachable")
    }
    render(
      <TxSheet
        config={{} as Config}
        account={account}
        titles={{ form: "Send", review: "Review", sign: "Sign", done: "Sent" }}
        form={{ content: <p>Form</p>, cta: "Review", ready: true }}
        prepare={prepare}
        reviewCta="Send"
        success={{ toast: "Sent", refresh: [] }}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Review" }))
    await screen.findByText("Couldn't look up this Mezo ID. Try again.")
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    expect(await screen.findByText("Form")).toBeTruthy()
  })
})
