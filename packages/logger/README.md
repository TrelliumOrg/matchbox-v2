# @matchbox/logger

A small structured logger for Workers and scripts: one JSON line per entry
(or a readable line in development), with levels and fields. No
dependencies.

A workspace package: it is not published to npm, has no build step and is
imported as TypeScript source by the apps in this repository.

## Tests

```sh
pnpm --filter @matchbox/logger test       # unit tests (Vitest)
pnpm --filter @matchbox/logger typecheck
```

The tests need no network, keys or services.
