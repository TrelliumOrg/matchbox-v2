// @vitest-environment node
import { describe, expect, it } from "vitest"
import { dataUriBytes } from "./assets"
import { renderPng } from "./render"
import { SiteCardView } from "./site-card"
import { siteCards } from "./site-cards"

/** The committed cards, by path under apps/ ("home/public/og.png"). */
const committed = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../../../apps/*/public/og.png", {
      query: "?inline",
      import: "default",
      eager: true,
    }),
  ).map(([path, uri]) => [
    path.replace("../../../apps/", ""),
    new Uint8Array(dataUriBytes(uri)),
  ]),
)

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, at) => byte === b[at])
}

describe("site cards", () => {
  it.each(siteCards)(
    "$out is what scripts/site-cards.mjs draws",
    async ({ out, card }) => {
      const file = committed[out]
      expect(file).toBeDefined()
      if (file === undefined) return
      expect(pngSize(file)).toEqual({ width: 1200, height: 630 })
      const drawn = await renderPng(<SiteCardView card={card} />)
      // A miss means the card changed: run `pnpm --filter @matchbox/og cards`.
      expect(same(drawn, file)).toBe(true)
    },
    30_000,
  )

  it("keeps the copy free of dashes, middle dots and semicolons", () => {
    for (const { card } of siteCards) {
      expect(`${card.label} ${card.headline}`).not.toMatch(/[–—·;]/)
    }
  })
})
