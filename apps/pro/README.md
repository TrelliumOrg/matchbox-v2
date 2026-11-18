# Matchbox Pro (`pro.matchbox.markets`)

Vote, claim and lock on Mezo Earn: TanStack Start on Cloudflare Workers.
Pages read the API Worker over the `API` service binding, or the bundled
Epoch 47 fixtures locally.

## Local development

```sh
cp apps/pro/.dev.vars.example apps/pro/.dev.vars   # fixtures, no backend
pnpm --filter @matchbox/pro dev                     # http://localhost:3000
pnpm --filter @matchbox/pro test                    # unit tests
pnpm --filter @matchbox/pro build && pnpm --filter @matchbox/pro e2e
pnpm --filter @matchbox/pro measure                 # 125 kB script budget
pnpm --filter @matchbox/pro e2e:fork                # transactions on an Anvil fork
```

## Security headers

Every Worker response but the `/live/heads` socket carries HSTS, nosniff,
Referrer-Policy, Permissions-Policy, COOP and a Content Security Policy
(`src/server.ts`, sources in `src/security.server.ts`, headers from
`@matchbox/app-kit/security`). Scripts run only with the response's nonce
and what they load (`'strict-dynamic'`). Only Pro itself and
`https://safe.mezo.org` (the Safe App) may frame a page. Static files get
the same headers, CSP aside, from `public/_headers`.

`e2e/security.spec.ts` checks the headers and walks the main routes, the
wallet drawer and Stuart with no violation. A new source a page needs goes
in `proCspOptions`.

### Rolling back the policy

If a wallet or an embedded screen breaks under the policy, switch it to
report-only. Framing stays enforced, nothing else is blocked, and each
violation the browser reports (report-uri `/csp-report`) is logged by the
Worker as "CSP violation", with the directive and the blocked URL, which
says what to add.

Deploys are for humans only. The build bakes the environment in
(`dist/server/wrangler.json`), so deploy takes no `--env`:

```sh
CLOUDFLARE_ENV=preview pnpm --filter @matchbox/pro build
pnpm --filter @matchbox/pro exec wrangler deploy --var PRO_CSP:report-only
```

That lasts until the next deploy. To keep it, set `PRO_CSP` to
`"report-only"` in the `preview` vars of `wrangler.jsonc` instead; set it
back to `"enforce"` to enforce again. The var is declared there so a value
set in the dashboard cannot be silently replaced by a deploy: change it in
the file, not the dashboard.
