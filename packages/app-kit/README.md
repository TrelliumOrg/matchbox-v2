# @matchbox/app-kit

The shared frame of the TanStack Start apps (Pro, Matchscan, the homepage,
Docs, Matchbench, ID and Developer): the root document, the server entry,
security headers and the Content Security Policy, loading, pending and
empty states, read-model fetching, theme sync and view transitions. Each
entry point is imported on its own path, for example
`@matchbox/app-kit/security` or `@matchbox/app-kit/root-document`.

A workspace package: it is not published to npm, has no build step and is
imported as TypeScript source by the apps in this repository.

## Tests

```sh
pnpm --filter @matchbox/app-kit test       # unit tests (Vitest)
pnpm --filter @matchbox/app-kit typecheck
```

The tests need no network, keys or services.
