import { z } from "zod"

// Which database a script connects to, and where that came from. No side
// effects, so tests can import it; scripts/database.ts loads the local env
// files and records which file set each variable.

// Tried in this order; the first one set wins.
export const DIRECT_DATABASE_VARIABLES = [
  "MATCHBOX_DATABASE_URL_UNPOOLED",
  "DATABASE_URL_UNPOOLED",
  "MATCHBOX_DATABASE_URL",
  "DATABASE_URL",
] as const

const postgresUrlSchema = z
  .url()
  .refine(
    (value) =>
      value.startsWith("postgres://") || value.startsWith("postgresql://"),
    "Expected a PostgreSQL connection string",
  )

export type DatabaseTarget = {
  url: string
  // Host only: safe to print. Never print url.
  host: string
  variable: (typeof DIRECT_DATABASE_VARIABLES)[number]
  // "the shell", or the local file that set the variable.
  origin: string
}

export function resolveDirectDatabase(
  env: Readonly<Record<string, string | undefined>>,
  origins: ReadonlyMap<string, string>,
): DatabaseTarget {
  const variable = DIRECT_DATABASE_VARIABLES.find(
    (name) => env[name] !== undefined,
  )
  const databaseUrl = postgresUrlSchema.parse(
    variable === undefined ? undefined : env[variable],
  )
  const host = new URL(databaseUrl).hostname

  if (host.includes("-pooler")) {
    throw new Error(
      "Migrations and role setup require a direct Neon URL, not a pooled endpoint.",
    )
  }

  const normalizedUrl = new URL(databaseUrl)
  if (normalizedUrl.searchParams.get("sslmode") === "require") {
    normalizedUrl.searchParams.set("sslmode", "verify-full")
  }

  return {
    url: normalizedUrl.toString(),
    host,
    // A URL parsed, so one of them was set.
    variable: variable as DatabaseTarget["variable"],
    origin: origins.get(variable as string) ?? "the shell",
  }
}

// A write must name the host it expects, so a variable from a local file
// cannot quietly send it to another database.
export function checkExpectedHost(
  target: Pick<DatabaseTarget, "host" | "variable" | "origin">,
  expectHost: string | undefined,
  apply: boolean,
): void {
  const where = `${target.host} (${target.variable}, from ${target.origin})`
  if (expectHost === undefined) {
    if (apply) {
      throw new Error(
        `--apply needs --expect-host <host>. This run would write to ${where}; if that is the database you mean, pass --expect-host ${target.host}.`,
      )
    }
    return
  }
  if (expectHost.trim().toLowerCase() !== target.host.toLowerCase()) {
    throw new Error(
      `--expect-host is ${expectHost}, but the database is ${where}. Nothing was read or written.`,
    )
  }
}
