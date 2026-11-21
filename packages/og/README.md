# @matchbox/og

Link preview images: renders a React element to PNG inside a Worker with
Satori and resvg (both WebAssembly) and the bundled Figtree and DM Mono
fonts, plus the Worker side: Cache API caching with a bundled fallback card.
A caller brings its own cards and meta tags.

No app imports it at run time. Matchbox Pro renders its link previews with
its own, separate code in [apps/pro/src/og](../../apps/pro/src/og).

## Static cards

The homepage, Matchscan, Matchbox Docs and Matchbox ID share one static
1200x630 card each, `public/og.png` in each app, drawn by
[src/site-card.tsx](src/site-card.tsx) from the copy in
[src/site-cards.ts](src/site-cards.ts): Pro's brand card with the product's
lockup. After changing a card, write the PNGs and commit them:

```sh
pnpm --filter @matchbox/og cards
```

`src/site-cards.test.tsx` fails when a committed PNG is not what the script
draws.

A workspace package: it is not published to npm, has no build step and is
imported as TypeScript source by the apps in this repository.

## Tests

```sh
pnpm --filter @matchbox/og test       # unit tests (Vitest)
pnpm --filter @matchbox/og typecheck
```

The tests need no network, keys or services.
