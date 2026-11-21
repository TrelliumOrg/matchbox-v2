import { readFileSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { z } from "zod"
import type { DocNode, SchemaField, ToolDoc } from "../render-types"
import {
  type GeneratedPage,
  type GeneratedTree,
  previewText,
  sentencesOf,
} from "./build-site"
import { codeLanguage, highlight } from "./highlight"
import { inlineText } from "./markdown"
import { docsVoice } from "./reference"

/**
 * The Matchbox MCP tool reference: one page per tool from the committed
 * src/mcp-tools.gen.json, which scripts/mcp-schemas.ts writes from Stuart's
 * real `tools/list` (apps/stuart/src/query/mcp.ts). The schemas, the
 * descriptions and the tool count all come from that file.
 */

type Schema = {
  type?: string | string[] | undefined
  enum?: unknown[] | undefined
  const?: unknown
  description?: string | undefined
  properties?: Record<string, Schema> | undefined
  required?: string[] | undefined
  items?: Schema | undefined
  anyOf?: Schema[] | undefined
  additionalProperties?: boolean | undefined
}

const schema: z.ZodType<Schema> = z.lazy(() =>
  z
    .object({
      type: z.union([z.string(), z.array(z.string())]).optional(),
      enum: z.array(z.unknown()).optional(),
      const: z.unknown().optional(),
      description: z.string().optional(),
      properties: z.record(z.string(), schema).optional(),
      required: z.array(z.string()).optional(),
      items: schema.optional(),
      anyOf: z.array(schema).optional(),
      additionalProperties: z.boolean().optional(),
    })
    .strict(),
)

const toolSchema = z.object({
  name: z.string().regex(/^[a-z_]+$/),
  description: z.string().min(1),
  inputSchema: schema,
  annotations: z.object({
    readOnlyHint: z.boolean(),
    destructiveHint: z.boolean(),
    idempotentHint: z.boolean(),
    openWorldHint: z.boolean(),
  }),
})

export const mcpToolsFileSchema = z.object({
  protocolVersion: z.string(),
  tools: z.array(toolSchema).min(1),
})

export type McpToolsFile = z.infer<typeof mcpToolsFileSchema>

const stuartMcp = "../../../../apps/stuart/src/query/mcp.ts"

const stuartModuleSchema = z.object({
  MCP_PROTOCOL_VERSION: z.string(),
  handleMcpRequest: z.custom<
    (input: { body: unknown; headers: Headers; runtime: unknown }) => Promise<{
      status: number
      body: unknown
    }>
  >((value) => typeof value === "function"),
})

const listResponseSchema = z.object({
  result: z.object({ tools: z.array(z.unknown()) }),
})

/** Asks Stuart's MCP handler for `tools/list`, exactly as a client would. */
export async function toolsListOf(): Promise<McpToolsFile> {
  // A runtime path, so the docs typecheck never compiles apps/stuart.
  const url = pathToFileURL(
    fileURLToPath(new URL(stuartMcp, import.meta.url)),
  ).href
  const loaded: unknown = await import(/* @vite-ignore */ url)
  const stuart = stuartModuleSchema.parse(loaded)
  const version = stuart.MCP_PROTOCOL_VERSION
  const response = await stuart.handleMcpRequest({
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": version,
          "io.modelcontextprotocol/clientInfo": {
            name: "matchbox-docs",
            version: "1",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    },
    headers: new Headers({
      "mcp-protocol-version": version,
      "mcp-method": "tools/list",
    }),
    // tools/list never touches the runtime.
    runtime: {},
  })
  const list = listResponseSchema.parse(response.body)
  return mcpToolsFileSchema.parse({
    protocolVersion: version,
    tools: list.result.tools,
  })
}

export function readMcpTools(): McpToolsFile {
  const file = fileURLToPath(new URL("../mcp-tools.gen.json", import.meta.url))
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"))
  return mcpToolsFileSchema.parse(raw)
}

function label(property: Schema): string {
  if (property.anyOf !== undefined) {
    const parts = [...new Set(property.anyOf.map(label))]
    const nonNull = parts.filter((part) => part !== "null")
    return nonNull.length === parts.length
      ? nonNull.join(" or ")
      : `${nonNull.join(" or ")} or null`
  }
  if (property.const !== undefined) return JSON.stringify(property.const)
  if (Array.isArray(property.type)) return property.type.join(" or ")
  if (property.type === "array" && property.items !== undefined) {
    return `array of ${label(property.items)}`
  }
  return property.type ?? "object"
}

function values(property: Schema): string[] {
  if (property.enum !== undefined)
    return property.enum.map((value) => String(value))
  if (property.anyOf !== undefined) return property.anyOf.flatMap(values)
  if (property.items !== undefined) return values(property.items)
  if (property.const !== undefined) return [String(property.const)]
  return []
}

function objectOf(property: Schema): Schema | null {
  if (property.properties !== undefined) return property
  if (property.items !== undefined) return objectOf(property.items)
  for (const variant of property.anyOf ?? []) {
    const found = objectOf(variant)
    if (found !== null) return found
  }
  return null
}

function fields(object: Schema): SchemaField[] {
  return Object.entries(object.properties ?? {}).map(([name, property]) => {
    const inner = objectOf(property)
    const nullable = label(property).endsWith("or null")
    return {
      name,
      type: label(property),
      // Every key is listed as required: nullable ones accept null.
      required: !nullable && (object.required ?? []).includes(name),
      description: docsVoice(property.description ?? ""),
      values: [...new Set(values(property))],
      children: inner === null ? [] : fields(inner),
    }
  })
}

/** Example arguments from the schema: the first value or null. */
function exampleArguments(object: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [name, property] of Object.entries(object.properties ?? {})) {
    out[name] = exampleValue(name, property)
  }
  return out
}

