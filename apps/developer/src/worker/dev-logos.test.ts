import { describe, expect, it, vi } from "vitest"
import { devLogoFetch } from "./dev-logos"
import { pinLogo } from "./logo-pin"

describe("end-to-end fixture logos", () => {
  it("serve logos.example.com as distinct pinnable PNGs, and nothing else", async () => {
    const fallback = vi.fn(async () => new Response("real"))
    const fetchLogo = devLogoFetch(fallback)
    const first = await pinLogo(
      fetchLogo,
      "https://logos.example.com/a.png?v=1",
    )
    const second = await pinLogo(
      fetchLogo,
      "https://logos.example.com/a.png?v=2",
    )
    expect(first.ok && first.logo.contentType).toBe("image/png")
    expect(
      first.ok && second.ok && first.logo.sha256 !== second.logo.sha256,
    ).toBe(true)
    expect(fallback).not.toHaveBeenCalled()
    await fetchLogo("https://example.org/logo.png", {})
    expect(fallback).toHaveBeenCalledOnce()
  })
})
