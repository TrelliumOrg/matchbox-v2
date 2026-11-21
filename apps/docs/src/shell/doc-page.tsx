import { type ManifestPage, manifest } from "@matchbox/docs/manifest"
import type { PageData, TocItem } from "@matchbox/docs/render"
import { sectionById } from "@matchbox/docs/site"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as PageBar from "@matchbox/ui/page-bar"
import * as PrevNext from "@matchbox/ui/prev-next"
import * as Prose from "@matchbox/ui/prose"
import * as Toc from "@matchbox/ui/toc"
import { type ReactNode, Suspense } from "react"
import { OperationBody, ReferenceBody, ToolBody } from "../content/bodies"
import { DocLink } from "../content/doc-link"
import { usePage } from "../content/page-data"
import { Body } from "../content/render"
import { askAboutPage, warmAsk } from "./ask"
import { BottomSheet, hideSheet, navSheetId, tocSheetId } from "./bottom-sheet"
import { Kbar } from "./docs-shell"
import { DogDisc } from "./dog"
import { CopyPage } from "./page-actions"
import { PageTree } from "./page-tree"

/**
 * A docs page (layout v2, Doop `WC_9ztyeY-`): at most three columns below
 * the header. Section navigation, the article and On this page are 240,
 * 792 and 200 at 1440 (gaps 64), 240, 664 and 200 at 1280 (gaps 48), and
 * 220 and 676 at 1024, where On this page moves into the header's list
 * button. At 834 the section navigation is the section pill above the
 * title, and phones keep the bottom page bar. API operation and MCP tool
 * pages put their samples in On this page's slot.
 */

function TocSheet({
  items,
  active,
  minutes,
  path,
}: {
  items: readonly TocItem[]
  active: string | null
  minutes: number
  path: string
}): ReactNode {
  const close = (): void => hideSheet(tocSheetId)
  return (
    <BottomSheet id={tocSheetId} label="On this page">
      <div className="flex items-baseline justify-between px-2">
        <p className="text-[20px] font-[650] text-ink">On this page</p>
        <p className="text-[14px] text-sec">{minutes} min</p>
      </div>
      <ul className="mt-3">
        {items.map((item) => {
          const current = item.id === active
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                onClick={close}
                aria-current={current ? "location" : undefined}
                className={`flex h-[52px] items-center gap-3.5 rounded-3xl px-2 text-base outline-none focus-visible:outline-2 focus-visible:outline-ink ${current ? "bg-soft font-semibold text-ink" : "text-ink2"} ${item.depth === 3 ? "pl-7" : ""}`}
              >
                <span
                  aria-hidden="true"
                  className={`size-2 flex-none rounded-full ${current ? "bg-acc" : "bg-soft2"}`}
                />
                {item.text}
              </a>
            </li>
          )
        })}
      </ul>
      <div className="mt-3 flex gap-2.5 px-1">
        <button
          type="button"
          onClick={() => {
            close()
            window.scrollTo({ top: 0 })
          }}
          className="flex h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-3xl bg-soft text-[15px] font-semibold text-ink outline-none focus-visible:outline-2 focus-visible:outline-ink [@media(scripting:none)]:hidden"
        >
          <Glyph shape={shapes.arrowUp} size={17} strokeWidth={2} />
          Top
        </button>
        <CopyPage path={path} compact={false} />
      </div>
    </BottomSheet>
  )
}

function PageBody({
  data,
  head,
  foot,
}: {
  data: PageData
  head: ReactNode
  foot: ReactNode
}): ReactNode {
  switch (data.kind) {
    case "prose":
      return (
        <Prose.Root className="docs-measure">
          {head}
          <Body nodes={data.body} />
        </Prose.Root>
      )
    case "reference":
      return (
        <Prose.Root className="docs-measure">
          {head}
          <ReferenceBody reference={data.reference} lead={data.body} />
        </Prose.Root>
      )
    case "operation":
      return (
        <Prose.Root>
          <OperationBody operation={data.operation} head={head} foot={foot} />
        </Prose.Root>
      )
    case "tool":
      return (
        <Prose.Root>
          <ToolBody tool={data.tool} head={head} foot={foot} />
        </Prose.Root>
      )
  }
}

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

/** The page's date and source, then Previous and Next. */
function PageFoot({ page }: { page: ManifestPage }): ReactNode {
  return (
    <>
      <ul className="mt-[22px] flex flex-wrap items-center gap-x-[22px] gap-y-2 text-[14px] text-sec">
        {page.updated === "" ? null : (
          <li className="flex items-center gap-[7px]">
            <Glyph shape={shapes.calendarDays} size={16} strokeWidth={1.75} />
            <span className="sr-only">Last updated </span>
            {dateFormat.format(new Date(`${page.updated}T00:00:00Z`))}
          </li>
        )}
        {page.source === null ? null : (
          <li>
            <a
              href={page.source}
              className={`flex items-center gap-[7px] max-md:min-h-10 ${Prose.linkClass}`}
            >
              <Glyph shape={shapes.pencil} size={16} strokeWidth={1.75} />
              Edit on GitHub
            </a>
          </li>
        )}
      </ul>
      {page.prev === null && page.next === null ? null : (
        <PrevNext.Root>
          {page.prev === null ? null : (
            <PrevNext.Item direction="previous">
              <DocLink href={page.prev}>
                <PrevNext.Content
                  direction="previous"
                  title={manifest.pages[page.prev]?.nav ?? page.prev}
                />
              </DocLink>
            </PrevNext.Item>
          )}
          {page.next === null ? null : (
            <PrevNext.Item direction="next">
              <DocLink href={page.next}>
                <PrevNext.Content
                  direction="next"
                  title={manifest.pages[page.next]?.nav ?? page.next}
                />
              </DocLink>
            </PrevNext.Item>
          )}
        </PrevNext.Root>
      )}
    </>
  )
}

