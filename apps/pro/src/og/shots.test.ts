// @vitest-environment node
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { fetchPicture } from "./assets"
import { loadDefault, loadGauge, loadProtocol, type Reader } from "./data"
import { type Card, defaultCard } from "./model"
import { renderPng } from "./render"

/**
 * Not part of the suite: renders every card from the live preview API into
 * `OG_SHOTS_DIR` and times each render, and regenerates the bundled
 * fallback with `OG_FALLBACK=1`. Run from apps/pro:
 * `OG_SHOTS_DIR=/tmp/og pnpm vitest run src/og/shots.test.ts`.
 */

const dir = process.env.OG_SHOTS_DIR
const api =
  process.env.OG_API_ORIGIN ??
  "https://matchbox-api-v2-preview.mallard.workers.dev"
const host = "pro.matchbox.markets"

const read: Reader = async (path, schema) => {
  const response = await fetch(new URL(path, api))
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`${path} ${response.status}`)
  return schema.parse(await response.json())
}

const gauges = {
  "gauge-vebtc": "0x449b06b9b6c9b649b610105d1a5e337e1d6d3d1e",
  "gauge-pool": "0x6d446e27505c71ee39d632488ce849fef6affc57",
  "gauge-mezo": "0x2ced96e759ab481210d41c567eee5c42edb59a1d",
}

/** Milliseconds per render after the first (wasm and fonts warm). */
async function timed(render: () => Promise<Uint8Array>): Promise<{
  png: Uint8Array
  ms: number[]
}> {
  let png = await render()
  const ms: number[] = []
  for (let run = 0; run < 5; run += 1) {
    const started = performance.now()
    png = await render()
    ms.push(Math.round(performance.now() - started))
  }
  return { png, ms }
}

describe.skipIf(dir === undefined)("link preview shots", () => {
  test("renders every card from the preview API", async () => {
    const out = dir ?? "."
    const sources = {
      read,
      reference: null,
      nowSeconds: Math.floor(Date.now() / 1000),
    }
    const cards: Record<string, Card | null> = {
      default: await loadDefault(sources),
      protocol: await loadProtocol(sources, null),
      "protocol-40": await loadProtocol(sources, 40),
      ...Object.fromEntries(
        await Promise.all(
          Object.entries(gauges).map(
            async ([name, address]) =>
              [name, await loadGauge(sources, address)] as const,
          ),
        ),
      ),
    }
    for (const [name, card] of Object.entries(cards)) {
      expect(card).not.toBeNull()
      if (card === null) continue
      const picture =
        card.kind === "gauge" && card.picture.kind === "image"
          ? await fetchPicture(card.picture.url, fetch)
          : null
      const { png, ms } = await timed(() => renderPng(card, { host, picture }))
      writeFileSync(join(out, `${name}.png`), png)
      console.log(`${name}: ${ms.join(", ")} ms`)
    }
    if (process.env.OG_FALLBACK === "1") {
      const brand = defaultCard(null, null, 0, 0)
      writeFileSync(
        join(import.meta.dirname, "fallback.png"),
        await renderPng(brand, { host, picture: null }),
      )
    }
  }, 120_000)
})
