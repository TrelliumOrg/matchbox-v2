import path from "node:path"

// What keeps `pnpm db:seed:local` on local state. The seed script builds
// every wrangler command and its child environment through these checks,
// so a change that would point it at a deployed database fails before
// anything runs (guard.test.ts).
//
// - The script takes no arguments.
// - Every wrangler command is `d1 migrations apply <binding> --local`,
//   never `--remote`, with `--persist-to` the API's local state directory.
// - Only the environments listed here, and never one named like production.
//   `CLOUDFLARE_ENV` (wrangler's environment selector) must be unset.
// - Cloudflare credentials are removed from the child environment, so
//   wrangler has no account to reach even if a flag slipped through.

/** Bindings the seed migrates, as the API's wrangler config names them. */
export const seedBindings = ["READ_DB", "SCAN_DB", "MARKET_DB"] as const

/** Environments a seed command may name: the API's own READ_DB history. */
export const seedEnvironments = ["v2preview"] as const

/** Variables wrangler reads to reach an account. Never passed on. */
export const credentialVariables = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_EMAIL",
  "CLOUDFLARE_ACCOUNT_ID",
  "CF_API_TOKEN",
  "CF_API_KEY",
  "CF_EMAIL",
  "CF_ACCOUNT_ID",
] as const

const productionName = /prod/i

export class LocalSeedRefusal extends Error {
  override name = "LocalSeedRefusal"
}

function refuse(message: string): never {
  throw new LocalSeedRefusal(message)
}

/** The API's local wrangler state: `<apiDir>/.wrangler/state`. */
export function localStateDir(apiDir: string): string {
  return path.join(apiDir, ".wrangler", "state")
}

/** Refuses any command-line argument. */
export function assertNoArguments(args: readonly string[]): void {
  if (args.length > 0) {
    refuse(`takes no arguments (got ${args.join(" ")})`)
  }
}

/**
 * Refuses an environment that selects a wrangler environment for it
 * (`CLOUDFLARE_ENV`) or says it is production.
 */
export function assertLocalEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): void {
  const selected = env.CLOUDFLARE_ENV
  if (selected !== undefined && selected !== "") {
    refuse(`CLOUDFLARE_ENV is set (${selected}); unset it to seed`)
  }
  for (const name of ["ENVIRONMENT", "NODE_ENV"] as const) {
    const value = env[name]
    if (value !== undefined && productionName.test(value)) {
      refuse(`${name} is ${value}; the seed writes local state only`)
    }
  }
}

/** The child environment for wrangler: no credentials, never interactive. */
export function childEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const child: Record<string, string | undefined> = { ...env, CI: "true" }
  for (const name of credentialVariables) delete child[name]
  return child
}

/**
 * The arguments of one `wrangler d1 migrations apply` against local state.
 * Throws for a binding or environment it does not know, or a state
 * directory outside the API's.
 */
export function migrateArgs(input: {
  binding: string
  environment?: string | undefined
  apiDir: string
  persistTo: string
}): string[] {
  const { binding, environment, apiDir, persistTo } = input
  if (!(seedBindings as readonly string[]).includes(binding)) {
    refuse(`unknown binding ${binding}`)
  }
  if (environment !== undefined) {
    if (
      productionName.test(environment) ||
      !(seedEnvironments as readonly string[]).includes(environment)
    ) {
      refuse(`refusing environment ${environment}`)
    }
  }
  const stateDir = localStateDir(apiDir)
  if (path.resolve(persistTo) !== path.resolve(stateDir)) {
    refuse(`refusing state outside ${stateDir}: ${persistTo}`)
  }
  const args = ["d1", "migrations", "apply", binding, "--local"]
  if (environment !== undefined) args.push("--env", environment)
  args.push("--persist-to", stateDir)
  assertLocalArgs(args)
  return args
}

/** Refuses a wrangler command that is not local. */
export function assertLocalArgs(args: readonly string[]): void {
  if (!args.includes("--local")) {
    refuse(`refusing a wrangler command without --local: ${args.join(" ")}`)
  }
  // Flags only: the state path may hold any word.
  if (args.some((arg) => arg.startsWith("-") && /remote/i.test(arg))) {
    refuse(`refusing a remote wrangler command: ${args.join(" ")}`)
  }
}