/** At 834 the section navigation is a pill above the title. */
function SectionPill({ page }: { page: ManifestPage }): ReactNode {
  return (
    <button
      type="button"
      popoverTarget={navSheetId}
      aria-haspopup="dialog"
      className="mb-5 hidden h-10 max-w-full cursor-pointer items-center gap-2 rounded-[20px] bg-soft px-4 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-ink md:flex lg:hidden"
    >
      <span className="flex-none font-semibold text-ink">
        {sectionById(page.section).name}
      </span>
      <span className="truncate text-sec">{page.nav}</span>
      <Glyph
        shape={shapes.chevronDown}
        size={16}
        strokeWidth={1.75}
        className="flex-none text-sec"
      />
    </button>
  )
}

function Article({
  page,
  samples,
}: {
  page: ManifestPage
  samples: boolean
}): ReactNode {
  const data = usePage(page.path)
  const active = Toc.useActiveHeading(data.toc.map((item) => item.id))
  const current =
    data.toc.find((item) => item.id === active)?.text ?? page.title
  const head = (
    <>
      <Prose.Eyebrow>{page.eyebrow}</Prose.Eyebrow>
      <Prose.Title>{page.title}</Prose.Title>
    </>
  )
  const foot = <PageFoot page={page} />
  return (
    <>
      <main id="content" tabIndex={-1} className="min-w-0 outline-none">
        <SectionPill page={page} />
        <PageBody data={data} head={head} foot={foot} />
        {samples ? null : foot}
      </main>
      {samples || data.toc.length === 0 ? null : (
        <aside className="sticky top-32 hidden max-h-[calc(100dvh-152px)] overflow-y-auto xl:block">
          <Toc.Root
            items={data.toc}
            active={active}
            readingMinutes={page.readingMinutes}
          />
        </aside>
      )}
      {data.toc.length === 0 ? null : (
        <>
          <PageBar.Root
            current={current}
            sheet={tocSheetId}
            className="md:hidden"
            action={
              <button
                type="button"
                aria-label="Ask about this page"
                aria-haspopup="dialog"
                onClick={() => askAboutPage(page.path, page.title)}
                onTouchStart={warmAsk}
                className="grid size-[46px] flex-none cursor-pointer place-items-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-ink [@media(scripting:none)]:hidden"
              >
                <DogDisc size={46} />
              </button>
            }
          />
          <TocSheet
            items={data.toc}
            active={active}
            minutes={page.readingMinutes}
            path={page.path}
          />
        </>
      )}
    </>
  )
}

/**
 * From 768 the Ctrl K bar floats 28 above the foot of the article column,
 * and on first view it sat over whatever was there, such as the API
 * reference's Gauge profiles rows (20 Nov 2026). This strip, the page's own
 * background with a short fade at its top, sticks to the foot of the
 * article column (and the samples on API pages) up to 12 over the bar, so
 * content stops above the bar and is never under it. Its own row after
 * the article, so at the end of a page it sits below the content, not on
 * it. Hidden with the bar, and server rendered, so it is there on first
 * paint. The bar paints over it (z-20). The search palette and Ask open
 * as modal sheets over both, so neither needs hiding then.
 */
const kbarGutter =
  "sticky bottom-0 z-10 hidden h-[94px] bg-linear-to-t from-bg from-87% to-transparent md:block lg:col-start-2 [@media(scripting:none)]:hidden"

export function DocPage({ page }: { page: ManifestPage }): ReactNode {
  const samples = page.kind === "operation" || page.kind === "tool"
  return (
    <div
      id="top"
      className="mx-auto max-w-[1440px] px-5 pt-3 pb-10 md:px-8 md:pt-8 lg:px-10 lg:pt-10"
    >
      <div
        className={`grid items-start lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-x-12 min-[90rem]:gap-x-16 ${samples ? "xl:grid-cols-[240px_minmax(0,1fr)]" : "xl:grid-cols-[240px_minmax(0,1fr)_200px]"}`}
      >
        <div className="sticky top-32 -ml-3 hidden max-h-[calc(100dvh-152px)] overflow-y-auto overscroll-contain pb-6 lg:block">
          <PageTree tree={page.tree} current={page.path} />
        </div>
        <Suspense fallback={null}>
          <Article page={page} samples={samples} />
        </Suspense>
        <span aria-hidden="true" data-kbar-gutter="" className={kbarGutter} />
      </div>
      <Kbar samples={samples} />
    </div>
  )
}
