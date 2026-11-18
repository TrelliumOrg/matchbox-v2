import type { SearchHit, SearchIndex } from "@matchbox/docs/search"
import { type SectionId, sectionById } from "@matchbox/docs/site"
import { Glyph, shapes } from "@matchbox/ui/icons"
import { Kbd } from "@matchbox/ui/kbd"
import { useNavigate } from "@tanstack/react-router"
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import { DogDisc } from "../shell/dog"
import { loadIndex, searchIndex } from "./load-index"

/**
 * Search (Doop `EMb6_Pw0Xs`, `hp3xD9zXjV`, phone `GNwHBuzh0g`): a centred
 * palette on the native modal dialog. Results group by section with a
 * coloured mark, headings show as # rows, the last row asks Stuart.
 * Arrow keys move, Enter opens, Escape closes. Opened with nothing typed it
 * lists recent pages. Loaded on intent; the index loads with it.
 */

const recentKey = "mbx-docs-recent"

type Recent = { u: string; t: string; s: SectionId }

function readRecent(): Recent[] {
  try {
    const raw: unknown = JSON.parse(
      window.localStorage.getItem(recentKey) ?? "[]",
    )
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (item): item is Recent =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Recent).u === "string" &&
        typeof (item as Recent).t === "string" &&
        typeof (item as Recent).s === "string",
    )
  } catch {
    return []
  }
}

function remember(item: Recent): void {
  try {
    const next = [
      item,
      ...readRecent().filter((old) => old.u !== item.u),
    ].slice(0, 5)
    window.localStorage.setItem(recentKey, JSON.stringify(next))
  } catch {
    // Recent pages are a convenience.
  }
}

const sectionMark: Record<SectionId, string> = {
  home: "bg-ink",
  concepts: "bg-ink2",
  pro: "bg-mezo",
  scan: "bg-acc",
  id: "bg-ink",
  developer: "bg-ink2",
  stuart: "bg-acc",
}

/** Stuart lives in Pro; the docs cannot host its panel yet. */
function stuartUrl(question: string): string {
  return question === ""
    ? "https://pro.matchbox.markets"
    : "https://pro.matchbox.markets"
}

type Row =
  | { kind: "hit"; hit: SearchHit }
  | { kind: "recent"; item: Recent }
  | { kind: "stuart" }

