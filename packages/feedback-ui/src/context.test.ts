import { feedbackContextSchema } from "@matchbox/contracts/feedback"
import { afterEach, describe, expect, it } from "vitest"
import {
  buildOf,
  collectContext,
  routeOf,
  shortAddress,
  themeOf,
  walletBrowserOf,
  withoutAddress,
} from "./context"

describe("routeOf", () => {
  it("keeps the path and drops the query and fragment", () => {
    expect(routeOf("https://pro.matchbox.markets/vote/vebtc")).toBe(
      "/vote/vebtc",
    )
    expect(
      routeOf(
        "https://pro.matchbox.markets/?address=0x5dc2000000000000000000000000000000071af0",
      ),
    ).toBe("/")
    expect(
      routeOf("https://scan.matchbox.markets/tx/0xabc?tab=logs&ref=x#raw"),
    ).toBe("/tx/0xabc")
    expect(routeOf("https://id.matchbox.markets/consent#code=secret")).toBe(
      "/consent",
    )
  })

  it("handles a bare path and a value that is not a URL", () => {
    expect(routeOf("/gauges?sort=apy")).toBe("/gauges")
    expect(routeOf("gauges?x=1")).toBe("/gauges")
  })

  it("always passes the contract's route rule", () => {
    for (const href of [
      "https://pro.matchbox.markets/a b?c=d",
      "https://pro.matchbox.markets/%3Fnot-a-query",
      `https://pro.matchbox.markets/${"x".repeat(900)}`,
    ]) {
      const route = routeOf(href)
      expect(route).toMatch(/^\/[^?#\s]*$/)
      expect(route.length).toBeLessThanOrEqual(512)
    }
  })
})

describe("withoutAddress", () => {
  const own = "0x7C21095156ab25e989c3c084bcb06037c6539e0b"

  it("keeps the connected wallet's own address out of the route", () => {
    expect(
      withoutAddress("/0x7c21095156ab25e989c3c084bcb06037c6539e0b/vote", own),
    ).toBe("/:wallet/vote")
  })

  it("leaves other addresses, such as a gauge, alone", () => {
    const gauge = "/gauges/0x4da4c05483324ea9cfc951510a5e77cc79541159"
    expect(withoutAddress(gauge, own)).toBe(gauge)
    expect(withoutAddress("/x", "not an address")).toBe("/x")
  })
})

describe("walletBrowserOf", () => {
  it("names the wallets' own browsers", () => {
    expect(
      walletBrowserOf(
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/142.0 Mobile Safari/537.36 OKApp/(OKEx/6.90.0)",
      ),
    ).toBe("okx")
    expect(
      walletBrowserOf(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MetaMaskMobile",
      ),
    ).toBe("metamask")
    expect(
      walletBrowserOf(
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/142.0 Mobile Safari/537.36 BitKeep Android",
      ),
    ).toBe("bitget")
  })

  it("leaves an ordinary browser alone", () => {
    expect(
      walletBrowserOf(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      ),
    ).toBeNull()
  })
})

describe("the page context", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme")
    document.documentElement.style.colorScheme = ""
    document.head.innerHTML = ""
    window.history.replaceState(null, "", "/")
  })

  it("reads the theme the page resolved", () => {
    document.documentElement.dataset.theme = "onyx"
    document.documentElement.style.colorScheme = "dark"
    expect(themeOf(document.documentElement)).toEqual({
      mode: "dark",
      preset: "onyx",
    })
    document.documentElement.dataset.theme = "Not A Preset"
    document.documentElement.style.colorScheme = "light"
    expect(themeOf(document.documentElement)).toEqual({
      mode: "light",
      preset: null,
    })
  })

  it("reads the build from the entry chunk's file name", () => {
    const page = new DOMParser().parseFromString(
      '<head><script type="module" src="https://pro.matchbox.markets/assets/main-Bx3k9Qa1.js"></script></head>',
      "text/html",
    )
    expect(buildOf(page)).toBe("Bx3k9Qa1")
    expect(buildOf(new DOMParser().parseFromString("", "text/html"))).toBe(null)
  })

  it("collects a context that satisfies the contract, without the query", () => {
    window.history.replaceState(null, "", "/vote/vebtc?address=0xabc#top")
    const context = collectContext({ surface: "pro", chainId: 31612 })
    expect(context.route).toBe("/vote/vebtc")
    expect(context.chainId).toBe(31612)
    expect(feedbackContextSchema.safeParse(context).success).toBe(true)
    expect(JSON.stringify(context)).not.toContain("0xabc")
  })

  it("shortens addresses as the panel shows them", () => {
    expect(shortAddress("0x5Dc2000000000000000000000000000000071aF0")).toBe(
      "0x5Dc2…1aF0",
    )
  })
})
