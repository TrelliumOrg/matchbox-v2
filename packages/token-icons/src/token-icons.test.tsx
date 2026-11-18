import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  bundledTokenIcon,
  resolveTokenIcon,
  TokenIcon,
  tokenIcons,
} from "./index"

afterEach(cleanup)

const address = "0x7b7C000000000000000000000000000000000000"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("registry", () => {
  it("bundles the seven official icons with CoinGecko names", () => {
    expect(Object.keys(tokenIcons)).toEqual([
      "BTC",
      "MEZO",
      "MUSD",
      "mUSDC",
      "mUSDT",
      "SolvBTC",
      "xSolvBTC",
    ])
    expect(tokenIcons.SolvBTC.name).toBe("Solv Protocol solvBTC")
    expect(tokenIcons.xSolvBTC.name).toBe("Solv Protocol Staked BTC")
  })

  it("imports icons with ?url, which works under SSR on Workers", () => {
    const registry = readFileSync(resolve("src/registry.ts"), "utf8")
    expect(registry).not.toContain("import.meta")
    expect(registry).toContain('.svg?url&no-inline"')
  })

  it("points every entry at a real SVG file", () => {
    for (const token of Object.values(tokenIcons)) {
      const file = token.src.split("/").pop()?.split("?")[0] ?? ""
      expect(file).toMatch(/\.svg$/)
      // `?url` imports resolve to the source path under vitest, so read the
      // file relative to the package root vitest runs in.
      const svg = readFileSync(resolve("src/icons", file), "utf8")
      expect(svg).toContain("<svg")
    }
  })

  it("returns null for tokens without official art", () => {
    expect(bundledTokenIcon("BTC")).toBe(tokenIcons.BTC.src)
    expect(bundledTokenIcon("PEPE")).toBeNull()
  })
})

describe("TokenIcon", () => {
  it("renders the official coin with the ticker as alt", () => {
    render(<TokenIcon ticker="MEZO" size={28} />)
    const img = screen.getByRole("img", { name: "MEZO" })
    expect(img.tagName).toBe("IMG")
    expect(img.getAttribute("src")).toBe(tokenIcons.MEZO.src)
    expect(img.getAttribute("width")).toBe("28")
    expect(img.getAttribute("height")).toBe("28")
  })

  it("uses an explicit src for long-tail tokens", () => {
    render(<TokenIcon ticker="WETH" src="https://example.com/weth.png" />)
    expect(screen.getByRole("img", { name: "WETH" }).getAttribute("src")).toBe(
      "https://example.com/weth.png",
    )
  })

  it("falls back to the first letter when there is no art", () => {
    render(<TokenIcon ticker="tBTC" size={18} />)
    const coin = screen.getByRole("img", { name: "tBTC" })
    expect(coin.tagName).toBe("SPAN")
    expect(coin.textContent).toBe("T")
    expect(coin.style.width).toBe("18px")
  })

  it("falls back to the first letter when the image fails", () => {
    render(<TokenIcon ticker="WETH" src="https://example.com/broken.png" />)
    fireEvent.error(screen.getByRole("img", { name: "WETH" }))
    const coin = screen.getByRole("img", { name: "WETH" })
    expect(coin.tagName).toBe("SPAN")
    expect(coin.textContent).toBe("W")
  })
})

describe("resolveTokenIcon", () => {
  it("returns the Blockscout icon_url", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        icon_url: "https://storage.googleapis.com/mezo/weth.png",
        symbol: "WETH",
        name: "Wrapped Ether",
      }),
    )
    await expect(resolveTokenIcon(address, fetchFn)).resolves.toEqual({
      src: "https://storage.googleapis.com/mezo/weth.png",
      symbol: "WETH",
    })
    expect(fetchFn).toHaveBeenCalledWith(
      `https://api.explorer.mezo.org/api/v2/tokens/${address}`,
      { headers: { accept: "application/json" } },
    )
  })

  it("rejects invalid addresses without fetching", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}))
    await expect(resolveTokenIcon("0x123", fetchFn)).resolves.toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("returns null when the token has no icon", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ icon_url: null, symbol: "XYZ" }),
    )
    await expect(resolveTokenIcon(address, fetchFn)).resolves.toBeNull()
  })

  it("returns null on HTTP errors, bad JSON and unexpected shapes", async () => {
    await expect(
      resolveTokenIcon(address, async () => jsonResponse({}, 404)),
    ).resolves.toBeNull()
    await expect(
      resolveTokenIcon(address, async () => new Response("<html>")),
    ).resolves.toBeNull()
    await expect(
      resolveTokenIcon(address, async () =>
        jsonResponse({ icon_url: "not a url" }),
      ),
    ).resolves.toBeNull()
    await expect(
      resolveTokenIcon(address, async () => {
        throw new TypeError("network")
      }),
    ).resolves.toBeNull()
  })

  it("honours a custom base URL", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ icon_url: "https://cdn.example.com/a.png" }),
    )
    await resolveTokenIcon(address, fetchFn, {
      baseUrl: "https://api.matchbox.markets/blockscout",
    })
    expect(fetchFn).toHaveBeenCalledWith(
      `https://api.matchbox.markets/blockscout/tokens/${address}`,
      expect.anything(),
    )
  })
})
