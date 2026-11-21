# Matchbox

Matchbox is a set of open source tools for [Mezo](https://mezo.org), the
Bitcoin network: voting, locks and rewards on Mezo Earn, a chain explorer,
an assistant, and the API and indexer behind them. Every app runs on
Cloudflare Workers and every one of them runs on your own machine without
production credentials.

| Product                                        | What it does                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [Matchbox Pro](https://pro.matchbox.markets)   | Vote with veMEZO and veBTC on Mezo Earn, lock, claim rewards and find the best split of votes.                                      |
| [Matchscan](https://scan.matchbox.markets)     | An explorer for Mezo: blocks, transactions, addresses, tokens, gauges, locks, pools, validators and borrowing.                      |
| Stuart                                         | The assistant inside Matchbox Pro. It answers questions about Mezo from sourced data and prepares unsigned transactions for review. |
| [Matchbench](https://bench.matchbox.markets)   | A public leaderboard of how Claude models perform inside Stuart.                                                                    |
| [Matchbox Docs](https://docs.matchbox.markets) | Guides for Pro, Matchscan, ID, Developer and Stuart, and the API reference.                                                         |
| [Homepage](https://matchbox.markets)           | The front door, with live network figures.                                                                                          |

## Quick start

You need Node.js 24 (the exact version is in `.nvmrc`) and Git. pnpm comes
from Corepack.

```sh
git clone https://github.com/TrelliumOrg/matchbox-v2.git
cd matchbox-v2
corepack enable
pnpm install --frozen-lockfile
cp apps/pro/.dev.vars.example apps/pro/.dev.vars
pnpm --filter @matchbox/pro dev    # http://localhost:3000, on recorded fixtures
```

Every other app starts the same way: see the table below and
[CONTRIBUTING.md](CONTRIBUTING.md) for each one's setup. Checks:

```sh
pnpm lint        # Biome, Prettier and the Markdown link check
pnpm typecheck
pnpm test        # every package's unit tests (heavy: one package with --filter)
```

## Apps and packages

Each directory has a README with what it is, how to run it locally and what
needs credentials of your own.

| Path                  | What                                                                                                                         | Runs locally without keys                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `apps/pro`            | Matchbox Pro                                                                                                                 | Yes, on recorded fixtures                                                 |
| `apps/scan`           | Matchscan                                                                                                                    | Yes, on recorded fixtures                                                 |
| `apps/stuart`         | Stuart's Worker, and the Matchbench runner in `apps/stuart/bench`                                                            | Yes, deterministic answers (data questions need the seeded API)           |
| `apps/bench`          | Matchbench, the leaderboard site (prerendered from one results file)                                                         | Yes                                                                       |
| `apps/docs`           | The docs site, prerendered from `packages/docs`                                                                              | Yes                                                                       |
| `apps/home`           | The homepage                                                                                                                 | Yes, on fixtures                                                          |
| `apps/id`             | Matchbox ID: the OIDC provider and wallet sign-in                                                                            | Yes, in-memory store                                                      |
| `apps/developer`      | Matchbox Developer: API keys, OAuth clients and usage                                                                        | Yes, in-memory store and dev sign-in                                      |
| `apps/api`            | The Matchbox API, and the read routes Pro, Matchscan and Stuart use                                                          | Yes, `dev:memory` with sample data; read models from `pnpm db:seed:local` |
| `apps/feedback`       | The Worker behind the feedback widget                                                                                        | Yes, with Turnstile test keys                                             |
| `apps/indexer`        | Indexes Mezo chain events into Postgres                                                                                      | With a local Postgres (tests need nothing)                                |
| `apps/jobs`           | Scheduled jobs that build the read models                                                                                    | Partly (tests need nothing)                                               |
| `apps/kit`            | A page showing the shared components in every theme                                                                          | Yes                                                                       |
| `apps/spike`          | An early platform experiment, kept for reference, never deployed                                                             | Yes, local D1                                                             |
| `packages/sdk`        | `@matchbox-dev/sdk`, the TypeScript client for the API, on npm                                                               | Tests need nothing                                                        |
| `packages/docs`       | The docs content and its generators                                                                                          | Tests need nothing                                                        |
| `packages/domain`     | Pure domain logic: money, epochs, vote and reward math, the optimizer                                                        | Tests need nothing                                                        |
| `packages/chain`      | Chains, contract addresses and ABIs                                                                                          | Tests need nothing                                                        |
| `packages/contracts`  | Wire contracts (zod) between the Workers and their clients                                                                   | Tests need nothing                                                        |
| `packages/ui`         | The component library                                                                                                        | Tests need nothing                                                        |
| `packages/*` (others) | `app-kit`, `feedback-ui`, `live`, `logger`, `motion`, `og`, `perf`, `server`, `stuart-ui`, `token-icons`, `tokens`, `wallet` | Tests need nothing                                                        |

Workspace packages are imported as `@matchbox/<name>` from TypeScript
source. Only the SDK is built and published.

## Contributing and security

- Setup, running each app, tests and sending a change:
  [CONTRIBUTING.md](CONTRIBUTING.md). Commits are signed off under the
  [DCO](CONTRIBUTING.md#sign-off).
- Coding conventions, for people and coding agents:
  [CLAUDE.md](CLAUDE.md) and [agent-instructions/](agent-instructions).
- Report a vulnerability privately: [SECURITY.md](SECURITY.md).
- Changes by release: [CHANGELOG.md](CHANGELOG.md).
- Everyone taking part agrees to the [Code of Conduct](CODE_OF_CONDUCT.md).
- Questions: <contact@trellium.org>.

## Licence

Copyright (C) 2026 Trellium and contributors.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, version 3 (`AGPL-3.0-only`). It is distributed in the
hope that it will be useful, but WITHOUT ANY WARRANTY; without even the
implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See
[LICENSE](LICENSE) for the full text.

If you run a modified version as a network service, the AGPL requires you to
offer its users the corresponding source.

Third-party fonts, icons and data keep their own licences: see the notices
next to them (for example the SIL Open Font License files beside the Figtree
and DM Mono fonts).

## Trademarks

The licence covers the code. It does not grant rights to the Matchbox,
Matchscan or Trellium names and logos, or to the Mezo name, logos and token
marks, which belong to their owners. If you deploy a fork, give it a
different name and logo.
