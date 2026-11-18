import { useLive } from "@matchbox/live/context"
import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import { Kbd } from "@matchbox/ui/kbd"
import { useRouter } from "@tanstack/react-router"
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import type { SearchHit } from "../data/search"
import { useChainClock } from "../data/shell-context"
import {
  maxQueryLength,
  type SearchTarget,
  targetLabel,
  targetPath,
} from "./detect"
import {
  type Group,
  mezoIdOptions,
  type Option,
  PaletteRow,
} from "./palette-row"
import { closeSearch, setPaletteMounted } from "./search-store"
import { useDetect } from "./use-detect"
import { useMezoIdSearch } from "./use-mezo-id-search"
import { type RemoteSearch, useRemoteSearch } from "./use-remote-search"

/**
 * The search palette (`geYXFRMGVg`): a centred modal over a scrim, the
 * input on top, results grouped below, key hints in the footer. Results
 * come from the query's shape (in the browser), our labels, gauge names,
 * epochs and locks (`/internal/scan/search`), a Mezo ID's wallets or a
 * Bitcoin address's EVM address (or that Mezo has no account for it), and
 * Blockscout's quick search only when ours has nothing, debounced. Groups
 * as designed:
 * Gauges, Addresses with their tag, Transactions, Jump to. A native modal
 * dialog, so focus stays inside, Escape closes and the page behind is
 * inert.
 */

const icons: Record<SearchTarget["kind"], GlyphShape> = {
  tx: shapes.arrowRight,
  "block-hash": shapes.box,
  address: shapes.wallet,
  block: shapes.box,
  epoch: shapes.calendarDays,
  lock: shapes.lock,
}

const hitIcons: Record<SearchHit["icon"], GlyphShape> = {
  gauge: shapes.vote,
  token: shapes.coins,
  address: shapes.wallet,
  contract: shapes.braces,
  transaction: shapes.arrowRight,
  block: shapes.box,
  epoch: shapes.calendarDays,
  lock: shapes.lock,
  pool: shapes.droplets,
}

function shapeOption(target: SearchTarget): Option {
  const label = targetLabel(target)
  return {
    key: `shape:${targetPath(target)}`,
    path: targetPath(target),
    title: label.title,
    detail: label.detail,
    lead: { kind: "glyph", shape: icons[target.kind] },
    mark: null,
    untrusted: false,
    tag: null,
    group: "jump",
  }
}

function hitOption(hit: SearchHit): Option {
  return {
    key: `remote:${hit.path}:${hit.title}`,
    path: hit.path,
    title: hit.title,
    detail: hit.detail,
    lead: { kind: "glyph", shape: hitIcons[hit.icon] },
    mark: null,
    untrusted: hit.untrusted,
    tag: hit.tag,
    group: hit.group,
  }
}

const remoteNote: Partial<Record<RemoteSearch["status"], string>> = {
  loading: "Searching",
  failed: "Search unavailable",
  limited: "Busy, try again",
}

const groups: readonly Group[] = ["gauges", "addresses", "transactions", "jump"]

const groupName: Record<Group, string> = {
  gauges: "Gauges",
  addresses: "Addresses",
  transactions: "Transactions",
  jump: "Jump to",
}

