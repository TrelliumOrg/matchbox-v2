# @matchbox/domain

Pure domain logic: money and formatting, Mezo Earn epochs
([EPOCHS.md](EPOCHS.md)), vote and reward math, the vote optimizer, voting
APR, boost and veMEZO math, loan math, prices and pool types. It never
imports React, Hono or a Worker binding (a test enforces it), so every app,
Worker and script can use it. Amounts are integers in base units: see
[agent-instructions/financial-precision.md](../../agent-instructions/financial-precision.md).

A workspace package: it is not published to npm, has no build step and is
imported as TypeScript source by the apps in this repository.

## Tests

```sh
pnpm --filter @matchbox/domain test       # unit tests (Vitest)
pnpm --filter @matchbox/domain typecheck
```

The tests need no network, keys or services.
