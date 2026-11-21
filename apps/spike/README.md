# Platform spike

An early experiment that tried the stack the apps now use (TanStack Start
on Cloudflare Workers, a D1 database, a lazy-loaded wallet) on a small vote
page: a gauge list (`/`) and a gauge page (`/gauge/$id`) on seeded data.
It is kept as a reference and is never deployed. New work belongs in the
real apps.

## Run it locally

Nothing to set up beyond a local D1 database, which Wrangler keeps under
`.wrangler/` in this directory:

```sh
pnpm --filter @matchbox/spike db:setup   # migrations and seed data, local D1
pnpm --filter @matchbox/spike dev        # http://localhost:3000
pnpm --filter @matchbox/spike typecheck
```

It uses port 3000, as Matchbox Pro does, so run one at a time. The spike
has no tests. `pnpm --filter @matchbox/spike measure [baseUrl]` measures the
initial JavaScript and streaming of a running preview.
