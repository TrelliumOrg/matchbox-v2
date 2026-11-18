import type { ToolDoc } from "@matchbox/docs/render"
import * as CodeBlock from "@matchbox/ui/code-block"
import { shapes } from "@matchbox/ui/icons"
import * as OperationHeader from "@matchbox/ui/operation-header"
import * as Prose from "@matchbox/ui/prose"
import * as SchemaTree from "@matchbox/ui/schema-tree"
import type { ReactNode } from "react"
import { Body, renderInlineText, snippet } from "./render"
import { type Framing, InlineSamples, SamplesLayout } from "./samples-layout"

/**
 * One Matchbox MCP tool (Doop `qeSlKM6irA`), generated from the schemas
 * Stuart's MCP handler serves: the tool name, its annotations, the input
 * schema and a `tools/call` request built from that schema.
 */
export function ToolBody({
  tool,
  head,
  foot,
}: { tool: ToolDoc } & Framing): ReactNode {
  const call = (
    <CodeBlock.Root snippets={[snippet(tool.call)]} className="xl:mt-0" />
  )
  return (
    <SamplesLayout head={head} foot={foot} samples={call} label="Request">
      <OperationHeader.Root method="Tool" path={tool.name} />
      <OperationHeader.Meta
        items={[
          {
            icon: shapes.eye,
            label: "Access",
            text: tool.readOnly ? "Read only" : "Writes",
          },
          { icon: shapes.dog, label: "Same tool as", text: "Stuart" },
        ]}
      />
      <Body nodes={tool.description} lead={false} />
      <InlineSamples>{call}</InlineSamples>
      <Prose.H2
        id="input"
        className="flex items-baseline justify-between gap-4"
      >
        Input
        <span className="text-[14px] font-normal tracking-normal text-sec">
          JSON Schema
        </span>
      </Prose.H2>
      <SchemaTree.Root fields={tool.input} renderText={renderInlineText} />
    </SamplesLayout>
  )
}
