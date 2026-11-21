# @matchbox/tokens

Design tokens: the colour theme presets (`themes.css`), the Tailwind theme
(`tailwind.css`) and the appearance helpers. The appearance is kept in a
cookie shared across the Matchbox sites, so a theme picked on one shows on
the others, and a small pre-paint script applies it before the first paint.

A workspace package: it is not published to npm, has no build step and is
imported as TypeScript source by the apps in this repository.

## Tests

```sh
pnpm --filter @matchbox/tokens test       # unit tests (Vitest)
pnpm --filter @matchbox/tokens typecheck
```

The tests need no network, keys or services.
