import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { formatJson } from "../src/pipeline/emit"
import { mcpToolsFileSchema, toolsListOf } from "../src/pipeline/mcp-tools"

/**
 * Writes src/mcp-tools.gen.json from Stuart's own MCP handler: the exact
 * `tools/list` result the Matchbox MCP serves, so the docs' tool pages
 * cannot drift from the tools. Run by `pnpm --filter @matchbox/docs
 * generate`; the package test fails when the committed file differs.
 * apps/stuart is read, never edited.
 */

const target = fileURLToPath(
  new URL("../src/mcp-tools.gen.json", import.meta.url),
)
const result = await toolsListOf()
const parsed = mcpToolsFileSchema.parse(result)
writeFileSync(target, await formatJson(parsed))
console.log(`wrote ${parsed.tools.length} MCP tools`)
