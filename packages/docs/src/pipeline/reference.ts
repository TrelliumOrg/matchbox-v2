import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { errorCodeSchema } from "@matchbox/contracts/errors"
import type { operations } from "@matchbox-dev/sdk"
import { z } from "zod"
import type {
  DocCode,
  DocNode,
  OperationDoc,
  OperationParameter,
  OperationStatus,
  ReferenceIndexDoc,
  SchemaField,
} from "../render-types"
import {
  type GeneratedPage,
  type GeneratedTree,
  previewText,
} from "./build-site"
import { codeLanguage, highlight } from "./highlight"
import { inlineText } from "./markdown"

/**
 * The API reference, generated at build time from
 * packages/contracts/openapi.json (read in place, never copied): the index
 * and one page per operation, with parameters, headers, the response schema
 * tree, status codes linked to the errors page, and TypeScript and curl
 * samples. The TypeScript samples are also written to src/samples.gen.ts
 * and compiled against @matchbox-dev/sdk, so a renamed SDK method fails the
 * typecheck rather than shipping a broken sample.
 */

const require = createRequire(import.meta.url)

const schemaObject: z.ZodType<JsonSchema> = z.lazy(() =>
  z
    .object({
      $ref: z.string().optional(),
      type: z.union([z.string(), z.array(z.string())]).optional(),
      enum: z.array(z.unknown()).optional(),
      const: z.unknown().optional(),
      description: z.string().optional(),
      properties: z.record(z.string(), schemaObject).optional(),
      required: z.array(z.string()).optional(),
      items: schemaObject.optional(),
      anyOf: z.array(schemaObject).optional(),
      oneOf: z.array(schemaObject).optional(),
      allOf: z.array(schemaObject).optional(),
      default: z.unknown().optional(),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
      minItems: z.number().optional(),
      maxItems: z.number().optional(),
      pattern: z.string().optional(),
      format: z.string().optional(),
    })
    .passthrough(),
)

export type JsonSchema = {
  $ref?: string | undefined
  type?: string | string[] | undefined
  enum?: unknown[] | undefined
  const?: unknown
  description?: string | undefined
  properties?: Record<string, JsonSchema> | undefined
  required?: string[] | undefined
  items?: JsonSchema | undefined
  anyOf?: JsonSchema[] | undefined
  oneOf?: JsonSchema[] | undefined
  allOf?: JsonSchema[] | undefined
  default?: unknown
  minimum?: number | undefined
  maximum?: number | undefined
  minItems?: number | undefined
  maxItems?: number | undefined
  pattern?: string | undefined
  format?: string | undefined
}

const parameterSchema = z.object({
  name: z.string(),
  in: z.enum(["path", "query", "header", "cookie"]),
  required: z.boolean().optional(),
  description: z.string().optional(),
  schema: schemaObject,
})

const responseSchema = z.object({
  $ref: z.string().optional(),
  description: z.string().optional(),
  content: z.record(z.string(), z.object({ schema: schemaObject })).optional(),
})

const operationSchema = z.object({
  operationId: z.string(),
  tags: z.array(z.string()).min(1),
  summary: z.string(),
  description: z.string().optional(),
  parameters: z.array(parameterSchema).default([]),
  responses: z.record(z.string(), responseSchema),
  security: z.array(z.record(z.string(), z.array(z.string()))).optional(),
  "x-matchbox-since": z.string().optional(),
})

const documentSchema = z.object({
  openapi: z.string(),
  info: z.object({ version: z.string(), title: z.string() }),
  servers: z.array(z.object({ url: z.string() })).min(1),
  tags: z.array(z.object({ name: z.string() })),
  paths: z.record(z.string(), z.record(z.string(), operationSchema)),
  security: z.array(z.record(z.string(), z.array(z.string()))).optional(),
  components: z.object({
    schemas: z.record(z.string(), schemaObject),
    responses: z.record(z.string(), responseSchema).default({}),
  }),
})

export type OpenApiDocument = z.infer<typeof documentSchema>

export function readOpenApi(): { text: string; document: OpenApiDocument } {
  const file = require.resolve("@matchbox/contracts/openapi.json")
  const text = readFileSync(file, "utf8")
  const raw: unknown = JSON.parse(text)
  return { text, document: documentSchema.parse(raw) }
}

/**
 * The docs voice in generated text: a semicolon becomes a full stop. The
 * source wording lives in @matchbox/contracts and keeps its own style.
 */
