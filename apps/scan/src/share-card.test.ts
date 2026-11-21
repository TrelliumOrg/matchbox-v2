import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { cardTags, ogImage, pageDescription, previewHtml } from "./share-card"

function content(key: string): string | undefined {
  return cardTags.find((tag) => tag.property === key)?.content
}

describe("the link preview card", () => {
  it("is the 1200x630 public/og.png at an absolute address", () => {
    expect(ogImage).toBe("https://scan.matchbox.markets/og.png")
    expect(content("og:image")).toBe(ogImage)
    expect(content("og:image:width")).toBe("1200")
    expect(content("og:image:height")).toBe("630")
    expect(content("og:image:alt")).toBeTruthy()
    // The tests run from apps/scan.
    const file = join(process.cwd(), "public", new URL(ogImage).pathname)
    expect(existsSync(file)).toBe(true)
  })

  it("needs no escaping in the tags it writes", () => {
    for (const tag of cardTags) {
      expect(`${tag.property}${tag.content}`).not.toMatch(/["<>&]/)
    }
  })
})

describe("a pasted page's description", () => {
  it("names the transaction, lock, epoch, gauge or address it is", () => {
    expect(
      pageDescription(
        "/tx/0xbb02",
        "Swapped tokens in BTC/MUSD Volatile 0xbb022d00…65f0daad, Matchscan",
      ),
    ).toBe(
      "Swapped tokens in BTC/MUSD Volatile 0xbb022d00…65f0daad, a Mezo transaction",
    )
    expect(pageDescription("/locks/vebtc/6033", "veBTC #6033, Matchscan")).toBe(
      "Lock #6033, veBTC, on Mezo: amount, unlock date, votes and rewards",
    )
    expect(pageDescription("/epochs/49", "Epoch 49, Matchscan")).toMatch(
      /^Epoch 49 on Mezo: /,
    )
    expect(
      pageDescription("/gauges/0x8be2", "BTC/MUSD Volatile, Matchscan"),
    ).toBe("BTC/MUSD Volatile gauge on Mezo: votes, voters, incentives and APY")
    expect(pageDescription("/address/0x147379", "Enclave B, Matchscan")).toBe(
      "Enclave B on Mezo: tokens, transactions, locks, votes and loans",
    )
  })

  it("keeps Matchscan's own elsewhere and before a page has its name", () => {
    expect(pageDescription("/gauges", "Gauges, Matchscan")).toBeNull()
    expect(pageDescription("/", "Matchscan")).toBeNull()
    expect(pageDescription("/gauges/0x8be2", "Gauge, Matchscan")).toBeNull()
  })
})

describe("the preview tags the Worker writes", () => {
  it("name the page on the production origin with the large card", () => {
    const html = previewHtml("/epochs/47", "Epoch 47, Matchscan", "Mezo")
    expect(html).toContain(
      '<meta property="og:url" content="https://scan.matchbox.markets/epochs/47">',
    )
    expect(html).toContain(
      '<meta property="og:title" content="Epoch 47, Matchscan">',
    )
    expect(html).toContain('<meta name="twitter:description" content="Mezo">')
    expect(html).toContain(
      '<meta name="twitter:card" content="summary_large_image">',
    )
    expect(html).toContain(
      '<link rel="canonical" href="https://scan.matchbox.markets/epochs/47">',
    )
    expect(html).toContain(`<meta property="og:image" content="${ogImage}">`)
    expect(html).not.toContain("workers.dev")
  })

  it("never lets a title close its attribute", () => {
    expect(previewHtml("/", 'a" onload="x', "d")).not.toContain('a" onload')
  })
})
