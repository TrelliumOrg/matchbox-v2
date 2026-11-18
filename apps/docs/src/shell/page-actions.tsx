import type { ManifestPage } from "@matchbox/docs/manifest"
import { CopyStatus, useCopy } from "@matchbox/ui/copy"
import { Pop } from "@matchbox/ui/floating"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as Toc from "@matchbox/ui/toc"
import { type ReactNode, Suspense, useEffect, useState } from "react"
import { usePage } from "../content/page-data"
import { askAboutPage, warmAsk } from "./ask"
import { DogDisc } from "./dog"

/**
 * A page's actions in header row 1 (layout v2, Doop `rdTgFW46zL`): On this
 * page as a list button below 1280, Copy, Edit and Ask about this page.
 * Buttons are 40 with 10 between them.
 */

export const iconButton =
  "grid size-10 flex-none cursor-pointer place-items-center rounded-full bg-soft text-ink2 outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink aria-expanded:bg-soft2 aria-expanded:text-ink"

export function CopyPage({
  path,
  compact,
}: {
  path: string
  compact: boolean
}): ReactNode {
  const [text, setText] = useState<string | null>(null)
  const { state, copy } = useCopy(text ?? "")
  async function onCopy(): Promise<void> {
    if (text !== null) {
      await copy()
      return
    }
    const response = await fetch(`${path === "/" ? "/index" : path}.md`)
    const body = response.ok ? await response.text() : ""
    setText(body)
    await navigator.clipboard?.writeText(body).catch(() => undefined)
  }
  return (
    <>
      <button
        type="button"
        onClick={() => void onCopy()}
        aria-label="Copy page as Markdown"
        title="Copy page as Markdown"
        className={
          compact
            ? iconButton
            : "flex h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-3xl bg-soft text-[15px] font-semibold text-ink outline-none focus-visible:outline-2 focus-visible:outline-ink [@media(scripting:none)]:hidden"
        }
      >
        <Glyph
          shape={state === "copied" ? shapes.check : shapes.copy}
          size={18}
          strokeWidth={1.75}
        />
        {compact ? null : "Copy page"}
      </button>
      <CopyStatus state={state} />
    </>
  )
}

/** The page's headings, read from its chunk, which has loaded by now. */
function Outline({
  path,
  onPick,
}: {
  path: string
  onPick: () => void
}): ReactNode {
  const data = usePage(path)
  const active = Toc.useActiveHeading(data.toc.map((item) => item.id))
  // Choosing a heading scrolls to it, so the popover gets out of the way.
  useEffect(() => {
    window.addEventListener("hashchange", onPick)
    return () => window.removeEventListener("hashchange", onPick)
  }, [onPick])
  return <Toc.Root items={data.toc} active={active} />
}

function OutlineButton({ path }: { path: string }): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <Pop
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="xl:hidden"
      contentClassName="w-[264px]! px-4 pt-2 pb-3"
      trigger={(props) => (
        <button
          type="button"
          aria-label="On this page"
          title="On this page"
          className={iconButton}
          {...props}
        >
          <Glyph shape={shapes.list} size={18} strokeWidth={1.75} />
        </button>
      )}
      content={
        <Suspense fallback={null}>
          <Outline path={path} onPick={() => setOpen(false)} />
        </Suspense>
      }
    />
  )
}

export function PageActions({ page }: { page: ManifestPage }): ReactNode {
  const outline =
    page.outline && page.kind !== "operation" && page.kind !== "tool"
  return (
    <>
      {outline ? <OutlineButton path={page.path} /> : null}
      <CopyPage path={page.path} compact />
      {page.source === null ? null : (
        <a
          href={page.source}
          aria-label="Edit on GitHub"
          title="Edit on GitHub"
          className={iconButton}
        >
          <Glyph shape={shapes.pencil} size={17} strokeWidth={1.75} />
        </a>
      )}
      <button
        type="button"
        onClick={() => askAboutPage(page.path, page.title)}
        onPointerEnter={warmAsk}
        onFocus={warmAsk}
        aria-haspopup="dialog"
        className="flex h-10 flex-none cursor-pointer items-center gap-2.5 rounded-[20px] bg-acc-soft pr-4 pl-1.5 text-[15px] font-semibold whitespace-nowrap text-acc-ink outline-none focus-visible:outline-2 focus-visible:outline-ink"
      >
        <DogDisc
          size={30}
          className="bg-bg text-ink dark:bg-bg dark:text-ink"
        />
        Ask about this page
      </button>
    </>
  )
}
