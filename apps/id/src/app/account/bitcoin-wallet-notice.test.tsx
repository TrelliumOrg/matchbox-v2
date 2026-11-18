import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  BitcoinWalletNotice,
  bitcoinWalletNotice,
  bitcoinWalletNoticeEnabled,
} from "./bitcoin-wallet-notice"

describe("Bitcoin-wallet notice", () => {
  it("is off unless the build turns it on", () => {
    expect(bitcoinWalletNoticeEnabled(undefined)).toBe(false)
    expect(bitcoinWalletNoticeEnabled("")).toBe(false)
    expect(bitcoinWalletNoticeEnabled("1")).toBe(false)
    expect(bitcoinWalletNoticeEnabled("true")).toBe(true)
  })

  it("says what to do instead", () => {
    render(<BitcoinWalletNotice />)
    const notice = screen.getByRole("complementary", {
      name: bitcoinWalletNotice.title,
    })
    expect(notice.textContent).toContain("Sign in with an EVM wallet")
  })
})
