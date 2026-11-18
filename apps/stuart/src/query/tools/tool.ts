import { z } from "zod"
import type { StuartContext } from "../context"
import type { IdScope, ToolOutcome } from "../outcome"

export type ToolContext = StuartContext & { scope: IdScope }

export type ToolFamily =
  | "entity"
  | "votes"
  | "rewards"
  | "loans"
  | "earn"
  | "activity"
  | "support"
  | "protocol"
  | "knowledge"

// Operational status shown while a tool runs ("Reading gauges"), never
// model reasoning.
const FAMILY_STATUS: Record<ToolFamily, string> = {
  entity: "Resolving names",
  votes: "Reading gauges and votes",
  rewards: "Reading rewards",
  loans: "Reading the trove",
  earn: "Quoting the route",
  activity: "Searching transfers",
  support: "Drafting the report",
  protocol: "Reading protocol totals",
  knowledge: "Reading Mezo docs",
}

export type RegisteredTool = {
  name: string
  family: ToolFamily
  status: string
  description: string
  inputSchema: z.ZodType
  /** Always sent without `strict`, whatever the budgets leave. */
  loose: boolean
  execute: (
    context: ToolContext,
    raw: unknown,
  ) => Promise<ToolOutcome | { invalid: string }>
}

/**
 * A Stuart tool. `input` is the model-visible schema: host-injected values
 * (wallet address, mode, chain) are never arguments, and every property is
 * required (nullable where optional) so `strict: true` holds.
 */
export function defineTool<I>(definition: {
  name: string
  family: ToolFamily
  description: string
  input: z.ZodType<I>
  /**
   * Keep this tool out of the strict set: its schema stays out of the
   * compiled grammar budget (claude.ts) and the pinned strict list.
   */
  loose?: boolean
  run: (context: ToolContext, input: I) => Promise<ToolOutcome>
}): RegisteredTool {
  return {
    name: definition.name,
    family: definition.family,
    status: FAMILY_STATUS[definition.family],
    description: definition.description,
    inputSchema: definition.input,
    loose: definition.loose === true,
    async execute(context, raw) {
      const parsed = definition.input.safeParse(raw)
      if (!parsed.success) {
        return {
          invalid: parsed.error.issues
            .map(
              (issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
            )
            .join(". ")
            .slice(0, 300),
        }
      }
      const outcome = await definition.run(context, parsed.data)
      // A null subject is the selected wallet: one subject like any other.
      const subject = (parsed.data as { subject?: unknown }).subject
      if (outcome.subject !== undefined) return outcome
      if (subject === null) return { ...outcome, subject: "" }
      return typeof subject === "string" ? { ...outcome, subject } : outcome
    },
  }
}

// JSON Schema keywords strict tool use does not accept. Zod constraints are
// still enforced server-side when the call is validated.
const UNSUPPORTED_KEYWORDS = new Set([
  "$schema",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
  "format",
  "default",
])

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
)

function sanitize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sanitize)
  if (value === null || typeof value !== "object") return value
  const result: { [key: string]: JsonValue } = {}
  for (const [key, item] of Object.entries(value)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue
    result[key] = sanitize(item)
  }
  if (result.type === "object") {
    const properties = result.properties
    result.additionalProperties = false
    if (
      properties &&
      typeof properties === "object" &&
      !Array.isArray(properties)
    ) {
      result.required = Object.keys(properties)
    }
  }
  return result
}

export type ToolJsonSchema = { [key: string]: JsonValue }

/** Deterministic, strict-mode JSON Schema for a model-visible input. */
export function toolJsonSchema(schema: z.ZodType): ToolJsonSchema {
  const raw = jsonValueSchema.parse(z.toJSONSchema(schema, { io: "input" }))
  const clean = sanitize(raw)
  if (clean === null || typeof clean !== "object" || Array.isArray(clean)) {
    return {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    }
  }
  return clean
}