export function docsVoice(text: string): string {
  return text.replace(
    /;\s+(\S)/g,
    (_match, next: string) => `. ${next.toUpperCase()}`,
  )
}

function refName(ref: string): string {
  return ref.split("/").at(-1) ?? ref
}

function resolve(document: OpenApiDocument, schema: JsonSchema): JsonSchema {
  if (schema.$ref === undefined) return schema
  const target = document.components.schemas[refName(schema.$ref)]
  if (target === undefined) throw new Error(`Unknown schema ${schema.$ref}`)
  return resolve(document, target)
}

const friendlyNames: Record<string, string> = {
  Address: "address",
  DecimalString: "decimal string",
  FixedDecimal: "decimal",
  NetworkSlug: "string",
}

/** A short type label: "string", "array of Reward", "decimal or null". */
export function typeLabel(
  document: OpenApiDocument,
  schema: JsonSchema,
): string {
  if (schema.$ref !== undefined) {
    const name = refName(schema.$ref)
    const friendly = friendlyNames[name]
    if (friendly !== undefined) return friendly
    const target = resolve(document, schema)
    if (target.enum !== undefined) return "string"
    return name
  }
  const variants = schema.anyOf ?? schema.oneOf
  if (variants !== undefined) {
    const labels = [
      ...new Set(variants.map((variant) => typeLabel(document, variant))),
    ]
    const nonNull = labels.filter((label) => label !== "null")
    const withNull = labels.length !== nonNull.length
    const base = nonNull.join(" or ")
    return withNull ? `${base} or null` : base
  }
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((type) => type !== "null")
    const label = types.join(" or ")
    return schema.type.includes("null") ? `${label} or null` : label
  }
  if (schema.type === "array" && schema.items !== undefined) {
    return `array of ${typeLabel(document, schema.items)}`
  }
  if (schema.const !== undefined) return JSON.stringify(schema.const)
  return schema.type ?? "object"
}

function enumValues(document: OpenApiDocument, schema: JsonSchema): string[] {
  const target = resolve(document, schema)
  if (target.enum !== undefined)
    return target.enum.map((value) => String(value))
  const variants = target.anyOf ?? target.oneOf
  if (variants !== undefined) {
    return variants.flatMap((variant) => enumValues(document, variant))
  }
  if (target.type === "array" && target.items !== undefined) {
    return enumValues(document, target.items)
  }
  return []
}

/** The object a field expands into, if any. */
function expandable(
  document: OpenApiDocument,
  schema: JsonSchema,
): JsonSchema[] {
  const target = resolve(document, schema)
  if (target.properties !== undefined) return [target]
  if (target.type === "array" && target.items !== undefined) {
    return expandable(document, target.items)
  }
  const variants = target.anyOf ?? target.oneOf
  if (variants !== undefined) {
    return variants
      .filter((variant) => !(variant.type === "null"))
      .flatMap((variant) => {
        const inner = resolve(document, variant)
        if (inner.properties !== undefined) return [variant]
        return expandable(document, variant)
      })
  }
  return []
}

export function schemaFields(
  document: OpenApiDocument,
  schema: JsonSchema,
  depth = 0,
  seen: readonly string[] = [],
): SchemaField[] {
  const target = resolve(document, schema)
  const required = new Set(target.required ?? [])
  return Object.entries(target.properties ?? {}).map(([name, property]) => {
    const objects = expandable(document, property)
    let children: SchemaField[] = []
    if (depth < 4) {
      if (objects.length === 1) {
        const [only] = objects
        const ref = only?.$ref
        if (only !== undefined && (ref === undefined || !seen.includes(ref))) {
          children = schemaFields(
            document,
            only,
            depth + 1,
            ref === undefined ? seen : [...seen, ref],
          )
        }
      } else if (objects.length > 1) {
        // A union of objects: one group per variant, named by its schema.
        children = objects.map((variant) => ({
          name: variant.$ref === undefined ? "variant" : refName(variant.$ref),
          type: "variant",
          required: false,
          description: docsVoice(resolve(document, variant).description ?? ""),
          values: [],
          children: schemaFields(document, variant, depth + 1, seen),
        }))
      }
    }
    const description =
      property.description ?? resolve(document, property).description ?? ""
    return {
      name,
      type: typeLabel(document, property),
      required: required.has(name),
      description: docsVoice(description),
      values: enumValues(document, property),
      children,
    }
  })
}

