import type { DocNode, ReferenceIndexDoc } from "@matchbox/docs/render"
import { Glyph, shapes } from "@matchbox/ui/icons"
import { Fragment, type ReactNode } from "react"
import { DocLink } from "./doc-link"
import { Body } from "./render"

/**
 * The API reference index (Doop `9tXhtFiRk-`): base URL, the auth header
 * and networks on a soft card with the JSON download, then one card per
 * tag listing its operations. Classic's console linked operations by
 * anchor (`#get-v1-gauges`) and tags by `?tag=`; the inline script below
 * sends those to the new pages before the first paint finishes.
 */

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/**
 * An operation's path, whole: it may break only before a slash, so on a
 * narrow card it wraps segment by segment and never ends in an ellipsis
 * (D2, 20 Nov 2026).
 */
export function PathText({ path }: { path: string }): ReactNode {
  const segments = path.split("/")
  return segments.map((segment, index) =>
    index === 0 ? (
      segment
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: a path's segments are fixed
      <Fragment key={index}>
        <wbr />/{segment}
      </Fragment>
    ),
  )
}

/** Runs in the static page: fragments never reach a server. */
export function legacyAnchorScript(
  anchors: Readonly<Record<string, string>>,
): string {
  return `(function(){try{var m=${JSON.stringify(anchors)},h=location.hash.slice(1),t=new URLSearchParams(location.search).get("tag");if(h&&m[h]){location.replace(m[h]);return}if(t){var id=t.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");addEventListener("DOMContentLoaded",function(){var e=document.getElementById(id);if(e)e.scrollIntoView()})}}catch(e){}})()`
}

export function ReferenceBody({
  reference,
  lead,
}: {
  reference: ReferenceIndexDoc
  lead: readonly DocNode[]
}): ReactNode {
  return (
    <>
      <script
        suppressHydrationWarning
        // biome-ignore lint/security/noDangerouslySetInnerHtml: maps Classic's reference anchors to operation pages, hashed in the CSP
        dangerouslySetInnerHTML={{
          __html: import.meta.env.SSR
            ? legacyAnchorScript(reference.legacyAnchors)
            : "",
        }}
      />
      <Body nodes={lead} />
      <dl className="docs-wide mt-7 flex flex-wrap items-center gap-x-10 gap-y-4 rounded-[24px] bg-soft py-[18px] pr-3 pl-6">
        <div>
          <dt className="text-[13.5px] text-sec">Base URL</dt>
          <dd className="mt-1 font-mono text-[14px] text-ink">
            {reference.baseUrl}
          </dd>
        </div>
        <div>
          <dt className="text-[13.5px] text-sec">Authorization header</dt>
          <dd className="mt-1 font-mono text-[14px] text-ink">
            Bearer mbx_sk_…
          </dd>
        </div>
        <div>
          <dt className="text-[13.5px] text-sec">Networks</dt>
          <dd className="mt-1 font-mono text-[14px] text-ink">
            {reference.networks.join(", ")}
          </dd>
        </div>
        <div className="ml-auto">
          <dt className="sr-only">OpenAPI document</dt>
          <dd>
            <a
              href="/developer/openapi.json"
              download
              className="flex h-11 items-center gap-2 rounded-[22px] bg-bg px-4 text-[15px] font-semibold text-ink outline-none focus-visible:outline-2 focus-visible:outline-ink"
            >
              <Glyph shape={shapes.download} size={17} strokeWidth={1.8} />
              JSON
            </a>
          </dd>
        </div>
      </dl>
      <div className="docs-wide mt-8 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        {reference.tags.map((tag) => (
          <section
            key={tag.name}
            aria-labelledby={slug(tag.name)}
            className="rounded-[24px] bg-soft px-5 pt-4 pb-2"
          >
            <h2
              id={slug(tag.name)}
              className="flex scroll-mt-6 items-center justify-between border-b border-line pb-3 text-[17px] font-semibold text-ink"
            >
              {tag.name}
              <span className="text-[14px] font-normal text-sec">
                {tag.operations.length}
              </span>
            </h2>
            <ul>
              {tag.operations.map((operation) => (
                <li
                  key={operation.href}
                  className="border-b border-line last:border-b-0"
                >
                  <DocLink
                    href={operation.href}
                    className="-mx-2 flex items-center gap-3 rounded-2xl px-2 py-3 outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink"
                  >
                    <span className="grid h-6 flex-none place-items-center rounded-md bg-bg px-1.5 font-mono text-[12px] font-medium text-ink">
                      {operation.method}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15.5px] font-medium text-ink">
                        {operation.summary}
                      </span>
                      <span
                        data-operation-path=""
                        className="block font-mono text-[12.5px] text-sec"
                      >
                        <PathText path={operation.path} />
                      </span>
                    </span>
                    <Glyph
                      shape={shapes.chevronRight}
                      size={17}
                      strokeWidth={1.75}
                      className="flex-none text-sec"
                    />
                  </DocLink>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}
