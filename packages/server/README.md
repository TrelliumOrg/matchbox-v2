# @matchbox/server

Shared code for the Hono Workers (API, ID, Developer, Feedback, Stuart):
request bodies and parameters, cookies, crypto helpers, errors, feature
flags, IP prefixes, middleware, quotas, audit rows, platform health and the
`RateLimiter` Durable Object (`@matchbox/server/rate-limiter`).

A workspace package: it is not published to npm, has no build step and is
imported as TypeScript source by the apps in this repository.

## Tests

```sh
pnpm --filter @matchbox/server test       # unit tests (Vitest)
pnpm --filter @matchbox/server typecheck
```

The tests need no network, keys or services.
