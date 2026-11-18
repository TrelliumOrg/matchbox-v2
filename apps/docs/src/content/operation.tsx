import type { OperationDoc, OperationParameter } from "@matchbox/docs/render"
import * as CodeBlock from "@matchbox/ui/code-block"
import { shapes } from "@matchbox/ui/icons"
import * as OperationHeader from "@matchbox/ui/operation-header"
import * as Prose from "@matchbox/ui/prose"
import * as SchemaTree from "@matchbox/ui/schema-tree"
import type { ReactNode } from "react"
import { DocLink } from "./doc-link"
import { Body, renderInlineText, snippet } from "./render"
import { type Framing, InlineSamples, SamplesLayout } from "./samples-layout"

/**
 * One API operation (Doop `vFd6_tfSDd`), generated from openapi.json:
 * method and path, auth, parameters, headers, the response schema tree and
 * the status codes, each error code linked to its row on the errors page.
 * From 1280 the samples sit in a sticky column on the right, below it
 * inline after the description (layout v2).
 */

function Parameters({
  items,
}: {
  items: readonly OperationParameter[]
}): ReactNode {
  return (
    <SchemaTree.Root
      fields={items.map((item) => ({
        name: item.name,
        type: item.in === "path" ? `${item.type}, in path` : item.type,
        required: item.required,
        description: item.description,
        values: item.values,
        children: [],
      }))}
      renderText={renderInlineText}
    />
  )
}

export function OperationBody({
  operation,
  head,
  foot,
}: { operation: OperationDoc } & Framing): ReactNode {
  const samples = (
    <CodeBlock.Root
      snippets={operation.samples.map(snippet)}
      className="xl:mt-0"
    />
  )
  return (
    <SamplesLayout head={head} foot={foot} samples={samples} label="Samples">
      <OperationHeader.Root method={operation.method} path={operation.path} />
      <OperationHeader.Meta
        items={[
          {
            icon: shapes.keyRound,
            label: "Authentication",
            text: operation.auth,
          },
          ...(operation.since === null
            ? []
            : [
                {
                  icon: shapes.history,
                  label: "Since",
                  text: operation.since,
                },
              ]),
        ]}
      />
      <Body nodes={operation.description} lead={false} />
      <InlineSamples>{samples}</InlineSamples>
      {operation.parameters.length === 0 ? null : (
        <>
          <Prose.H2 id="parameters">Parameters</Prose.H2>
          <Parameters items={operation.parameters} />
        </>
      )}
      {operation.headers.length === 0 ? null : (
        <>
          <Prose.H2 id="headers">Headers</Prose.H2>
          <Parameters items={operation.headers} />
        </>
      )}
      {operation.response === null ? null : (
        <>
          <Prose.H2
            id="response"
            className="flex items-baseline justify-between gap-4"
          >
            Response
            <span className="font-mono text-[13.5px] font-normal tracking-normal text-sec">
              {operation.response.status} {operation.response.contentType}
            </span>
          </Prose.H2>
          <SchemaTree.Root
            fields={operation.response.fields}
            renderText={renderInlineText}
          />
        </>
      )}
      <Prose.H2 id="status-codes">Status codes</Prose.H2>
      <ul className="mt-2 border-t border-line">
        {operation.statuses.map((status) => (
          <li
            key={status.code}
            className="flex gap-4 border-b border-line py-3 text-[15px] leading-[23px]"
          >
            <span className="w-10 flex-none font-mono font-medium text-ink">
              {status.code}
            </span>
            <span className="min-w-0 text-ink2">
              {status.errors.map((error, index) => (
                <span key={error}>
                  {index > 0 ? ", " : null}
                  <DocLink
                    href={`/developer/errors#${error}`}
                    className={`font-mono text-[14px] ${Prose.linkClass}`}
                  >
                    {error}
                  </DocLink>
                </span>
              ))}
              {status.errors.length > 0 && status.description !== ""
                ? ". "
                : null}
              {renderInlineText(status.description)}
            </span>
          </li>
        ))}
      </ul>
    </SamplesLayout>
  )
}
