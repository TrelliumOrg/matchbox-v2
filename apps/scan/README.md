# Matchscan (`scan.matchbox.markets`)

Mezo's explorer: TanStack Start on Cloudflare Workers. Pages read the API
Worker over the `API` service binding: the Blockscout proxy
(`/internal/blockscout/api/v2/*`) and Matchscan's read routes
(`/internal/scan/*`, apps/api README "Scan read routes"). A lock owner's
address page also reads the wallet read models Matchbox Pro reads
(`/internal/pro/wallets/{a}/rewards` and `/overview`) for its rewards,
veMEZO votes and claimable; claiming is a link to Pro.

## Local development

```sh
cp apps/scan/.dev.vars.example apps/scan/.dev.vars   # fixtures, no backend
pnpm --filter @matchbox/scan dev                      # http://localhost:3001
pnpm --filter @matchbox/scan test                     # unit tests
pnpm --filter @matchbox/scan build && pnpm --filter @matchbox/scan e2e
pnpm --filter @matchbox/scan measure                  # JS and loader budgets
```

In fixtures mode a request header `x-scan-fixture: disabled | limited |
filling` plays the API's 503, 429 and still-filling answers (never cached).

## Environments

| Environment | Worker                 | Where                                   | API binding                                         |
| ----------- | ---------------------- | --------------------------------------- | --------------------------------------------------- |
| (top level) | `matchscan-v2`         | local builds only, never deployed       | `matchbox-api-v2-preview`                           |
| `preview`   | `matchscan-v2-preview` | `scan.matchbox.markets` and workers.dev | `matchbox-api-v2-preview`, entrypoint `InternalApi` |

`preview` is production, named as apps/pro's live environment is (Pro's
`preview` serves `pro.matchbox.markets`). It binds the same API Worker as
Pro's live environment, `matchbox-api-v2-preview`, because that is the API
with the `/internal/scan` routes and BlockHub; the binding uses the API's
`InternalApi` entrypoint, which the API trusts whatever URL it builds
(apps/api README, Internal routes, rule 2). Canonical URLs and link-preview
tags always name `https://scan.matchbox.markets` (`src/site.ts`).

## Deploy (humans only)

Agents never deploy. In order:

1. **API first.** The API Worker `matchbox-api-v2-preview` must be deployed
   with its `InternalApi` entrypoint (and, for the read routes, `SCAN_DB`;
   until the database is bound, `/internal/scan` answers 503 and Matchscan
   shows its "Not available yet" states, reading Blockscout directly).
2. **The caller salt.** Generate a random value of at least 32 bytes and
   set it as a secret on every deployed environment, today only `preview`:

   ```sh
   openssl rand -base64 48 | pnpm --filter @matchbox/scan exec wrangler secret put BLOCKSCOUT_CALLER_SALT --env preview
   ```

   It keys each visitor's rate-limit bucket (a SHA-256 of the salt and the
   visitor's IP prefix, `X-Matchbox-End-User`). Without it, or with one
   under 32 bytes, Matchscan fails closed: it logs one line per isolate,
   `BLOCKSCOUT_CALLER_SALT is missing: no X-Matchbox-End-User key is sent,
every visitor shares the anonymous rate-limit bucket`, sends no key at
   all (never an unsalted hash) and keeps serving.

3. **WalletConnect.** Matchscan uses Matchbox Pro's WalletConnect project
   (`src/shell/wallet-options.ts`). In WalletConnect Cloud, add
   `https://scan.matchbox.markets` to that project's allowed origins.
4. **Build and deploy:**

   ```sh
   CLOUDFLARE_ENV=preview pnpm --filter @matchbox/scan build
   pnpm --filter @matchbox/scan exec wrangler deploy --dry-run   # check
   pnpm --filter @matchbox/scan exec wrangler deploy
   ```

   The build bakes the environment in (`dist/server/wrangler.json`), so
   deploy takes no `--env`. The first deploy creates the
   `scan.matchbox.markets` custom domain on the zone.