/**
 * A response description without the error codes, which the page links
 * on their own: "`not_found`." says nothing more, so it becomes empty
 * rather than a stray full stop, and what is left starts a sentence.
 */
export function statusText(description: string): string {
  const rest = description
    .replace(/`[a-z_]+`(, |,? or |: )?/g, "")
    .replace(/^[:,.\s]+/, "")
    .trim()
  if (rest === "") return ""
  return docsVoice(`${rest.charAt(0).toUpperCase()}${rest.slice(1)}`)
}

/** Error codes a response description names in backticks. */
function errorCodesIn(text: string): string[] {
  const codes: string[] = []
  for (const match of text.matchAll(/`([a-z_]+)`/g)) {
    const code = match[1] ?? ""
    if (errorCodeSchema.options.some((option) => option === code))
      codes.push(code)
  }
  return codes
}

export type OperationId = keyof operations

/**
 * The SDK call for each operation, or null where the SDK has no method
 * and the sample uses fetch. Keyed by the SDK's own operation ids, so an
 * operation added to the API without a sample fails the typecheck.
 */
const sdkCalls: Record<OperationId, { code: string; setup?: string } | null> = {
  getHealth: null,
  listNetworks: { code: "await matchbox.networks.list()" },
  listGaugeProfiles: {
    code: 'await matchbox.gaugeProfiles.list({ network: "mezo", limit: 20 })',
  },
  getGaugeProfile: {
    setup: 'const gaugeAddress = "0x…" // a gauge address, from gauges.list',
    code: 'await matchbox.gaugeProfiles.get("mezo", gaugeAddress)',
  },
  getGaugeProfileByVebtc: {
    setup: "const tokenId = 1n // your veBTC token id",
    code: 'await matchbox.gaugeProfiles.byVebtc("mezo", tokenId)',
  },
  getCurrentEpoch: { code: "await matchbox.epochs.current()" },
  listGauges: {
    code: 'await matchbox.gauges.list({ network: "mezo", voter: "boost" })',
  },
  getGauge: {
    setup: 'const gaugeAddress = "0x…" // a gauge address, from gauges.list',
    code: 'await matchbox.gauges.get("mezo", gaugeAddress)',
  },
  listGaugeEpochs: {
    setup: 'const gaugeAddress = "0x…" // a gauge address, from gauges.list',
    code: 'await matchbox.gauges.epochs("mezo", gaugeAddress, { limit: 12 })',
  },
  getGaugeByVebtc: {
    setup: "const tokenId = 1n // your veBTC token id",
    code: 'await matchbox.gauges.byVebtc("mezo", tokenId)',
  },
  listIncentives: {
    code: 'await matchbox.incentives.list({ network: "mezo", epoch: "current" })',
  },
}

/** Placeholder values for path parameters in curl samples. */
const curlPlaceholders: Record<string, string> = {
  network: "mezo",
  gaugeAddress: "$GAUGE_ADDRESS",
  tokenId: "$TOKEN_ID",
}

const curlQuery: Partial<Record<OperationId, string>> = {
  listGaugeProfiles: "?network=mezo&limit=20",
  listGauges: "?network=mezo&voter=boost",
  listGaugeEpochs: "?limit=12",
  listIncentives: "?network=mezo&epoch=current",
}

export type TypeScriptSample = { id: string; source: string }

/** Splits a sample into its leading imports and the rest. */
export function splitImports(source: string): {
  imports: string[]
  body: string
} {
  const lines = source.split("\n")
  const imports: string[] = []
  let index = 0
  while (index < lines.length && /^import\s/.test(lines[index] ?? "")) {
    let statement = lines[index] ?? ""
    while (!/from\s+"[^"]+"\s*$/.test(statement) && index + 1 < lines.length) {
      index += 1
      statement += `\n${lines[index] ?? ""}`
    }
    imports.push(statement)
    index += 1
  }
  while (lines[index] === "") index += 1
  return { imports, body: lines.slice(index).join("\n") }
}

/**
 * src/samples.gen.ts: every TypeScript sample as an async function, with
 * the imports hoisted. Compiled by the package typecheck.
 */
