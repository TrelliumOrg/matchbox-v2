# @matchbox/stuart-ui

Stuart's interface and its wire contract. `@matchbox/stuart-ui/contract`
holds the zod schemas the Stuart Worker ([apps/stuart](../../apps/stuart))
and its clients share. The other entry points are the launcher, the panel
and answer cards, the command palette, search, paste handling and the
client store, used by Matchbox Pro.

A workspace package: it is not published to npm, has no build step and is
imported as TypeScript source by the apps in this repository.

## Tests

```sh
pnpm --filter @matchbox/stuart-ui test       # unit tests (Vitest)
pnpm --filter @matchbox/stuart-ui typecheck
```

The tests need no network, keys or services.
