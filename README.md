# Matchbox v2

Matchbox Pro, Matchscan, Matchbox ID, Matchbox Developer, Stuart, the Matchbox
API and the indexer: tools for voting, locks, rewards and on-chain data on
[Mezo](https://mezo.org), built on Cloudflare Workers.

```sh
pnpm install
pnpm build
pnpm test
```

- How to set up, run each app locally and send a change: [CONTRIBUTING.md](CONTRIBUTING.md)
- Coding conventions (for people and agents): [CLAUDE.md](CLAUDE.md) and
  [agent-instructions/](agent-instructions)
- Reporting a vulnerability: [SECURITY.md](SECURITY.md)

## Apps and packages

| Path             | What                                                                | Runs locally without keys               |
| ---------------- | ------------------------------------------------------------------- | --------------------------------------- |
| `apps/pro`       | Matchbox Pro: vote, locks, rewards, optimize                        | Yes, on recorded fixtures               |
| `apps/scan`      | Matchscan, the explorer                                             | Yes, on recorded fixtures               |
| `apps/home`      | The homepage                                                        | Yes, on fixtures                        |
| `apps/docs`      | The docs site, prerendered from `packages/docs`                     | Yes                                     |
| `apps/id`        | Matchbox ID, the OIDC provider and wallet sign-in                   | Yes, in-memory store                    |
| `apps/developer` | Matchbox Developer, the API console                                 | Yes, in-memory store and dev sign-in    |
| `apps/api`       | The Matchbox API                                                    | Yes, `pnpm dev:memory` with sample data |
| `apps/stuart`    | Stuart, the assistant                                               | Yes, deterministic answers only         |
| `apps/feedback`  | The feedback widget's Worker                                        | Yes, with Turnstile test keys           |
| `apps/indexer`   | Chain indexer into Postgres                                         | With a local Postgres                   |
| `apps/jobs`      | Scheduled jobs that build the read models                           | Partly (see its README)                 |
| `apps/kit`       | Component kit                                                       | Yes                                     |
| `apps/spike`     | Platform spike, never deployed                                      | Yes, local D1                           |
| `packages/*`     | Shared libraries (`@matchbox/<name>`), the SDK under `packages/sdk` | Tests need nothing                      |

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