export function samplesModule(samples: readonly TypeScriptSample[]): string {
  const imports = new Map<string, Set<string>>()
  const bodies: string[] = []
  for (const sample of samples) {
    const { imports: own, body } = splitImports(sample.source)
    for (const statement of own) {
      const match = /import\s*\{([\s\S]+)\}\s*from\s*"([^"]+)"/.exec(statement)
      if (match === null)
        throw new Error(`${sample.id}: use named imports in samples`)
      const names = imports.get(match[2] ?? "") ?? new Set<string>()
      for (const name of (match[1] ?? "").split(",")) {
        const trimmed = name.trim()
        if (trimmed !== "") names.add(trimmed)
      }
      imports.set(match[2] ?? "", names)
    }
    const indented = body
      .split("\n")
      .map((line) => (line === "" ? "" : `  ${line}`))
      .join("\n")
    const name = sample.id.replace(/[^A-Za-z0-9]+/g, "_")
    bodies.push(
      `/** ${sample.id} */\nexport async function ${name}(): Promise<unknown> {\n${indented}\n  return undefined\n}\n`,
    )
  }
  const head = [...imports.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([from, names]) =>
        `import { ${[...names].sort().join(", ")} } from "${from}"`,
    )
  return [
    "// Generated by packages/docs/scripts/build.ts from the docs' TypeScript",
    "// samples. Do not edit: run `pnpm --filter @matchbox/docs generate`.",
    "// The typecheck compiles every sample against @matchbox-dev/sdk.",
    "/* eslint-disable */",
    ...head,
    "",
    ...bodies,
  ].join("\n")
}

async function code(
  lang: string,
  title: string,
  source: string,
): Promise<DocCode> {
  const language = codeLanguage(lang)
  return {
    t: "pre",
    p: { lang: language, title, source },
    lines: await highlight(source, language),
  }
}

/** "/v1/gauges/{network}/{gaugeAddress}" to "gauges/get-a-gauge" pieces. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

export function operationPath(tag: string, operationId: string): string {
  const words = operationId.replace(/([A-Z])/g, " $1")
  return `/developer/api/${slugify(tag)}/${slugify(words)}`
}

/**
 * The anchors the Classic console's reference used
 * (`#get-v1-gauges-network-gaugeaddress`), mapped to the new pages for
 * the redirect script on /developer/reference.
 */
export function legacyAnchor(method: string, path: string): string {
  return slugify(`${method} ${path}`)
}

export type ReferenceOutput = {
  version: string
  document: string
  pages: GeneratedPage[]
  tree: GeneratedTree
  samples: TypeScriptSample[]
  legacyAnchors: Record<string, string>
  operations: {
    id: string
    method: string
    path: string
    href: string
    summary: string
    tag: string
  }[]
}

