# @matchbox/live

The latest Mezo block in the browser: a shared head store for the block
ticker and block-tied queries, the source that feeds it (the API's
`/internal/heads` WebSocket, with polling as the fallback) and the Worker
route that relays it. Used by the homepage and Matchscan.

A workspace package: it is not published to npm, has no build step and is
imported as TypeScript source by the apps in this repository.

## Tests

```sh
pnpm --filter @matchbox/live test       # unit tests (Vitest)
pnpm --filter @matchbox/live typecheck
```

The tests need no network, keys or services.
