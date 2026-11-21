# @matchbox/contracts

The wire contracts between the Workers and their clients, as
[zod](https://zod.dev) schemas with their TypeScript types: the public API
(gauge profiles, networks, errors, cursors, rate limits), OIDC and consent
for Matchbox ID, the console for Matchbox Developer, the read models Pro and
Matchscan render (with demo fixtures under
`@matchbox/contracts/read-models/fixtures`), the Blockscout proxy, feedback
reports and the Matchbench results file (`@matchbox/contracts/bench`).

`@matchbox/contracts/openapi.json` is the API's OpenAPI document, written
from the schemas:

```sh
pnpm --filter @matchbox/contracts generate:openapi
```

A workspace package: it is not published to npm, has no build step and is
imported as TypeScript source by the apps in this repository.

## Tests

```sh
pnpm --filter @matchbox/contracts test       # unit tests (Vitest)
pnpm --filter @matchbox/contracts typecheck
```

The tests need no network, keys or services.