export async function generateReference(): Promise<ReferenceOutput> {
  const { text, document } = readOpenApi()
  const baseUrl = document.servers[0]?.url ?? ""
  const operations: ReferenceOutput["operations"] = []
  const pages: GeneratedPage[] = []
  const samples: TypeScriptSample[] = []
  const legacyAnchors: Record<string, string> = {}
  const ids = new Set<string>()

  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [methodKey, operation] of Object.entries(methods)) {
      const method = methodKey.toUpperCase() as OperationDoc["method"]
      const tag = operation.tags[0] ?? "Other"
      const href = operationPath(tag, operation.operationId)
      if (ids.has(operation.operationId))
        throw new Error(`Duplicate ${operation.operationId}`)
      ids.add(operation.operationId)
      operations.push({
        id: operation.operationId,
        method,
        path,
        href,
        summary: operation.summary,
        tag,
      })
      legacyAnchors[legacyAnchor(method, path)] = href
    }
  }

  const known = new Set<string>(Object.keys(sdkCalls))
  for (const operation of operations) {
    if (!known.has(operation.id)) {
      throw new Error(`${operation.id} has no sample: add it to sdkCalls`)
    }
  }

  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [methodKey, operation] of Object.entries(methods)) {
      const method = methodKey.toUpperCase() as OperationDoc["method"]
      const tag = operation.tags[0] ?? "Other"
      const href = operationPath(tag, operation.operationId)
      const authenticated =
        (operation.security ?? document.security ?? [{}]).some(
          (entry) => Object.keys(entry).length > 0,
        ) && operation.security?.length !== 0
      const parameter = (
        input: z.infer<typeof parameterSchema>,
      ): OperationParameter => ({
        name: input.name,
        in: input.in === "cookie" ? "header" : input.in,
        type: typeLabel(document, input.schema),
        required: input.required ?? false,
        description: docsVoice(
          input.description ??
            resolve(document, input.schema).description ??
            "",
        ),
        values: enumValues(document, input.schema),
      })
      const parameters = operation.parameters
        .filter((item) => item.in === "path" || item.in === "query")
        .map(parameter)
      const headers = operation.parameters
        .filter((item) => item.in === "header")
        .map(parameter)
      const ok = operation.responses["200"]
      const okSchema = ok?.content?.["application/json"]?.schema
      const statuses: OperationStatus[] = Object.entries(
        operation.responses,
      ).map(([status, response]) => {
        const resolved =
          response.$ref === undefined
            ? response
            : document.components.responses[refName(response.$ref)]
        const description = resolved?.description ?? ""
        const errors = errorCodesIn(description)
        return {
          code: status,
          description: statusText(description),
          errors,
        }
      })

      const call = sdkCalls[operation.operationId as OperationId]
      const url = `${baseUrl}${path.replace(/\{(\w+)\}/g, (_match, name: string) => curlPlaceholders[name] ?? `$${name.toUpperCase()}`)}${curlQuery[operation.operationId as OperationId] ?? ""}`
      const tsSource =
        call === null
          ? [
              `const response = await fetch("${baseUrl}${path}")`,
              "const body = await response.json()",
              "console.log(body)",
            ].join("\n")
          : [
              'import { createMatchboxClient } from "@matchbox-dev/sdk"',
              "",
              "const matchbox = createMatchboxClient({",
              '  apiKey: process.env.MATCHBOX_API_KEY ?? "",',
              "})",
              ...(call.setup === undefined ? [] : [call.setup]),
              `const result = ${call.code}`,
              "console.log(result)",
            ].join("\n")
      samples.push({ id: `api ${operation.operationId}`, source: tsSource })
      const curl = authenticated
        ? `curl "${url}" \\\n  -H "Authorization: Bearer $MATCHBOX_API_KEY"`
        : `curl "${url}"`

      const description = operation.description ?? ""
      const doc: OperationDoc = {
        id: operation.operationId,
        tag,
        method,
        path,
        summary: operation.summary,
        description: description
          .split(/\n{2,}/)
          .map((part) => part.trim())
          .filter((part) => part !== "")
          .map(
            (part) =>
              ({ t: "p", c: inlineText(docsVoice(part)) }) satisfies DocNode,
          ),
        auth: authenticated ? "API key" : "None",
        since: operation["x-matchbox-since"] ?? null,
        parameters,
        headers,
        response:
          okSchema === undefined
            ? null
            : {
                status: "200",
                contentType: "application/json",
                fields: schemaFields(document, okSchema),
              },
        statuses,
        samples: [
          await code("ts", "TypeScript", tsSource),
          await code("bash", "curl", curl),
        ],
        examples: [],
      }
      const anchors = ["parameters", "headers", "response", "status-codes"]
      const errorLinks = statuses.flatMap((status) =>
        status.errors.map((error) => `/developer/errors#${error}`),
      )
      const firstParagraph = docsVoice(description.split(/\n{2,}/)[0] ?? "")
      pages.push({
        path: href,
        title: operation.summary,
        nav: operation.summary,
        description: `${method} ${path}`,
        lead: previewText(
          `${method} ${path} in the Matchbox API. ${firstParagraph}`,
        ),
        section: "developer",
        eyebrow: tag,
        tree: "api",
        method,
        body: { kind: "operation", operation: doc },
        toc: [
          ...(parameters.length > 0
            ? [{ id: "parameters", text: "Parameters", depth: 2 as const }]
            : []),
          ...(headers.length > 0
            ? [{ id: "headers", text: "Headers", depth: 2 as const }]
            : []),
          ...(doc.response === null
            ? []
            : [{ id: "response", text: "Response", depth: 2 as const }]),
          { id: "status-codes", text: "Status codes", depth: 2 as const },
        ],
        ids: anchors,
        links: errorLinks,
        sections: [
          {
            id: null,
            heading: operation.summary,
            text: [
              `${method} ${path}`,
              description,
              ...parameters.map((item) => `${item.name} ${item.description}`),
              ...(doc.response?.fields ?? []).map(
                (field) => `${field.name} ${field.description}`,
              ),
            ].join(" "),
          },
        ],
        markdown: [
          `# ${operation.summary}`,
          "",
          `\`${method} ${path}\``,
          "",
          docsVoice(description),
          "",
          "## Parameters",
          "",
          ...[...parameters, ...headers].map(
            (item) =>
              `- \`${item.name}\` (${item.in}, ${item.type}${item.required ? ", required" : ""}): ${item.description}`,
          ),
          "",
          "## Status codes",
          "",
          ...statuses.map((status) =>
            `- ${status.code}: ${status.description} ${status.errors.map((error) => `\`${error}\``).join(", ")}`.trimEnd(),
          ),
          "",
          "```ts",
          tsSource,
          "```",
          "",
        ].join("\n"),
        kind: "operation",
        topics: [],
      })
    }
  }

  const tagOrder = document.tags.map((tag) => tag.name)
  const tree: GeneratedTree = {
    id: "api",
    groups: [
      {
        label: "",
        pages: [
          { path: "/developer/reference", nav: "Reference", method: null },
        ],
      },
      ...tagOrder.map((tag) => ({
        label: tag,
        pages: operations
          .filter((operation) => operation.tag === tag)
          .map((operation) => ({
            path: operation.href,
            nav: shortNav(operation.summary),
            method: operation.method,
          })),
      })),
    ].filter((group) => group.pages.length > 0),
  }

  return {
    version: document.info.version,
    document: text,
    pages,
    tree,
    samples,
    legacyAnchors,
    operations,
  }
}

