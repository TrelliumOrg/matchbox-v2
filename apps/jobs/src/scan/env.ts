import { z } from "zod"

// The scan bindings, validated apart from the jobs env so a Worker without
// them (SCAN_DB not created yet) keeps running every other job.

/** The API Worker's InternalApi entrypoint, bound as API. */
export type ApiBinding = { fetch(request: Request): Promise<Response> }

function hasFunctions(value: unknown, names: readonly string[]): boolean {
  if (typeof value !== "object" || value === null) return false
  return names.every((name) => typeof Reflect.get(value, name) === "function")
}

const scanDbSchema = z.custom<D1Database>((value) =>
  hasFunctions(value, ["prepare", "batch"]),
)
const apiSchema = z.custom<ApiBinding>((value) =>
  hasFunctions(value, ["fetch"]),
)

/** The bindings env as an object; anything else has none. */
const bindingsSchema = z.looseObject({
  /** matchbox-scan D1. Absent: every scan step is skipped. */
  SCAN_DB: z.unknown(),
  /** The API Worker's InternalApi entrypoint (the Blockscout proxy). */
  API: z.unknown(),
})

export type ScanEnv = { scanDb: D1Database | null; api: ApiBinding | null }

/** Each binding is checked on its own: a bad API binding keeps SCAN_DB. */
export function parseScanEnv(raw: unknown): ScanEnv {
  const bindings = bindingsSchema.safeParse(raw)
  if (!bindings.success) return { scanDb: null, api: null }
  const scanDb = scanDbSchema.safeParse(bindings.data.SCAN_DB)
  const api = apiSchema.safeParse(bindings.data.API)
  return {
    scanDb: scanDb.success ? scanDb.data : null,
    api: api.success ? api.data : null,
  }
}
