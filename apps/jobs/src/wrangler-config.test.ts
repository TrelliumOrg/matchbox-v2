import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { z } from "zod"

// Every D1 database and KV namespace bound in the deploy config
// (wrangler.jsonc) must name a real resource: a placeholder id makes every
// deploy of this Worker fail, including an unrelated Pro fix. A binding to a
// resource that does not exist yet stays out of the config until a human
// has created it (README, "SCAN_DB schema"). wrangler.scan-local.jsonc is
// local only and not checked.

const appRoot = path.join(import.meta.dirname, "..")

/** JSONC to JSON: drops line and block comments outside strings. */
function stripComments(text: string): string {
  let out = ""
  let index = 0
  let inString = false
  while (index < text.length) {
    const char = text[index] ?? ""
    const next = text[index + 1] ?? ""
    if (inString) {
      out += char
      if (char === "\\") {
        out += next
        index += 2
        continue
      }
      if (char === '"') inString = false
      index += 1
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      index += 1
    } else if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1
    } else if (char === "/" && next === "*") {
      index += 2
      while (
        index < text.length &&
        !(text[index] === "*" && text[index + 1] === "/")
      ) {
        index += 1
      }
      index += 2
    } else {
      out += char
      index += 1
    }
  }
  // Trailing commas are allowed in JSONC.
  return out.replace(/,(\s*[}\]])/g, "$1")
}

const configSchema = z.looseObject({
  d1_databases: z
    .array(
      z.looseObject({
        binding: z.string(),
        database_name: z.string(),
        database_id: z.string(),
      }),
    )
    .default([]),
  kv_namespaces: z
    .array(z.looseObject({ binding: z.string(), id: z.string() }))
    .default([]),
})

/** A D1 id must be a UUID that is not all zeros. */
function isRealD1Id(id: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) &&
    /[1-9a-f]/.test(id)
  )
}

function parse(text: string) {
  const parsed: unknown = JSON.parse(stripComments(text))
  return configSchema.parse(parsed)
}

describe("deploy config (wrangler.jsonc)", () => {
  const config = parse(
    readFileSync(path.join(appRoot, "wrangler.jsonc"), "utf8"),
  )

  it("binds only D1 databases with a real id", () => {
    for (const database of config.d1_databases) {
      expect(isRealD1Id(database.database_id), database.binding).toBe(true)
    }
  })

  it("binds only KV namespaces with a real id", () => {
    for (const namespace of config.kv_namespaces) {
      expect(/^[0-9a-f]{32}$/.test(namespace.id), namespace.binding).toBe(true)
      expect(/[1-9a-f]/.test(namespace.id), namespace.binding).toBe(true)
    }
  })

  it("rejects the placeholder and all-zero ids", () => {
    expect(isRealD1Id("00000000-0000-0000-0000-000000000000")).toBe(false)
    expect(isRealD1Id("<your-database-id>")).toBe(false)
    expect(isRealD1Id("abe98edf-ff3c-4ac6-b974-6edf4294089a")).toBe(true)
    const placeholder = parse(`{
      // a comment with "quotes" and // slashes
      "d1_databases": [
        { "binding": "SCAN_DB", "database_name": "matchbox-scan",
          "database_id": "00000000-0000-0000-0000-000000000000" },
      ],
    }`)
    expect(
      placeholder.d1_databases.every((database) =>
        isRealD1Id(database.database_id),
      ),
    ).toBe(false)
  })
})