/** Short page tree labels, as the design's tree draws them. */
function shortNav(summary: string): string {
  return summary
    .replace(
      /^Get the boost gauge profile for a veBTC token$/,
      "Profile by veBTC",
    )
    .replace(/^Get the boost gauge for a veBTC token$/, "Gauge by veBTC")
    .replace(/^List incentives for an epoch$/, "List incentives")
    .replace(/^Current and next epoch$/, "Current epoch")
    .replace(/^Networks this key can read$/, "List networks")
    .replace(/^Service health$/, "Health")
    .replace(/^Get a gauge profile$/, "Get a profile")
    .replace(/^List gauge profiles$/, "List profiles")
    .replace(/^List a gauge's epochs$/, "Gauge epochs")
}

/** /developer/reference: the generated index of every operation. */
export function referencePage(reference: ReferenceOutput): GeneratedPage {
  const { document } = readOpenApi()
  const baseUrl = `${document.servers[0]?.url ?? ""}/v1`
  const index = referenceIndex(reference, baseUrl)
  const lead = `Every operation in the Matchbox API, generated from openapi.json. Version ${reference.version}, one page per operation.`
  return {
    path: "/developer/reference",
    title: "API reference",
    nav: "API reference",
    description:
      "Every Matchbox API operation, generated from the OpenAPI document",
    lead,
    section: "developer",
    eyebrow: "Matchbox Developer",
    tree: "developer",
    method: null,
    body: {
      kind: "reference",
      reference: index,
      body: [{ t: "p", c: [lead] }],
    },
    toc: index.tags.map((tag) => ({
      id: slugify(tag.name),
      text: tag.name,
      depth: 2 as const,
    })),
    ids: index.tags.map((tag) => slugify(tag.name)),
    links: index.tags.flatMap((tag) =>
      tag.operations.map((operation) => operation.href),
    ),
    sections: [
      { id: null, heading: "API reference", text: lead },
      ...index.tags.map((tag) => ({
        id: slugify(tag.name),
        heading: tag.name,
        text: tag.operations
          .map(
            (operation) =>
              `${operation.summary} ${operation.method} ${operation.path}`,
          )
          .join(" "),
      })),
    ],
    markdown: [
      "# API reference",
      "",
      lead,
      "",
      ...index.tags.flatMap((tag) => [
        `## ${tag.name}`,
        "",
        ...tag.operations.map(
          (operation) =>
            `- [${operation.summary}](https://docs.matchbox.markets${operation.href}): \`${operation.method} ${operation.path}\``,
        ),
        "",
      ]),
    ].join("\n"),
    kind: "page",
    topics: [],
  }
}

export function referenceIndex(
  reference: ReferenceOutput,
  baseUrl: string,
): ReferenceIndexDoc {
  const tags = [
    ...new Set(reference.operations.map((operation) => operation.tag)),
  ]
  return {
    version: reference.version,
    legacyAnchors: reference.legacyAnchors,
    baseUrl,
    networks: ["mezo", "mezo-testnet"],
    tags: tags.map((name) => ({
      name,
      operations: reference.operations
        .filter((operation) => operation.tag === name)
        .map((operation) => ({
          method: operation.method,
          path: operation.path.replace(/^\/v1/, ""),
          summary: operation.summary,
          href: operation.href,
        })),
    })),
  }
}
