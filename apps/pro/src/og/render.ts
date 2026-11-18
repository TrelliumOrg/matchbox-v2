import { Resvg } from "@cf-wasm/resvg"
import { type Font, satori } from "@cf-wasm/satori"
import { dataUriBytes } from "./assets"
import { type CardAssets, cardElement, cardHeight, cardWidth } from "./cards"
import dmMono400 from "./fonts/dm-mono-400.ttf?inline"
import figtree400 from "./fonts/figtree-400.ttf?inline"
import figtree500 from "./fonts/figtree-500.ttf?inline"
import figtree650 from "./fonts/figtree-650.ttf?inline"
import type { Card } from "./model"

/**
 * Card to PNG: Satori lays the element tree out (yoga) and writes SVG with
 * the text as paths, then resvg rasterises it, both as WebAssembly modules
 * the Worker loads at startup. Fonts are subset TTFs bundled as data URIs:
 * Figtree 400, 500 and 650 (static instances of the variable font) and
 * DM Mono 400.
 */

let fonts: Font[] | null = null

function loadFonts(): Font[] {
  if (fonts === null) {
    const style = "normal"
    fonts = [
      { name: "Figtree", data: dataUriBytes(figtree400), weight: 400, style },
      { name: "Figtree", data: dataUriBytes(figtree500), weight: 500, style },
      // The 650 instance: Satori takes weights in hundreds.
      { name: "Figtree", data: dataUriBytes(figtree650), weight: 600, style },
      { name: "DM Mono", data: dataUriBytes(dmMono400), weight: 400, style },
    ]
  }
  return fonts
}

export async function renderSvg(
  card: Card,
  assets: CardAssets,
): Promise<string> {
  return satori(cardElement(card, assets), {
    width: cardWidth,
    height: cardHeight,
    fonts: loadFonts(),
  })
}

export async function renderPng(
  card: Card,
  assets: CardAssets,
): Promise<Uint8Array> {
  const svg = await renderSvg(card, assets)
  const resvg = await Resvg.async(svg, {
    fitTo: { mode: "width", value: cardWidth },
    font: { loadSystemFonts: false },
  })
  try {
    const image = resvg.render()
    try {
      return image.asPng()
    } finally {
      image.free()
    }
  } finally {
    resvg.free()
  }
}
