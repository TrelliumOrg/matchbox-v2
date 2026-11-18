import type {
  DocCode,
  DocElement,
  DocHtml,
  DocLinkRow,
  DocNode,
} from "@matchbox/docs/render"
import { sectionOfPath } from "@matchbox/docs/site"
import * as Callout from "@matchbox/ui/callout"
import * as CodeBlock from "@matchbox/ui/code-block"
import * as Definition from "@matchbox/ui/definition"
import * as DocFigure from "@matchbox/ui/doc-figure"
import { Glyph } from "@matchbox/ui/icons"
import * as Prose from "@matchbox/ui/prose"
import * as Steps from "@matchbox/ui/steps"
import { Fragment, type ReactNode } from "react"
import { sectionIcon } from "../shell/section-icons"
import { Drawing, EpochClock } from "./bodies"
import { DocLink } from "./doc-link"

/**
 * Renders a page tree (packages/docs render-types) with @matchbox/ui: one
 * component per node type and nothing else, so the content files can only
 * produce what the design system draws.
 */

export function snippet(code: DocCode): CodeBlock.Snippet {
  return {
    label: code.p.title ?? languageLabel(code.p.lang),
    source: code.p.source,
    lines: code.lines,
  }
}

function languageLabel(lang: string): string {
  if (lang === "ts" || lang === "tsx") return "TypeScript"
  if (lang === "bash") return "Shell"
  if (lang === "json" || lang === "jsonc") return "JSON"
  if (lang === "http") return "HTTP"
  return "Code"
}

function LinkRow({ row }: { row: DocLinkRow }): ReactNode {
  const section = row.p.href.startsWith("/")
    ? sectionOfPath(row.p.href)
    : "home"
  return (
    <li>
      <DocLink
        href={row.p.href}
        className="-mx-3 flex items-center gap-4 rounded-[20px] px-3 py-3 outline-none hover:bg-soft focus-visible:outline-2 focus-visible:outline-ink"
      >
        <span
          aria-hidden="true"
          className="grid size-11 flex-none place-items-center rounded-full bg-soft text-ink2"
        >
          <Glyph
            shape={sectionIcon(section, row.p.icon)}
            size={19}
            strokeWidth={1.75}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-ink">
            {row.p.title}
          </span>
          {row.p.subline === undefined ? null : (
            <span className="mt-0.5 block text-[14.5px] text-sec">
              {renderInlineText(row.p.subline)}
            </span>
          )}
        </span>
        <Glyph
          shape={sectionIcon("home", "chevron-right")}
          size={18}
          strokeWidth={1.75}
          className="flex-none text-sec"
        />
      </DocLink>
    </li>
  )
}

