// Writes the static link preview cards (src/site-cards.ts): 1200x630 PNGs
// in the homepage's, Matchscan's, Matchbox Docs' and Matchbox ID's public/
// folders, drawn by src/site-card.tsx with the bundled fonts and the
// outlined lockups. Run it after changing a card and commit the PNGs:
//
//   pnpm --filter @matchbox/og cards
//
// src/site-cards.test.tsx fails when a committed PNG is not what this draws.
// Vite loads the card module, so its `?inline` fonts and `?raw` icons
// resolve as they do in the apps.
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createElement } from "react"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const apps = fileURLToPath(new URL("../../../apps/", import.meta.url))

const server = await createServer({
  root,
  configFile: false,
  logLevel: "warn",
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
})
try {
  const { siteCards } = await server.ssrLoadModule("/src/site-cards.ts")
  const { SiteCardView } = await server.ssrLoadModule("/src/site-card.tsx")
  const { renderPng } = await server.ssrLoadModule("/src/render.ts")
  for (const { out, card } of siteCards) {
    const png = await renderPng(createElement(SiteCardView, { card }))
    writeFileSync(`${apps}${out}`, png)
    console.log(`${out}: ${png.byteLength} bytes`)
  }
} finally {
  await server.close()
}
