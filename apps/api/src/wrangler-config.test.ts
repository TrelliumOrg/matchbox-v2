import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { z } from "zod"

// Every D1 database and KV namespace bound in apps/api's wrangler configs
// must name a real resource. A placeholder id makes every deploy of the
// Worker fail, including the v2preview environment live Pro binds to, so a
// binding to a resource that does not exist yet stays out of the config
// (README, "Creating the database") until a human has created it.

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
    } else if (char === '"') {
      inString = true
      out += char
      index += 1
    } else if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1
    } else if (char === "/" && next === "*") {
      index = text.indexOf("*/", index + 2)
      index = index === -1 ? text.length : index + 2
    } else {
      out += char
      index += 1
    }
  }
  // Trailing commas are allowed in JSONC.
  return out.replace(/,(\s*[}\]])/g, "$1")
}

const bindingSchema = z.object({
  d1_databases: z
    .array(z.object({ binding: z.string(), database_id: z.string() }))
    .optional(),
  kv_namespaces: z
    .array(z.object({ binding: z.string(), id: z.string() }))
    .optional(),
})

const configSchema = bindingSchema.extend({
  env: z.record(z.string(), bindingSchema).optional(),
})

type Bound = { file: string; where: string; binding: string; id: string }

function boundResources(file: string): Bound[] {
  const raw: unknown = JSON.parse(
    stripComments(readFileSync(path.join(appRoot, file), "utf8")),
  )
  const config = configSchema.parse(raw)
  const sections: [string, z.infer<typeof bindingSchema>][] = [
    ["default", config],
    ...Object.entries(config.env ?? {}),
  ]
  return sections.flatMap(([where, section]) => [
    ...(section.d1_databases ?? []).map((entry) => ({
      file,
      where,
      binding: entry.binding,
      id: entry.database_id,
    })),
    ...(section.kv_namespaces ?? []).map((entry) => ({
      file,
      where,
      binding: entry.binding,
      id: entry.id,
    })),
  ])
}

/** A D1 id is a UUID, a KV id 32 hex digits; neither may be all zeros. */
function isRealResourceId(id: string): boolean {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const hex32 = /^[0-9a-f]{32}$/i
  if (!uuid.test(id) && !hex32.test(id)) return false
  return /[1-9a-f]/i.test(id.replace(/-/g, ""))
}

const configFiles = readdirSync(appRoot).filter((name) =>
  /^wrangler.*\.jsonc?$/.test(name),
)

describe("wrangler configs", () => {
  it("are found", () => {
    expect(configFiles).toContain("wrangler.jsonc")
  })

  it("bind only real D1 databases and KV namespaces", () => {
    const bound = configFiles.flatMap(boundResources)
    expect(bound.length).toBeGreaterThan(0)
    const placeholders = bound.filter((entry) => !isRealResourceId(entry.id))
    expect(placeholders).toEqual([])
  })

  it("recognises placeholder ids", () => {
    for (const id of [
      "00000000-0000-0000-0000-000000000000",
      "00000000000000000000000000000000",
      "replace-me",
      "<database-id>",
      "",
    ]) {
      expect(isRealResourceId(id), id).toBe(false)
    }
    expect(isRealResourceId("abe98edf-ff3c-4ac6-b974-6edf4294089a")).toBe(true)
    expect(isRealResourceId("bc89cdb653554c42af1b04d91d2b23d0")).toBe(true)
  })

  it("strips comments without touching strings", () => {
    expect(
      JSON.parse(
        stripComments('{ "a": "x // not a comment", /* b */ "c": 1, }'),
      ),
    ).toEqual({ a: "x // not a comment", c: 1 })
  })
})