function exampleValue(name: string, property: Schema): unknown {
  if (name === "walletAddress") return "0xYOUR_WALLET_ADDRESS"
  if (property.anyOf !== undefined) {
    if (property.anyOf.some((variant) => variant.type === "null")) return null
    return exampleValue(name, property.anyOf[0] ?? {})
  }
  if (property.enum !== undefined) return property.enum[0]
  if (property.const !== undefined) return property.const
  if (property.type === "array" && property.items !== undefined) {
    return [exampleValue(name, property.items)]
  }
  if (property.type === "object") return exampleArguments(property)
  if (property.type === "integer" || property.type === "number") return 1
  if (property.type === "boolean") return true
  return "…"
}

export function toolGroup(name: string): string {
  if (name.startsWith("prepare_") || name === "claim_collateral_surplus")
    return "Prepare"
  if (
    name === "optimize_votes" ||
    name === "scenario_liquidation" ||
    name === "quote_zap"
  ) {
    return "Plan"
  }
  return "Read"
}

export function toolTitle(name: string): string {
  const words = name.split("_").join(" ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function toolPath(name: string): string {
  return `/developer/mcp/tools/${name.replaceAll("_", "-")}`
}

export type McpOutput = {
  pages: GeneratedPage[]
  tree: GeneratedTree
  count: number
  protocolVersion: string
}

export async function generateMcpTools(
  file: McpToolsFile = readMcpTools(),
): Promise<McpOutput> {
  const groups = ["Read", "Plan", "Prepare"]
  const pages: GeneratedPage[] = []
  for (const tool of file.tools) {
    const call = JSON.stringify(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: tool.name,
          arguments: exampleArguments(tool.inputSchema),
        },
      },
      null,
      2,
    )
    const lang = codeLanguage("json")
    const description: DocNode[] = docsVoice(tool.description)
      .split(/\n{2,}/)
      .map((part) => ({ t: "p", c: inlineText(part) }))
    const doc: ToolDoc = {
      name: tool.name,
      group: toolGroup(tool.name),
      title: toolTitle(tool.name),
      description,
      readOnly: tool.annotations.readOnlyHint,
      input: fields(tool.inputSchema),
      call: {
        t: "pre",
        p: { lang, title: "tools/call", source: call },
        lines: await highlight(call, lang),
      },
    }
    pages.push({
      path: toolPath(tool.name),
      title: doc.title,
      nav: tool.name,
      description:
        sentencesOf(tool.description)[0]?.replace(/\.$/, "") ?? tool.name,
      lead: previewText(docsVoice(tool.description.split(/\n{2,}/)[0] ?? "")),
      section: "developer",
      eyebrow: "MCP tools",
      tree: "mcp",
      method: null,
      body: { kind: "tool", tool: doc, body: [] },
      toc: [{ id: "input", text: "Input", depth: 2 }],
      ids: ["input"],
      links: [],
      sections: [
        {
          id: null,
          heading: doc.title,
          text: `${tool.name} ${tool.description} ${doc.input.map((field) => `${field.name} ${field.description}`).join(" ")}`,
        },
      ],
      markdown: [
        `# ${doc.title}`,
        "",
        `MCP tool \`${tool.name}\`.`,
        "",
        docsVoice(tool.description),
        "",
        "## Input",
        "",
        "```json",
        JSON.stringify(tool.inputSchema, null, 2),
        "```",
        "",
      ].join("\n"),
      kind: "tool",
      topics: [],
    })
  }
  const tree: GeneratedTree = {
    id: "mcp",
    groups: [
      {
        label: "",
        pages: [
          { path: "/developer/mcp", nav: "MCP", method: null },
          { path: "/developer/mcp/tools", nav: "MCP tools", method: null },
        ],
      },
      ...groups.map((group) => ({
        label: group,
        pages: file.tools
          .filter((tool) => toolGroup(tool.name) === group)
          .map((tool) => ({
            path: toolPath(tool.name),
            nav: tool.name,
            method: null,
          })),
      })),
    ],
  }
  return {
    pages,
    tree,
    count: file.tools.length,
    protocolVersion: file.protocolVersion,
  }
}

/** The tools index page body: one link row per tool, by group. */
export function toolsIndexRows(file: McpToolsFile): DocNode[] {
  const out: DocNode[] = []
  for (const group of ["Read", "Plan", "Prepare"]) {
    const tools = file.tools.filter((tool) => toolGroup(tool.name) === group)
    if (tools.length === 0) continue
    const id = group.toLowerCase()
    out.push({ t: "h2", p: { id }, c: [group] })
    out.push({
      t: "link-rows",
      c: tools.map((tool) => ({
        t: "link-row",
        p: {
          href: toolPath(tool.name),
          title: tool.name,
          subline: docsVoice(tool.description.split(". ")[0] ?? "").replace(
            /\.$/,
            "",
          ),
          icon: "wrench",
        },
      })),
    })
  }
  return out
}
