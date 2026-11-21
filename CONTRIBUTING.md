# Contributing

Thanks for helping. This guide covers setup, running each app on your own
machine without access to production, tests, and how to send a change.
Conventions for code (for people and coding agents alike) are in
[CLAUDE.md](CLAUDE.md) and [agent-instructions/](agent-instructions).

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Report
security problems privately, as described in [SECURITY.md](SECURITY.md), not
in an issue.

## Prerequisites

- Node.js 24 (the exact version CI uses is in `.nvmrc`; `nvm use` or
  `fnm use` picks it up).
- pnpm 9.14.2: `corepack enable` picks it up from `packageManager` in
  `package.json`.
- Git.
- Optional: Docker (a local Postgres for the indexer), Playwright's Chromium
  for end-to-end tests (`pnpm --filter @matchbox/<app> exec playwright
install --with-deps chromium`), and Foundry's `anvil` for Pro's
  transaction tests on a mainnet fork.

Linux, macOS and Windows all work. On Windows, run the commands in Git Bash
or another POSIX shell (`cp` in the steps below).

## Install

```sh
git clone https://github.com/TrelliumOrg/matchbox-v2.git
cd matchbox-v2
corepack enable
pnpm install --frozen-lockfile
```

Then start an app (below), or run the checks. `pnpm build` and `pnpm test`
run across every app and package, which takes a while: use
`--filter @matchbox/<name>` for one. Before a full `pnpm build`, copy
`apps/pro/.dev.vars.example` to `apps/pro/.dev.vars` so Pro builds on its
fixtures, as CI does.

## Run an app locally

Every app runs without production credentials. Each has a
`.dev.vars.example`: copy it to `.dev.vars` (git-ignored) in the app's
directory. Never commit `.dev.vars` or `.env` files.

| App                          | Setup                                                                                                                                                       | Start                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Pro (`apps/pro`)             | `cp .dev.vars.example .dev.vars` (recorded Epoch 47 fixtures)                                                                                               | `pnpm --filter @matchbox/pro dev`, :3000        |
| Matchscan (`apps/scan`)      | `cp .dev.vars.example .dev.vars` (recorded fixtures)                                                                                                        | `pnpm --filter @matchbox/scan dev`, :3001       |
| Homepage (`apps/home`)       | `cp .dev.vars.example .dev.vars` (fixtures)                                                                                                                 | `pnpm --filter @matchbox/home dev`, :3006       |
| Docs (`apps/docs`)           | Nothing                                                                                                                                                     | `pnpm --filter @matchbox/docs-site dev`, :3005  |
| ID (`apps/id`)               | `cp .dev.vars.example .dev.vars`, then put the output of `pnpm --filter @matchbox/id --silent keys:generate` in `OIDC_SIGNING_KEYS` (in-memory store)       | `pnpm --filter @matchbox/id dev`, :5180         |
| Developer (`apps/developer`) | `cp .dev.vars.example .dev.vars` (in-memory store, dev sign-in)                                                                                             | `pnpm --filter @matchbox/developer dev`, :5175  |
| API (`apps/api`)             | `cp .dev.vars.example .dev.vars`, then `pnpm db:seed:local` from the root for the read models (below)                                                       | `pnpm --filter @matchbox/api dev:memory`, :8787 |
| Stuart (`apps/stuart`)       | `cp .dev.vars.example .dev.vars` (no model key: deterministic answers). Data questions read the seeded API: run it first and Stuart on `--port 8788`        | `pnpm --filter @matchbox/stuart dev`, :8787     |
| Matchbench (`apps/bench`)    | Nothing                                                                                                                                                     | `pnpm --filter @matchbox/bench dev`, :3007      |
| Feedback (`apps/feedback`)   | `cp .dev.vars.example .dev.vars` (Turnstile test keys), then `pnpm --filter @matchbox/feedback exec wrangler d1 migrations apply matchbox-feedback --local` | `pnpm --filter @matchbox/feedback dev`, :8787   |
| Indexer (`apps/indexer`)     | `cp .dev.vars.example .dev.vars` and a local Postgres (the file shows a `docker run`), then `pnpm --filter @matchbox/indexer migrate`                       | `pnpm --filter @matchbox/indexer dev`           |
| Jobs (`apps/jobs`)           | `cp .dev.vars.example .dev.vars`, then `pnpm --filter @matchbox/jobs db:migrate:local` (see "What needs keys")                                              | `pnpm --filter @matchbox/jobs dev`, :8790       |
| Kit (`apps/kit`)             | Nothing                                                                                                                                                     | `pnpm --filter @matchbox/kit dev`, :5174        |
| Spike (`apps/spike`)         | `pnpm --filter @matchbox/spike db:setup` (local D1)                                                                                                         | `pnpm --filter @matchbox/spike dev`, :3000      |

