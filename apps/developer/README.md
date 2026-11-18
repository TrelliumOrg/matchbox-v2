# Matchbox Developer (`developer.matchbox.markets`)

Sign-in-with-Google console for organizations, apps, test/live environments,
API keys, client secrets, usage and docs, plus staff review at `/admin`.
Worker `matchbox-developer-console`, custom domain
`developer.matchbox.markets`.

The Hono console server (`src/worker`) is ported from
`apps/developer-console` in `MallardLabs/Matchbox` at `origin/main` 5c657b5
(6 Nov 2026), which includes every 29 Oct audit fix (logo pinning, atomic
review close, staff id redaction). Behaviour is unchanged; imports moved to
`@matchbox/contracts`, `@matchbox/server`, `@matchbox/logger` and
`@matchbox/tokens` (the theme script the CSP hashes).

## Layout

- `src/worker`: the Hono console server, unchanged from the live Worker.
- `src/server.ts`: the Worker entry. `/api/*` goes to the console server;
  `/privacy` redirects as before; every other path is a TanStack Start page
  with the old page meta (`worker/meta.ts`), the old security headers and a
  fresh CSP nonce on every inline script (`src/lib/document-csp.ts`).
- `src/routes`, `src/app`: the pages. Loaders read the console server's GET
  routes in-process through server functions (`src/app/data`); every write
  is sent by the browser to `/api/*`. Sheets, the API client (zod) and the
  Google button load on intent, never with the page.

Every Classic console page is rebuilt to its Doop frame (canvas
`hFp5UsQ4BA`), except docs: `/docs/*` answers 302 to the unified docs at
`DOCS_ORIGIN` (`src/lib/docs-redirect.ts`). Known differences from the
frames, each because the API has no data for it: the invitation page names
no organization (no token preview), Usage has no 90-day range, app or route
picker, previous-period line or recent error codes, client secrets show no
last use, the Apps card shows no owner, and the sign-in footer has no Status
link (no status page). The OAuth tab (`ue1xxOLm6q`) has not been compared
with its frame yet.

## Commands

```sh
pnpm --filter @matchbox/developer dev        # vite dev, http://localhost:5175
pnpm --filter @matchbox/developer build
pnpm --filter @matchbox/developer preview    # the built Worker in workerd
pnpm --filter @matchbox/developer test
pnpm --filter @matchbox/developer typecheck  # pages and Worker, two programs
pnpm --filter @matchbox/developer e2e        # Playwright, after build
```

The end-to-end tests (`e2e/`) start `vite preview` on a fresh memory store
and log it to `.e2e-server.log`; they need `.dev.vars` from the example and
`npx playwright install chromium` once.

This app has answered developer.matchbox.markets since 13 Nov 2026 (it replaced Classic's Worker of the
same name). Build without `CLOUDFLARE_ENV` for production, check
`dist/server/wrangler.json`, then `wrangler deploy` from the app's folder.

## Environments are fixed at build time

The Cloudflare Vite plugin writes the Worker's config into
`dist/server/wrangler.json` when it builds, with the vars of the
environment named by `CLOUDFLARE_ENV` at that moment; `wrangler deploy`
ships that file whatever `--env` says later. Build each environment on its
own:

```sh
pnpm --filter @matchbox/developer build                         # production
CLOUDFLARE_ENV=staging pnpm --filter @matchbox/developer build  # staging
```

`pnpm build` ends with `scripts/check-build-env.mjs`, which fails when the
built Worker's name or `CONSOLE_ORIGIN` and `ID_ORIGIN` are not the ones `wrangler.jsonc` gives the
requested environment.

## Local development

```sh
cp .dev.vars.example .dev.vars
pnpm --filter @matchbox/developer dev
```

`.dev.vars.example` sets `PLATFORM_STORE=memory`,
`DEVELOPER_CONSOLE_ENABLED=true` and `CONSOLE_ORIGIN=http://localhost:5175`;
set `GOOGLE_CLIENT_ID` to use the real Google button. Memory mode is refused
when `ENVIRONMENT=production`. Seed (`src/worker/store/seed.ts`): account
`dev@matchbox.local` (staff `reviewer`), org "Mallard Labs", an approved live
gauge-profile app, an app with an open review for `discord:profile` and
optional `discord:membership`, and one whose `discord:id` request came back
with a reviewer note. Use the dev sign-in (`POST /api/auth/dev-sign-in`,
memory mode outside production only). Usage data is synthetic unless
`CF_ACCOUNT_ID` and `CF_ANALYTICS_TOKEN` are set.

## Configuration

Vars (`wrangler.jsonc`): `ENVIRONMENT`, `DEVELOPER_CONSOLE_ENABLED` (default
`"false"`: `/api/*` returns 503 `service_disabled`), `CONSOLE_ORIGIN`,
`GOOGLE_CLIENT_ID` (Google OAuth client id; required in production),
`STAFF_EMAIL_DOMAINS` (comma-separated Workspace domains whose accounts are
staff operators), `PUBLIC_API_ORIGIN`, `ID_ORIGIN`.

Secrets (`wrangler secret put`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`API_KEY_PEPPER` (same value as the API Worker), `CLIENT_SECRET_PEPPER`
(same value as Matchbox ID), `SESSION_PEPPER`, `CF_ACCOUNT_ID`,
`CF_ANALYTICS_TOKEN` (read-only Analytics Engine SQL API token; without them
usage endpoints return 503). Invalid config returns 500 `internal_error` on
`/api/*` even while disabled.

Bindings: `ASSETS` (the built client), Durable Object `RATE_LIMITER`
(`RateLimiter`, migration `v1`),
cross-script `API_RATE_LIMITER` (the API Worker's `RateLimiter`, read-only
quota peeks; `script_name` `matchbox-developer-api`, staging
`matchbox-developer-api-staging`), `send_email` `EMAIL` (from
`no-reply@matchbox.markets`).

Platform health (`GET /api/platform/health`, public) reads the
`mbx_platform_health` dataset with the same `CF_ACCOUNT_ID` /
`CF_ANALYTICS_TOKEN`; memory mode serves a fixed local fixture.

Staff: Google Workspace accounts on `STAFF_EMAIL_DOMAINS` become `operator`
at sign-in. Anyone else is added to `mbx_dev_staff` (`account_id`, `role` =
`reviewer` | `operator`) by SQL.
