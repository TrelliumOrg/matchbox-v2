# CLAUDE.md - Agent Instructions

Matchbox v2: Matchbox Pro, Matchscan, Matchbox ID, Matchbox Developer, Stuart, the
Matchbox API and the indexer. These instructions are for anyone, person or
agent, who changes the code. `CONTRIBUTING.md` has setup and the pull request
flow.

- ALWAYS run `pnpm lint` and `pnpm typecheck` after changes, and the tests of
  every package you touched.
- ALWAYS check CLAUDE.md and the linked files after a set of changes to make
  sure all instructions were followed.
- Maintainers: if an `internal/` directory exists in your checkout, read
  `internal/CLAUDE.md` too. It holds the operational instructions that are not
  published.

## Public and internal material

This code is published as open source under the AGPL-3.0. Internal documents
live only under `internal/`, which is never published:

- Anything about machines, credentials, production operations (database names
  and ids, deploy and cutover steps, incidents), plans and priorities, or
  people goes under `internal/`, never in a README, a code comment, a test or
  a commit message.
- Never write private IP addresses, home directory paths, personal email
  addresses or `ssh user@host` commands outside `internal/`. Tests use
  reserved values (`example.com`, `.test`, documentation addresses).
- `pnpm check:trellium` enforces this in CI. If it flags a real false
  positive, add a narrow, reviewed entry to `scripts/trellium-allowlist.json`
  with a reason; never weaken a pattern to get a change through.

## Commands

- Install: `pnpm install`
- Build everything: `pnpm build`
- Dev (one app): `pnpm --filter @matchbox/<app> dev`
- Test: `pnpm test` (one package: `pnpm --filter @matchbox/<pkg> test`)
- Lint: `pnpm lint` (fix: `pnpm lint:fix`)
- Typecheck: `pnpm typecheck`
- Secrets and public boundary: `pnpm check:secrets`, `pnpm check:trellium`,
  `pnpm test:scripts`

## Code layout

- `apps/*` are deployable Workers and frontends. `packages/*` are shared
  libraries, imported as `@matchbox/<name>`.
- Pure domain logic (money, epochs, optimizer, vote and loan math) lives in
  `packages/domain` and never imports React, Hono or a Worker binding.
- Contract addresses and ABIs live only in `packages/chain`.
- This repository uses `turbo` for cross-package builds.

## Code style

- No semicolons.
- Follow the root `biome.json`.
- For filetypes Biome does not support, use prettier.
- Use default exports for single exports.

## Design and copy

- The house style is the `matchbox-v3` guideline; colour tokens are
  `matchbox-themes` (the presets ship in `packages/tokens`). Build screens
  from `@matchbox/ui` components and theme tokens.
- Copy is terse fintech: labels and numbers, no explanatory sentences. No em or
  en dashes, no middle dots, no semicolons in UI text, no decorative pills.

## Additional details

ALWAYS RESPECT the more detailed information in:

- TypeScript and JavaScript: ./agent-instructions/typescript.md
- Financial precision: ./agent-instructions/financial-precision.md
- Git commits and messages: ./agent-instructions/git.md
- Workers and server code: ./agent-instructions/server.md
- UI packages and React: ./agent-instructions/ui-and-react.md
- Performance and motion: ./agent-instructions/performance-and-motion.md
- Supabase migrations and database changes: ./agent-instructions/supabase-migrations.md
