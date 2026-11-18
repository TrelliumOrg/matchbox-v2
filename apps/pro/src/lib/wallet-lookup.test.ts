import { beforeEach, describe, expect, it } from "vitest"
import {
  browserWalletLookupFailed,
  resetWalletLookup,
  walletLookupMeta,
} from "./wallet-context"

/**
 * The Worker's "lookup failed" meta counts for the page the document
 * loaded, never for a page reached afterwards in the same tab.
 */

function addMeta(): void {
  const meta = document.createElement("meta")
  meta.name = walletLookupMeta
  meta.content = "unavailable"
  document.head.appendChild(meta)
}

beforeEach(() => {
  resetWalletLookup()
  for (const meta of document.querySelectorAll(
    `meta[name="${walletLookupMeta}"]`,
  )) {
    meta.remove()
  }
})

describe("browserWalletLookupFailed", () => {
  it("is the loaded page's only, and the meta is gone after one read", () => {
    addMeta()
    expect(browserWalletLookupFailed("/down.mezo/vote")).toBe(true)
    expect(
      document.querySelector(`meta[name="${walletLookupMeta}"]`),
    ).toBeNull()
    // Re-rendered, still that page.
    expect(browserWalletLookupFailed("/down.mezo/vote")).toBe(true)
    // A genuine not found page reached later in the tab.
    expect(browserWalletLookupFailed("/nobody.mezo/vote")).toBe(false)
  })

  it("is false for every page when the Worker said nothing", () => {
    expect(browserWalletLookupFailed("/down.mezo/vote")).toBe(false)
    // A meta added later (never by the Worker) is not read again.
    addMeta()
    expect(browserWalletLookupFailed("/down.mezo/vote")).toBe(false)
  })
})