export default function SearchPalette({
  initialQuery,
}: {
  initialQuery: string
}): ReactNode {
  const router = useRouter()
  const { epoch } = useChainClock()
  const { store } = useLive()
  const dialog = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState(initialQuery)
  const [active, setActive] = useState(0)
  const listId = useId()
  const optionId = (index: number): string => `${listId}-${index}`

  const shapeResults = useDetect(query, store, epoch.number)
  const remote = useRemoteSearch(query)
  const mezoId = useMezoIdSearch(query)
  // A Mezo ID's wallet first: its row wins over a label for the same page.
  const unordered: Option[] = [
    ...mezoIdOptions(mezoId.match),
    ...remote.hits.map(hitOption),
    ...shapeResults.map(shapeOption),
  ]
  // Keyboard order follows the groups as drawn.
  const seen = new Set<string>()
  const results = groups.flatMap((group) =>
    unordered.filter((option) => {
      if (option.group !== group || seen.has(option.path)) return false
      seen.add(option.path)
      return true
    }),
  )
  const selected = Math.min(active, Math.max(0, results.length - 1))
  const trimmed = query.trim()

  useEffect(() => {
    const element = dialog.current
    if (element === null) return
    if (!element.open) element.showModal()
    setPaletteMounted(true)
    return () => {
      setPaletteMounted(false)
      element.close()
    }
  }, [])

  function go(option: Option | undefined): void {
    if (option === undefined) return
    closeSearch()
    void router.navigate({ to: option.path })
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (results.length === 0) return
      const step = event.key === "ArrowDown" ? 1 : -1
      setActive((selected + step + results.length) % results.length)
    } else if (event.key === "Enter") {
      event.preventDefault()
      go(results[selected])
    }
  }

  // A Bitcoin address Mezo has no account for says so; other misses are
  // quiet.
  const noAccount = mezoId.match !== null && mezoId.match.wallets.length === 0
  const note = noAccount
    ? "No Mezo account for this Bitcoin address"
    : (remoteNote[remote.status] ??
      (mezoId.status === "loading" ? remoteNote.loading : undefined))
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the native dialog; the click is the scrim's
    <dialog
      ref={dialog}
      data-search-palette=""
      aria-label="Search"
      onClose={closeSearch}
      onClick={(event) => {
        // A click on the scrim (the dialog box itself) closes.
        if (event.target === event.currentTarget) closeSearch()
      }}
      className="m-0 mx-auto mt-24 w-[min(680px,calc(100vw-32px))] max-w-none overflow-hidden rounded-[24px] bg-raised p-0 text-ink shadow-pop max-md:mt-4"
    >
      <div className="flex h-16 items-center gap-3 border-b border-line px-6">
        <Glyph shape={shapes.search} size={20} strokeWidth={1.9} />
        <input
          autoFocus
          type="text"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            results.length > 0 ? optionId(selected) : undefined
          }
          aria-label="Search"
          spellCheck={false}
          maxLength={maxQueryLength}
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Address, Mezo ID, transaction, block, epoch or lock"
          className="min-w-0 flex-1 bg-transparent text-[17px] text-ink caret-acc outline-none placeholder:text-sec"
        />
        {trimmed === "" || results.length === 0 ? null : (
          <span className="flex-none text-[14.5px] text-sec tabular-nums">
            {results.length === 1 ? "1 match" : `${results.length} matches`}
          </span>
        )}
        {/* Key caps only with a fine pointer: a phone has no Escape key,
            so there the close control is a cross with a 44px hit area. */}
        <button
          type="button"
          onClick={closeSearch}
          data-tap=""
          className="grid cursor-pointer place-items-center rounded-md text-sec outline-none focus-visible:outline-2 focus-visible:outline-ink"
          aria-label="Close search"
        >
          <span className="hidden [@media(pointer:fine)]:contents">
            <Kbd keys={["esc"]} />
          </span>
          <span className="contents [@media(pointer:fine)]:hidden">
            <Glyph shape={shapes.x} size={20} strokeWidth={1.9} />
          </span>
        </button>
      </div>
      <div className="max-h-[min(440px,60dvh)] overflow-y-auto px-2.5 py-3">
        {trimmed === "" ? (
          <p className="px-3.5 py-2 text-[14.5px] text-sec">
            Hash, address, Mezo ID, Bitcoin address, block, epoch, lock or token
          </p>
        ) : (
          <>
            <div
              id={listId}
              role="listbox"
              aria-label="Results"
              className="flex flex-col"
            >
              {groups.map((group) => {
                const rows = results
                  .map((option, index) => ({ option, index }))
                  .filter(({ option }) => option.group === group)
                if (rows.length === 0) return null
                return (
                  // biome-ignore lint/a11y/useSemanticElements: a listbox's option group (ARIA), not a form fieldset
                  <div key={group} role="group" aria-label={groupName[group]}>
                    <p
                      aria-hidden="true"
                      className="px-3.5 pt-1 pb-1.5 text-[14px] text-sec"
                    >
                      {groupName[group]}
                    </p>
                    {rows.map(({ option, index }) => (
                      <PaletteRow
                        key={option.key}
                        option={option}
                        id={optionId(index)}
                        active={index === selected}
                        onActivate={() => setActive(index)}
                        onChoose={() => go(option)}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
            {results.length === 0 && note === undefined ? (
              <p className="px-3.5 py-2 text-[15px] text-sec">No match</p>
            ) : null}
            <p className="px-3.5 py-2 text-[14.5px] text-sec" role="status">
              {note ?? ""}
            </p>
          </>
        )}
      </div>
      <div className="flex h-14 items-center gap-2 border-t border-line px-6 text-[14px] text-sec max-md:hidden">
        <Kbd keys={["up"]} />
        <Kbd keys={["down"]} />
        <span className="mr-3">Navigate</span>
        <Kbd keys={["enter"]} />
        <span className="mr-3">Open</span>
        <Kbd keys={["esc"]} />
        <span>Close</span>
      </div>
    </dialog>
  )
}
