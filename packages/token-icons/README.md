# @matchbox/token-icons

Token icons for the apps: Mezo's official token SVGs (BTC, MEZO, mUSD and
the others in `src/icons`), a registry that maps a token to its icon, and a
`TokenIcon` component with a fallback for unknown tokens.

The token marks belong to their owners (see Trademarks in the
[root README](../../README.md#trademarks)).

A workspace package: it is not published to npm, has no build step and is
imported as TypeScript source by the apps in this repository.

## Tests

```sh
pnpm --filter @matchbox/token-icons test       # unit tests (Vitest)
pnpm --filter @matchbox/token-icons typecheck
```

The tests need no network, keys or services.
