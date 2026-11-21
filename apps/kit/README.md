# Matchbox kit

A local page that shows the shared components from `@matchbox/ui`, the
theme presets from `@matchbox/tokens`, the token icons and the motion
helpers, in every theme. Use it to look at a component while you change it.
It is a plain Vite and React app with no server and no data, and it is never
deployed.

## Run it locally

Nothing to set up: no environment values, keys or services.

```sh
pnpm --filter @matchbox/kit dev        # http://localhost:5174
pnpm --filter @matchbox/kit build
pnpm --filter @matchbox/kit typecheck
```

The kit has no tests of its own. The components' tests live with them:
`pnpm --filter @matchbox/ui test`.
