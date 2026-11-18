import type { ReactNode } from "react"
import { Glyph, shapes } from "../icons"

/**
 * A schema as a list of fields (Doop `vFd6_tfSDd`): the name in DM Mono,
 * its type in grey, "Required" in the accent ink, allowed values as code
 * chips, and the description. Nested objects indent on a hairline and
 * fold into a "7 fields" disclosure after the first level, so a long
 * response stays scannable. Native `<details>`, so it works before and
 * without JavaScript.
 */

export type Field = {
  name: string
  type: string
  required: boolean
  description: string
  values: readonly string[]
  children: readonly Field[]
}

export type RootProps = {
  fields: readonly Field[]
  /** Renders a description (inline code and links). */
  renderText?: (text: string) => ReactNode
}

function Chips({ values }: { values: readonly string[] }): ReactNode {
  if (values.length === 0) return null
  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      {values.map((value) => (
        <code
          key={value}
          className="rounded-md bg-soft2 px-1.5 py-px font-mono text-[13.5px] text-ink"
        >
          {value}
        </code>
      ))}
    </span>
  )
}

function Row({
  field,
  depth,
  renderText,
}: {
  field: Field
  depth: number
  renderText: (text: string) => ReactNode
}): ReactNode {
  const nested =
    field.children.length === 0 ? null : (
      <List fields={field.children} depth={depth + 1} renderText={renderText} />
    )
  return (
    <li className="border-b border-line py-3 last:border-b-0">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <code className="font-mono text-[14.5px] font-medium text-ink">
          {field.name}
        </code>
        <span className="text-[13.5px] text-sec">{field.type}</span>
        {field.required ? (
          <span className="text-[13.5px] font-medium text-acc-ink">
            Required
          </span>
        ) : null}
      </p>
      {field.description === "" ? null : (
        <p className="mt-1 text-[15px] leading-[23px] text-ink2">
          {renderText(field.description)}
        </p>
      )}
      <Chips values={field.values} />
      {nested === null ? null : depth === 0 ? (
        <div className="mt-2 border-l border-line pl-4">{nested}</div>
      ) : (
        <details className="group mt-1.5">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded text-[14px] font-semibold text-ink2 outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink [&::-webkit-details-marker]:hidden">
            <Glyph
              shape={shapes.chevronRight}
              size={14}
              strokeWidth={2}
              className="transition-transform group-open:rotate-90 motion-reduce:transition-none"
            />
            {field.children.length} fields
          </summary>
          <div className="mt-1 border-l border-line pl-4">{nested}</div>
        </details>
      )}
    </li>
  )
}

function List({
  fields,
  depth,
  renderText,
}: {
  fields: readonly Field[]
  depth: number
  renderText: (text: string) => ReactNode
}): ReactNode {
  return (
    <ul>
      {fields.map((field) => (
        <Row
          key={field.name}
          field={field}
          depth={depth}
          renderText={renderText}
        />
      ))}
    </ul>
  )
}

export function Root({
  fields,
  renderText = (text) => text,
}: RootProps): ReactNode {
  return (
    <div className="mt-2 border-t border-line">
      <List fields={fields} depth={0} renderText={renderText} />
    </div>
  )
}
Root.displayName = "SchemaTree"
