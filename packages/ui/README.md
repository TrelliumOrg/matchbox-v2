# @matchbox/ui

The component library every app builds its screens from: cards, tables,
charts, fields, sheets, tabs, toasts, lockups, the explorer's inspectors and
more, one directory per component under `src/`. Import a component by its
directory, for example `@matchbox/ui/callout`, and the styles once from
`@matchbox/ui/styles.css`. The component kit app
([apps/kit](../../apps/kit)) shows them all.

A workspace package: it is not published to npm, has no build step and is
imported as TypeScript source by the apps in this repository.

## Tests

```sh
pnpm --filter @matchbox/ui test       # unit tests (Vitest)
pnpm --filter @matchbox/ui typecheck
```

The tests need no network, keys or services.
