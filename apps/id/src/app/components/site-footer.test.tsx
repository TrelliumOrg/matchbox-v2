import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { SiteLinks } from "./site-footer"

describe("site links", () => {
  it("lists the homepage's footer links in its order", () => {
    render(<SiteLinks />)
    const nav = screen.getByRole("navigation", { name: "Matchbox" })
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "Pro",
      "Matchscan",
      "ID",
      "Developer",
      "Docs",
      "Classic",
      "Privacy",
    ])
    expect(within(nav).getByRole("link", { name: "Privacy" })).toHaveProperty(
      "href",
      "https://matchbox.markets/privacy#matchbox-id",
    )
  })

  it("gives every link a box at least 40 by 40", () => {
    render(<SiteLinks />)
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).toMatch(/\bmin-h-10\b/)
      expect(link.className).toMatch(/\bmin-w-10\b/)
    }
  })
})
