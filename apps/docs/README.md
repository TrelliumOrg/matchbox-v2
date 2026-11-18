# Matchbox Docs

docs.matchbox.markets: one documentation site for Matchbox Pro, Matchscan, Matchbox ID, Matchbox Developer
and Stuart. TanStack Start on Cloudflare Workers, like the other apps, but every page is prerendered at build
time and served as a static asset. Content and generators live in `packages/docs`.

## Commands

```sh
pnpm --filter @matchbox/docs-site build    # packages/docs first (turbo), then prerender and postbuild
pnpm --filter @matchbox/docs-site preview  # workerd on :4183
pnpm --filter @matchbox/docs-site e2e      # desktop 1440 and Pixel 7, against the preview
pnpm --filter @matchbox/docs-site measure  # initial JS per route, with the preview running
pnpm --filter @matchbox/docs-site lhci     # Lighthouse through the brotli proxy on :4184
pnpm --filter @matchbox/docs-site dev      # :3005
```

Ports 4183 and 4184 keep the docs clear of the other apps' previews on 4173.

The site needs no environment values or secrets: every page is prerendered
from `packages/docs`. `VITE_STUART_URL` (optional, at build time) points "Ask
about this page" at a Stuart Worker; without it the button opens search.

## How a page is served

1. `vite build` builds the client and the Worker, then TanStack Start's prerenderer requests every page in
   `packages/docs/dist/routes.json` (and every link it finds) from a preview of that Worker, writing
   `dist/client/<path>/index.html`. `/404` becomes `dist/client/404.html`.
2. `scripts/postbuild.mjs` gives every page a `<meta>` CSP whose `script-src` lists the SHA-256 of each inline
   script on it (no `unsafe-inline`, no `unsafe-eval`), strips the router from 404.html, and checks every
   link and fragment in the built HTML.
3. Cloudflare serves matching assets before any Worker code runs (`run_worker_first: false`). Navigation
   misses get 404.html from the asset layer (`not_found_handling: "404-page"`). `_redirects` and `_headers`
   come from `dist/public`, which `scripts/prebuild.mjs` assembles from `public/` and `packages/docs`.
4. A client navigation loads the next page's JSON chunk from `/assets/`. There are no server functions and
   no data loaders (a test enforces it), so it never reaches the Worker.
5. The Worker (`src/server.ts`) only sees non-navigation requests that match nothing. It answers with the
   static 404 and never renders: Start renders only for requests carrying this build's prerender token,
   which only the prerender crawler has. Every Worker response carries `x-docs-worker`; the smoke tests
   fail if a page view, a redirect, a search or a client navigation gets one.

## Ask about this page

The page header's "Ask about this page" posts the question and the page path to Stuart's public
`POST /docs/ask` (contract in `@matchbox/docs/ask`) and shows up to three reviewed notes, this page's first.
The panel loads on hover, focus or click. Set `VITE_STUART_URL` at build time, as Pro does: the bundle and
every page CSP's `connect-src` both read it through `scripts/stuart-origin.mjs`. A build without it, a failed
request or a non-2xx answer opens search with the question instead. CI builds with an origin nothing listens
on, and the smoke tests mock it.

## Appearance

The pre-paint script from `@matchbox/tokens` reads the shared `mbx-appearance` cookie on .matchbox.markets
first, then this browser's storage, so a theme picked in Pro, Matchscan or ID shows here with no flash. The
ThemeProvider writes the cookie. postbuild hashes whatever the script is at build time into each CSP.

## Layout

Layout v2 (Doop `WC_9ztyeY-`, approved 10 Nov 2026): a two-row header, 104 tall and always shown, with the
page actions and Appearance in row 1 and the product row in row 2 (`src/shell/header.tsx`). Below it, at most
three columns: section navigation, the article and On this page, 240, 792 and 200 at 1440 and stopping at 1360
above it. On this page becomes a list button in the header below 1280, the section navigation becomes the
section pill at 834, and phones keep their top bar, nav sheet and bottom bar. Text stops at 620; code, the
epoch clock, wide tables and media use the full column (`.docs-measure` and `.docs-wide`). API operation and
MCP tool pages put their samples in On this page's slot (`src/content/samples-layout.tsx`).
`e2e/layout.spec.ts` measures every column, the sticky offsets, the Ctrl K bar's centre, the keyboard order and
horizontal overflow at 1920, 1440, 1280, 1024, 834 and 390.

## Budgets

LCP under 1.2 s and CLS 0 (Lighthouse, mobile, simulated), under 120 kB brotli of initial JS per route, no
wallet code. Measured on 10 Nov 2026 with layout v2: LCP 0.77 to 0.79 s, CLS 0, 105 to 110 kB.

## Deploy

Never from a laptop. Build with `CLOUDFLARE_ENV=preview` and deploy the generated config, as Pro and
Matchscan do. `wrangler.jsonc`'s `preview` environment names `matchbox-docs-preview` on workers.dev only.
It carries no custom domain until the cutover: wrangler takes over a hostname's DNS record without asking
when it cannot prompt (CI, agents), so a route left in the config would move docs.matchbox.markets off
Netlify on the first deploy. Before each deploy, check the generated `dist/server/wrangler.json` names
`matchbox-docs-preview` with `"routes": []`.