export default function SearchPalette({
  open,
  initial,
  onClose,
}: {
  open: boolean
  initial: string
  onClose: () => void
}): ReactNode {
  const dialog = useRef<HTMLDialogElement | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState(initial)
  const [index, setIndex] = useState<SearchIndex | null>(null)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(0)
  const [recent, setRecent] = useState<Recent[]>([])
  const navigate = useNavigate()
  const listId = useId()

  useEffect(() => {
    loadIndex()
      .then(setIndex)
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    const element = dialog.current
    if (element === null) return
    if (open && !element.open) {
      setQuery(initial)
      setActive(0)
      setRecent(readRecent())
      element.showModal()
      input.current?.select()
    }
    if (!open && element.open) element.close()
  }, [open, initial])

  const hits = useMemo(
    () =>
      index === null || query.trim() === ""
        ? []
        : searchIndex(index, query, 12),
    [index, query],
  )

  const rows: Row[] = useMemo(() => {
    const out: Row[] =
      query.trim() === ""
        ? recent.map((item) => ({ kind: "recent", item }))
        : hits.map((hit) => ({ kind: "hit", hit }))
    out.push({ kind: "stuart" })
    return out
  }, [hits, recent, query])

  function go(row: Row): void {
    onClose()
    if (row.kind === "stuart") {
      window.location.href = stuartUrl(query)
      return
    }
    const target = row.kind === "hit" ? row.hit.entry : row.item
    remember({
      u: target.u.split("#")[0] ?? target.u,
      t:
        row.kind === "hit" && row.hit.entry.k === "heading"
          ? row.hit.entry.p
          : target.t,
      s: target.s,
    })
    const [path = "/", hash] = target.u.split("#")
    const withHash = hash === undefined ? {} : { hash }
    if (path === "/") void navigate({ to: "/", ...withHash })
    else
      void navigate({
        to: "/$",
        params: { _splat: path.slice(1) },
        ...withHash,
      })
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((value) => Math.min(rows.length - 1, value + 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((value) => Math.max(0, value - 1))
    } else if (event.key === "Enter") {
      event.preventDefault()
      const row = rows[active]
      if (row !== undefined) go(row)
    } else if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault()
      setActive(rows.length - 1)
    }
  }

  let lastSection: SectionId | null = null
  const results = rows.map((row, position) => {
    const id = `${listId}-${position}`
    const selected = position === active
    const base = `flex w-full cursor-pointer items-center gap-3 rounded-[16px] px-2.5 py-2 text-left ${selected ? "bg-soft" : ""}`
    if (row.kind === "stuart") {
      return (
        <li key="stuart" role="none" className="mt-1 border-t border-line pt-1">
          <a
            id={id}
            role="option"
            aria-selected={selected}
            href={stuartUrl(query)}
            onMouseEnter={() => setActive(position)}
            className={base}
          >
            <DogDisc size={40} className="bg-bg" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15.5px] font-semibold text-ink">
                Ask Stuart in Pro
              </span>
              <span className="block truncate text-[14px] text-sec">
                {query.trim() === "" ? "pro.matchbox.markets" : query}
              </span>
            </span>
            <Glyph
              shape={shapes.arrowUpRight}
              size={18}
              strokeWidth={1.75}
              className="text-sec"
            />
          </a>
        </li>
      )
    }
    const entry =
      row.kind === "hit"
        ? row.hit.entry
        : {
            u: row.item.u,
            t: row.item.t,
            p: sectionById(row.item.s).name,
            s: row.item.s,
            k: "page" as const,
            x: "",
          }
    const heading =
      row.kind === "hit" && entry.s !== lastSection ? (
        <li
          key={`section-${entry.u}`}
          role="presentation"
          className="flex items-center gap-2 px-2.5 pt-2.5 pb-1 text-[13.5px] text-sec"
        >
          <span
            aria-hidden="true"
            className={`size-2.5 rounded-[3px] ${sectionMark[entry.s]}`}
          />
          {sectionById(entry.s).name}
        </li>
      ) : null
    if (row.kind === "hit") lastSection = entry.s
    const icon =
      row.kind === "recent"
        ? shapes.history
        : entry.k === "heading"
          ? shapes.hash
          : entry.k === "tool"
            ? shapes.wrench
            : entry.k === "operation"
              ? shapes.codeXml
              : shapes.fileText
    return [
      heading,
      <li key={entry.u} role="none">
        <button
          type="button"
          id={id}
          role="option"
          aria-selected={selected}
          tabIndex={-1}
          onClick={() => go(row)}
          onMouseEnter={() => setActive(position)}
          className={base}
        >
          <span
            aria-hidden="true"
            className="grid size-10 flex-none place-items-center rounded-full bg-soft text-ink2"
          >
            <Glyph shape={icon} size={18} strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={`block truncate text-[15.5px] font-semibold text-ink ${entry.k === "tool" ? "font-mono text-[14.5px]" : ""}`}
            >
              {entry.t}
            </span>
            <span className="block truncate text-[14px] text-sec">
              {entry.k === "heading"
                ? `${entry.p}, ${entry.x}`
                : row.kind === "recent"
                  ? entry.p
                  : entry.x === ""
                    ? entry.p
                    : entry.x}
            </span>
          </span>
          {selected ? (
            <span
              aria-hidden="true"
              className="hidden [@media(pointer:fine)]:contents"
            >
              <Kbd keys={["enter"]} />
            </span>
          ) : null}
        </button>
      </li>,
    ]
  })

  const count = hits.filter((hit) => hit.entry.k !== "heading").length
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a click on the scrim closes it; Escape closes the native dialog
    <dialog
      ref={dialog}
      aria-label="Search docs"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="m-auto mt-[12vh] w-[680px] max-w-[calc(100vw-24px)] overflow-hidden rounded-[28px] bg-sheet p-0 text-ink shadow-[0_0_0_1px_var(--line),var(--lift)] outline-none backdrop:bg-scrim max-sm:mt-3 max-sm:mb-auto"
    >
      <div className="flex max-h-[min(640px,80dvh)] flex-col-reverse">
        <div className="flex h-[62px] flex-none items-center gap-3 border-t border-line px-3">
          <DogDisc size={38} className="bg-soft" />
          <input
            ref={input}
            type="text"
            enterKeyHint="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={`${listId}-${active}`}
            aria-label="Ask Stuart or search docs"
            placeholder="Ask Stuart or search docs"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            className="h-full min-w-0 flex-1 bg-transparent text-[17px] text-ink caret-acc outline-none placeholder:text-sec [&::-webkit-search-cancel-button]:hidden"
          />
          {query.trim() === "" ? null : (
            <span className="text-[14px] text-sec" aria-live="polite">
              {count} {count === 1 ? "page" : "pages"}
            </span>
          )}
          {/* Key caps only with a fine pointer: a phone has no Escape
              key, so there the close control is a cross. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-tap=""
            className="grid cursor-pointer place-items-center rounded-md text-sec outline-none focus-visible:outline-2 focus-visible:outline-ink"
          >
            <span className="hidden [@media(pointer:fine)]:contents">
              <Kbd keys={["esc"]} />
            </span>
            <span className="contents [@media(pointer:fine)]:hidden">
              <Glyph shape={shapes.x} size={20} strokeWidth={1.9} />
            </span>
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto p-2.5">
          {failed ? (
            <p className="px-3 py-6 text-center text-[15px] text-sec">
              Search unavailable
            </p>
          ) : query.trim() !== "" && index !== null && hits.length === 0 ? (
            <div className="px-3 pt-5 pb-3 text-center">
              <p className="text-[16px] text-ink2">
                No pages for {query.trim()}
              </p>
            </div>
          ) : query.trim() === "" && recent.length > 0 ? (
            <p className="px-2.5 pt-1.5 pb-1 text-[13.5px] text-sec">Recent</p>
          ) : null}
          {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the combobox's listbox, options are its items */}
          <ul id={listId} role="listbox" aria-label="Results">
            {results}
          </ul>
        </div>
      </div>
      <div className="flex h-11 items-center gap-5 bg-soft px-5 text-[13.5px] text-sec max-sm:hidden">
        <span className="flex items-center gap-1.5">
          <Kbd keys={["up", "down"]} /> Navigate
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd keys={["enter"]} /> Open
        </span>
        <span className="ml-auto">All of Matchbox docs</span>
      </div>
    </dialog>
  )
}