/** Text with `code` spans, as link row sublines and generated text carry. */
export function renderInlineText(text: string): ReactNode {
  const parts = text.split(/(`[^`]+`)/)
  return parts.map((part, index) =>
    part.startsWith("`") && part.endsWith("`") && part.length > 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: a fixed split
      <Prose.Code key={index}>{part.slice(1, -1)}</Prose.Code>
    ) : (
      part
    ),
  )
}

/** The plain text of a node, for a column's label. */
function textOf(node: DocNode): string {
  if (typeof node === "string") return node
  return "c" in node && Array.isArray(node.c)
    ? (node.c as readonly DocNode[]).map(textOf).join("")
    : ""
}

function isTag(node: DocNode | undefined, tag: string): node is DocHtml {
  return node !== undefined && typeof node !== "string" && node.t === tag
}

/** Each column's heading, from the table's head row. */
function columnLabels(table: DocHtml): string[] {
  const head = table.c?.find((node) => isTag(node, "thead"))
  const headRow = isTag(head, "thead")
    ? head.c?.find((node) => isTag(node, "tr"))
    : undefined
  const cells = isTag(headRow, "tr") ? (headRow.c ?? []) : []
  return cells.filter((cell) => isTag(cell, "th")).map(textOf)
}

/**
 * A table's sections, with each body cell told its column's heading: on
 * phones the rows reflow to a title and the values under it, the head row
 * is hidden, and each value shows its label (no "veMEZO  Incentives").
 */
function tableBody(table: DocHtml): ReactNode {
  const labels = columnLabels(table)
  return (table.c ?? []).map((section, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: page trees are fixed for a build
    <Fragment key={index}>
      {isTag(section, "tbody") ? (
        <tbody>
          {(section.c ?? []).map((node, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: page trees are fixed for a build
            <Fragment key={rowIndex}>
              {isTag(node, "tr") ? row(node, labels) : renderNode(node)}
            </Fragment>
          ))}
        </tbody>
      ) : (
        renderNode(section)
      )}
    </Fragment>
  ))
}

function row(node: DocHtml, labels: readonly string[]): ReactNode {
  const id = node.p?.id
  return (
    <tr
      id={typeof id === "string" ? id : undefined}
      className="scroll-mt-6 target:bg-acc-soft"
    >
      {(node.c ?? []).map((cell, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: page trees are fixed for a build
        <Fragment key={index}>
          {isTag(cell, "td") ? (
            <Prose.Td
              align={cell.p?.align === "right" ? "right" : undefined}
              label={index === 0 ? undefined : labels[index]}
            >
              {children(cell.c)}
            </Prose.Td>
          ) : (
            renderNode(cell)
          )}
        </Fragment>
      ))}
    </tr>
  )
}

function children(nodes: readonly DocNode[] | undefined): ReactNode {
  if (nodes === undefined) return null
  return nodes.map((node, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: page trees are fixed for a build
    <Fragment key={index}>{renderNode(node)}</Fragment>
  ))
}

function renderElement(node: DocElement): ReactNode {
  switch (node.t) {
    case "p":
      return <Prose.P>{children(node.c)}</Prose.P>
    case "h2":
      return (
        <Prose.H2 id={String(node.p?.id ?? "")}>{children(node.c)}</Prose.H2>
      )
    case "h3":
      return (
        <Prose.H3 id={String(node.p?.id ?? "")}>{children(node.c)}</Prose.H3>
      )
    case "h4":
      return (
        <Prose.H4 id={String(node.p?.id ?? "")}>{children(node.c)}</Prose.H4>
      )
    case "ul":
      return <Prose.Ul>{children(node.c)}</Prose.Ul>
    case "ol":
      return (
        <Prose.Ol
          start={typeof node.p?.start === "number" ? node.p.start : undefined}
        >
          {children(node.c)}
        </Prose.Ol>
      )
    case "li":
      return <Prose.Li>{children(node.c)}</Prose.Li>
    case "a":
      return (
        <DocLink href={String(node.p?.href ?? "")} className={Prose.linkClass}>
          {children(node.c)}
        </DocLink>
      )
    case "strong":
      return <Prose.Strong>{children(node.c)}</Prose.Strong>
    case "em":
      return <em>{children(node.c)}</em>
    case "del":
      return <del>{children(node.c)}</del>
    case "code":
      return <Prose.Code>{children(node.c)}</Prose.Code>
    case "br":
      return <br />
    case "hr":
      return <Prose.Hr />
    case "blockquote":
      return <Prose.Blockquote>{children(node.c)}</Prose.Blockquote>
    case "kbd":
      return <Prose.Kbd>{children(node.c)}</Prose.Kbd>
    case "table":
      return <Prose.Table>{tableBody(node as DocHtml)}</Prose.Table>
    case "thead":
      return <thead>{children(node.c)}</thead>
    case "tbody":
      return <tbody>{children(node.c)}</tbody>
    case "tr":
      return row(node as DocHtml, [])
    case "th":
      return (
        <Prose.Th
          scope="col"
          align={node.p?.align === "right" ? "right" : undefined}
        >
          {children(node.c)}
        </Prose.Th>
      )
    case "td":
      return (
        <Prose.Td align={node.p?.align === "right" ? "right" : undefined}>
          {children(node.c)}
        </Prose.Td>
      )
    case "callout": {
      // The title runs into the first sentence, as the design sets it.
      const [first, ...rest] = node.c
      const inline =
        node.p.title !== undefined &&
        typeof first !== "string" &&
        first?.t === "p"
      return (
        <Callout.Root
          tone={node.p.tone}
          title={inline ? undefined : node.p.title}
          label={node.p.title}
        >
          {inline && typeof first !== "string" && first !== undefined ? (
            <>
              <Prose.P>
                <Prose.Strong>{node.p.title}.</Prose.Strong>{" "}
                {"c" in first ? children(first.c) : null}
              </Prose.P>
              {children(rest)}
            </>
          ) : (
            children(node.c)
          )}
        </Callout.Root>
      )
    }
    case "steps":
      return <Steps.Root>{children(node.c)}</Steps.Root>
    case "step":
      return (
        <Steps.Item title={node.p.title} tag={node.p.tag}>
          {children(node.c)}
        </Steps.Item>
      )
    case "pre":
      return <CodeBlock.Root snippets={[snippet(node)]} />
    case "code-group":
      return <CodeBlock.Root snippets={node.c.map(snippet)} />
    case "term":
      return (
        <Definition.Root
          title={node.p.title}
          definition={node.p.definition}
          link={<DocLink href={node.p.href}>{node.p.label}</DocLink>}
        >
          {children(node.c)}
        </Definition.Root>
      )
    case "figure":
      return (
        <DocFigure.Root label={node.p.label} caption={node.p.caption}>
          <Drawing name={node.p.drawing} />
        </DocFigure.Root>
      )
    case "link-rows":
      return (
        <ul className="mt-4">
          {node.c.map((row) => (
            <LinkRow key={row.p.href} row={row} />
          ))}
        </ul>
      )
    case "link-row":
      return <LinkRow row={node} />
    case "epoch-clock":
      return <EpochClock />
    case "facts":
      return (
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3.5 rounded-[24px] bg-soft px-6 py-5 max-sm:grid-cols-1">
          {children(node.c)}
        </dl>
      )
    case "fact":
      return (
        <div className="min-w-0">
          <dt className="text-[13.5px] text-sec">{node.p.label}</dt>
          <dd
            className={`mt-0.5 text-[15px] font-semibold text-ink [overflow-wrap:anywhere] ${node.p.mono === true ? "font-mono font-medium" : ""}`}
          >
            {children(node.c)}
          </dd>
        </div>
      )
  }
}

export function renderNode(node: DocNode): ReactNode {
  if (typeof node === "string") return node
  return renderElement(node)
}

/** The cells in a table's first row. */
function columnsOf(node: DocNode): number {
  if (typeof node === "string" || !("c" in node)) return 0
  for (const child of node.c as readonly DocNode[]) {
    if (typeof child === "string") continue
    if (child.t === "tr") return "c" in child ? child.c.length : 0
    const found = columnsOf(child)
    if (found > 0) return found
  }
  return 0
}

/**
 * Nodes that use the full article column (layout v2): code, the epoch
 * clock card, media and tables of 4 or more columns. Everything else stops
 * at 620 (about 74 characters), through `.docs-measure` in styles.css.
 */
function isWide(node: DocNode): boolean {
  if (typeof node === "string") return false
  if (
    node.t === "pre" ||
    node.t === "code-group" ||
    node.t === "epoch-clock" ||
    node.t === "figure"
  ) {
    return true
  }
  return node.t === "table" && columnsOf(node) >= 4
}

/** A page body; the first paragraph is the lead. */
export function Body({
  nodes,
  lead: withLead = true,
}: {
  nodes: readonly DocNode[]
  lead?: boolean
}): ReactNode {
  return nodes.map((node, index) => {
    const lead =
      withLead && index === 0 && typeof node !== "string" && node.t === "p"
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: page trees are fixed for a build
      <Fragment key={index}>
        {lead ? (
          <Prose.Lead>{children(node.c)}</Prose.Lead>
        ) : isWide(node) ? (
          <div className="docs-wide">{renderNode(node)}</div>
        ) : (
          renderNode(node)
        )}
      </Fragment>
    )
  })
}