The `cp` commands run in the app's directory (`apps/<app>`). Wrangler-based
Workers (API, Stuart, Feedback, Indexer) default to port 8787 and Jobs to
8790, so run one at a time or pass `--port`. Each app's README has more:
routes, configuration and what each variable does.

### A local data stack

The API's internal read routes (`/internal/pro/*`, `/internal/scan/*`),
which Stuart and Pro read, need data in the API's local D1 databases. One
command migrates them and fills them with fixtures already in the
repository (the Epoch 47 read models that Pro, Matchscan and Stuart use in
fixture mode, the API's scan test rows and demo prices). It needs no
credentials and only writes local state (`apps/api/.wrangler/state`):

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm db:seed:local                                # run again any time to reset
pnpm --filter @matchbox/api dev:memory            # :8787
pnpm --filter @matchbox/stuart dev --port 8788    # second terminal
```

Checked on 19 Nov 2026 in deterministic mode: Stuart answered a gauge
question (top incentives, from the seeded directory), a protocol question
(veMEZO lockers, from the seeded summary) and wallet questions for a real
wallet (locks and earnings, which the API reads live from the public Mezo
RPCs), and `/internal/pro/summary`, `/internal/pro/gauges` and
`/internal/scan/borrow/troves` returned seeded data. To call `/internal/*`
with curl, set `INTERNAL_TOKEN` in `apps/api/.dev.vars` and send it as a
bearer. Pro reads this API instead of its fixtures with `PRO_DATA=api`,
`API_ORIGIN=http://127.0.0.1:8787` and the same `INTERNAL_TOKEN` in
`apps/pro/.dev.vars`; Matchscan cannot yet. Details and limits: the API's
README, "Local read models".

### What needs keys of your own

Nothing below is needed for tests, lint, typecheck or the fixture modes
above.

- **API with real data** (`pnpm --filter @matchbox/api dev` instead of
  `dev:memory`): your own Supabase project (`SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`). Mezo RPC is public.
- **ID and Developer on Supabase** (instead of the memory store): your own
  Supabase project. Developer's Google sign-in needs your own Google OAuth
  client (`GOOGLE_CLIENT_ID`); the dev sign-in works without it. Usage
  charts need a Cloudflare account's Analytics Engine token
  (`CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN`); memory mode shows synthetic
  usage.
- **Stuart with a model**: your own `ANTHROPIC_API_KEY`.
- **Feedback posted to Discord**: your own bot token and channel.
- **Jobs**: the warehouse snapshot reads the indexer's Postgres schema
  (`WAREHOUSE_DATABASE_URL`, read-only), so it needs the indexer loaded into
  your own Postgres first. The price and RPC jobs use public endpoints;
  CoinGecko's keyless API is used without `COINGECKO_API_KEY`.
- **Pro and Matchscan on live data** (`PRO_DATA=api`, `SCAN_DATA=api`): a
  running API with its read models filled by the jobs Worker. For fixture
  data through a local API, see "A local data stack" above.
- **Deploying**: maintainers deploy the official sites. A fork deploys to its
  own Cloudflare account: replace the account, D1, KV and route settings in
  each `wrangler.jsonc` with your own.

## Tests

```sh
pnpm test                                   # every package's unit tests
pnpm --filter @matchbox/<pkg> test          # one package
pnpm --filter @matchbox/<app> e2e           # browser tests, after a build
pnpm test:scripts                           # the repository scripts' tests
```

`pnpm test` runs every package through Turbo and takes several minutes the
first time. While you work, run the tests of the packages you changed.

CI runs the tests on slow, busy machines, so a test must not depend on how
fast the machine is. Run anything timed on fake timers
(`vi.useFakeTimers()`) or an injected clock, wait for the event itself
(`vi.waitFor`, `waitOnExecutionContext`) instead of a fixed pause, and
compare timings within one run rather than against a number of milliseconds.
Every `vitest.config.ts` sets `testTimeout: 30_000` and
`hookTimeout: 60_000`, the same locally and in CI: the limits only catch a
hang. Packages without one are quick enough for vitest's defaults.

End-to-end tests run against each app's fixtures or memory store (copy the
app's `.dev.vars.example` first). The indexer's two-connection tests need a
real Postgres: set `MATCHBOX_TEST_DATABASE_URL`
(`postgres://postgres@localhost:5432/postgres` with the Docker command above)
and run `pnpm --filter @matchbox/indexer exec vitest run
test/row-seq/concurrency.pg.test.ts`.

## Lint, format and checks

```sh
pnpm lint          # Biome, Prettier for JSON, YAML and Markdown, and the link check
pnpm lint:fix
pnpm typecheck
pnpm check:links   # relative links in Markdown point at files that exist
pnpm check:secrets # no keys or tokens in tracked files
pnpm check:trellium
```

`pnpm check:trellium` keeps private material out of the repository: it fails
on private IP addresses, home directory paths, personal email addresses,
`ssh user@host` commands, secret shapes and unsafe workflow changes. Tests
use reserved values (`example.com`, `.test` domains, documentation
addresses). A genuine false positive gets a narrow entry with a reason in
`scripts/trellium-allowlist.json`.

## Commits and pull requests

- One logical change per commit, with a message that says why as well as
  what, wrapped at 80 columns ([agent-instructions/git.md](agent-instructions/git.md)).
- Run lint, typecheck and the tests of every package you touched before you
  push. CI runs the same on every pull request, on GitHub-hosted runners with
  no secrets.
- Open a pull request against `main` and fill in the template. Keep pull
  requests focused; say how you tested, with screenshots for UI changes (dark
  and light, desktop and phone).
- UI copy follows the rules in [CLAUDE.md](CLAUDE.md): terse labels and
  numbers, no em or en dashes, no middle dots, no semicolons.
- Coding agents are welcome. You are responsible for what you submit: review
  the change as if you wrote it.

## Licence of contributions

This project is licensed under the GNU Affero General Public License,
version 3 only ([LICENSE](LICENSE)). By submitting a contribution you agree
that it is licensed under the same terms (inbound equals outbound), and that
you have the right to submit it. The AGPL means anyone who runs a modified
version as a network service must offer its source to that service's users;
your contribution will be covered by that too.

### Sign-off

This project uses the
[Developer Certificate of Origin 1.1](https://developercertificate.org/)
(DCO). There is no Contributor Licence Agreement to sign.

Every commit in a pull request needs a `Signed-off-by:` line with your name
and an email address you can be reached at, matching the commit's author:

```text
Signed-off-by: Your Name <you@example.com>
```

By adding it you certify the DCO: that you wrote the change, or otherwise
have the right to submit it under the project's licence, and that you
understand the contribution and its sign-off are public and kept
permanently. Use your real name or the name you are known by publicly, not
an anonymous one.

Git adds the line for you:

```sh
git config user.name "Your Name"            # once, if not set
git config user.email "you@example.com"
git commit -s                               # sign off a new commit
git commit --amend --no-edit -s             # sign off the last commit
git rebase --signoff main                   # sign off every commit on your branch
git push --force-with-lease                 # update your pull request after a rebase
```

A pull request whose commits are not all signed off is not merged until
they are. Commits written with a coding agent are signed off by you, the
person submitting them.
