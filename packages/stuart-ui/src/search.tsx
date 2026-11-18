import { matchCommands, type SearchCommand } from "./commands"
import "./search.css"
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import { trimEndpoint } from "./client"
import {
  type GaugeKind,
  type SearchResult,
  STUART_PATHS,
  searchResponseSchema,
} from "./contract"
import { GaugeMark } from "./gauge-mark"
import { Glyph } from "./icons"
import { useKeyboardInset } from "./keyboard-inset"
import { KindIcon } from "./kind-icon"
import { StuartBadge } from "./mark"
import { pastedValue } from "./paste"
import { usePresence } from "./presence"

/**
 * The Ctrl K bar's results: "Ask Stuart" first, then gauges, wallets and
 * transactions from the Worker's GET /search. Loaded on intent, never on
 * first paint. The bar's input keeps the keyboard (combobox); this list
 * answers through `controller`. Debounced 150ms, aborted when the query
 * changes, nothing fetched for an empty box, and no timer runs while idle.
 */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; results: SearchResult[] }

export type SearchController = {
  /** True when the list handled the key (arrows, Enter, Escape). */
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => boolean
}

const debounceMs = 150

// The Epoch 47 demo, for hosts without a Worker (local dev, tests).
const fixtureGauges: SearchResult[] = [
  {
    type: "gauge",
    id: "gauge-0x449b06b9b6c9b649b610105d1a5e337e1d6d3d1e",
    address: "0x449b06b9b6c9b649b610105d1a5e337e1d6d3d1e",
    name: "SNF",
    kind: "vebtc",
    tokenId: "6033",
    picture: null,
    detail: "$328.82 this epoch",
  },
  {
    type: "gauge",
    id: "gauge-0xa8c1261a15bc5be768f4a35453e6b59016a6c8f4",
    address: "0xa8c1261a15bc5be768f4a35453e6b59016a6c8f4",
    name: "veBTC #5910",
    kind: "vebtc",
    tokenId: "5910",
    picture: null,
    detail: "$20.55 this epoch",
  },
  {
    type: "gauge",
    id: "gauge-0x5d0b0e1e6b7d1f5c3c4f8e2a9b0c1d2e3f4a5b6c",
    address: "0x5d0b0e1e6b7d1f5c3c4f8e2a9b0c1d2e3f4a5b6c",
    name: "ChooseMe",
    kind: "validator",
    tokenId: null,
    picture: null,
    detail: "$61.65 this epoch",
  },
  {
    type: "gauge",
    id: "gauge-0x21d7acb0d128fa039064b6ace8db88c0ade0209e",
    address: "0x21d7acb0d128fa039064b6ace8db88c0ade0209e",
    name: "sMUSD",
    kind: "pool",
    tokenId: null,
    picture: null,
    detail: "$10,000.00 this epoch",
  },
]

/** The demo answer for `query`, shaped like the Worker's. */
export function fixtureSearch(query: string): SearchResult[] {
  const text = query.trim().toLowerCase()
  if (text === "") return []
  if (/^0x[0-9a-f]{64}$/.test(text)) {
    return [
      {
        type: "transaction",
        id: `tx-${text}`,
        hash: text,
        url: `https://scan.matchbox.markets/tx/${text}`,
      },
    ]
  }
  if (/^0x[0-9a-f]{40}$/.test(text)) {
    return [
      { type: "wallet", id: `wallet-${text}`, address: text, mezoId: null },
    ]
  }
  const wallets: SearchResult[] =
    text === "pyke.mezo"
      ? [
          {
            type: "wallet",
            id: "wallet-pyke",
            address: "0x5959000000000000000000000000000000000965",
            mezoId: "pyke.mezo",
          },
        ]
      : []
  return [
    ...fixtureGauges.filter(
      (gauge) =>
        gauge.type === "gauge" &&
        (gauge.name.toLowerCase().includes(text) ||
          gauge.address.startsWith(text) ||
          (gauge.tokenId !== null && `#${gauge.tokenId}`.includes(text))),
    ),
    ...wallets,
  ]
}

export async function fetchSearch(input: {
  endpoint: string | null
  query: string
  signal: AbortSignal
  fetcher?: FetchLike
}): Promise<SearchResult[]> {
  if (input.endpoint === null || input.endpoint === "") {
    return fixtureSearch(input.query)
  }
  const fetcher = input.fetcher ?? ((url, init) => fetch(url, init))
  const url = `${trimEndpoint(input.endpoint)}${STUART_PATHS.search}?q=${encodeURIComponent(input.query.trim())}`
  const response = await fetcher(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: input.signal,
  })
  if (!response.ok) return []
  const parsed = searchResponseSchema.safeParse(await response.json())
  return parsed.success ? parsed.data.results : []
}

/** Debounced, abortable search for `query`; idle for an empty box. */
export function useSearch(
  endpoint: string | null,
  query: string,
  fetcher?: FetchLike,
): SearchState {
  const [state, setState] = useState<SearchState>({ kind: "idle" })
  const text = query.trim()
  useEffect(() => {
    if (text === "") {
      setState({ kind: "idle" })
      return
    }
    const controller = new AbortController()
    setState((current) =>
      current.kind === "done" ? current : { kind: "loading" },
    )
    const timer = setTimeout(() => {
      fetchSearch({
        endpoint,
        query: text,
        signal: controller.signal,
        ...(fetcher === undefined ? {} : { fetcher }),
      })
        .then((results) => {
          if (!controller.signal.aborted) setState({ kind: "done", results })
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setState({ kind: "done", results: [] })
        })
    }, debounceMs)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [endpoint, text, fetcher])
  return state
}

export type SearchRow =
  | { kind: "ask"; id: string; question: string }
  | { kind: "command"; id: string; command: SearchCommand }
  | { kind: "result"; id: string; result: SearchResult }

export function rowsFor(query: string, state: SearchState): SearchRow[] {
  const question = query.trim()
  if (question === "") return []
  const results = state.kind === "done" ? state.results : []
  return [
    // The app's own tools first: they answer at once, with no request.
    ...matchCommands(question).map(
      (command): SearchRow => ({
        kind: "command",
        id: `command-${command.id}`,
        command,
      }),
    ),
    { kind: "ask", id: "ask", question },
    ...results.map(
      (result): SearchRow => ({ kind: "result", id: result.id, result }),
    ),
  ]
}

const groupLabel: Record<SearchResult["type"], string> = {
  gauge: "Gauges",
  wallet: "Wallets",
  transaction: "Transactions",
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** Where a result goes in the host app; transactions open Matchscan. */
export function destinationOf(
  result: SearchResult,
): { kind: "app"; to: string } | { kind: "external"; url: string } {
  switch (result.type) {
    case "gauge":
      return { kind: "app", to: `/gauges/${result.address}` }
    case "wallet":
      return {
        kind: "app",
        to: `/?address=${encodeURIComponent(result.address)}`,
      }
    case "transaction":
      return { kind: "external", url: result.url }
  }
}

function ResultBody({ result }: { result: SearchResult }): ReactNode {
  switch (result.type) {
    case "gauge":
      return (
        <>
          <GaugeMark
            picture={result.picture}
            address={result.address}
            name={result.name}
            size={32}
          />
          <span className="stuart-search-text">
            <span className="stuart-search-title">
              {result.name}
              {result.tokenId === null ||
              result.name.includes(result.tokenId) ? null : (
                <span className="stuart-search-id">#{result.tokenId}</span>
              )}
              <KindIcon kind={result.kind as GaugeKind} />
            </span>
            <span className="stuart-search-sub">{result.detail}</span>
          </span>
        </>
      )
    case "wallet":
      return (
        <>
          <span className="stuart-search-icon" aria-hidden="true">
            <Glyph name="wallet" size={18} />
          </span>
          <span className="stuart-search-text">
            <span className="stuart-search-title">
              {result.mezoId ?? shortAddress(result.address)}
            </span>
            <span className="stuart-search-sub stuart-mono">
              {shortAddress(result.address)}
            </span>
          </span>
        </>
      )
    case "transaction":
      return (
        <>
          <span className="stuart-search-icon" aria-hidden="true">
            <Glyph name="receipt" size={18} />
          </span>
          <span className="stuart-search-text">
            <span className="stuart-search-title stuart-mono">
              {shortAddress(result.hash)}
            </span>
            <span className="stuart-search-sub">View on Matchscan</span>
          </span>
        </>
      )
  }
}

export type SearchResultsProps = {
  endpoint: string | null
  query: string
  /** Drives the grow and the mirrored shrink. */
  open: boolean
  listId: string
  controller: RefObject<SearchController | null>
  onActiveChange: (id: string | null) => void
  onAsk: (question: string) => void
  onNavigate: (to: string) => void
  /** After a row was chosen, or Escape: the bar clears and blurs. */
  onDone: () => void
  variant?: "bar" | "sheet"
  fetcher?: FetchLike
}

export function SearchResults({
  endpoint,
  query,
  open,
  listId,
  controller,
  onActiveChange,
  onAsk,
  onNavigate,
  onDone,
  variant = "bar",
  fetcher,
}: SearchResultsProps): ReactNode {
  const state = useSearch(endpoint, query, fetcher)
  const rows = rowsFor(query, state)
  const [active, setActive] = useState(0)
  const showing = open && rows.length > 0
  const presence = usePresence(showing, 180)
  const current = rows[Math.min(active, rows.length - 1)]
  const activeId = current === undefined ? null : `${listId}-${current.id}`

  // A new query starts at the top (state reset during render, no effect).
  const [seenQuery, setSeenQuery] = useState(query)
  if (seenQuery !== query) {
    setSeenQuery(query)
    setActive(0)
  }
  useEffect(
    () => onActiveChange(showing ? activeId : null),
    [activeId, showing, onActiveChange],
  )

  function choose(row: SearchRow | undefined): void {
    if (row === undefined) return
    if (row.kind === "ask") {
      onAsk(row.question)
    } else if (row.kind === "command") {
      onNavigate(row.command.to)
    } else {
      const destination = destinationOf(row.result)
      if (destination.kind === "app") onNavigate(destination.to)
      else window.open(destination.url, "_blank", "noopener,noreferrer")
    }
    onDone()
  }

  const latest = useRef({ rows, current, choose })
  latest.current = { rows, current, choose }
  useEffect(() => {
    controller.current = {
      onKeyDown(event) {
        const { rows: list, current: row, choose: pick } = latest.current
        if (event.key === "Escape") {
          onDone()
          return true
        }
        if (list.length === 0) return false
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault()
          const step = event.key === "ArrowDown" ? 1 : -1
          setActive((index) => (index + step + list.length) % list.length)
          return true
        }
        if (event.key === "Enter") {
          event.preventDefault()
          pick(row)
          return true
        }
        return false
      },
    }
    return () => {
      controller.current = null
    }
  }, [controller, onDone])

  if (!presence.mounted) return null
  const shown = rows.length > 0 ? rows : []
  let lastGroup: string | null = null
  return (
    <div
      className={`stuart-search stuart-search-${variant}`}
      data-state={presence.state}
      data-mbx-motion=""
    >
      <div
        id={listId}
        role="listbox"
        aria-label="Search results"
        className="stuart-search-list"
      >
        {shown.map((row, index) => {
          const selected = row === current
          const group =
            row.kind === "result"
              ? groupLabel[row.result.type]
              : row.kind === "command"
                ? (row.command.group ?? null)
                : null
          const heading =
            group !== null && group !== lastGroup ? (
              <p className="stuart-search-group" role="presentation">
                {group}
              </p>
            ) : null
          if (group !== null) lastGroup = group
          return (
            <div key={row.id} role="presentation">
              {heading}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: the input owns the keyboard (combobox) */}
              <div
                id={`${listId}-${row.id}`}
                role="option"
                tabIndex={-1}
                aria-selected={selected}
                className="stuart-search-row"
                onPointerMove={() => setActive(index)}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(row)}
              >
                {row.kind === "ask" ? (
                  <>
                    <StuartBadge size={32} />
                    <span className="stuart-search-text">
                      <span className="stuart-search-title">Ask Stuart</span>
                      <span className="stuart-search-sub">{row.question}</span>
                    </span>
                    <Glyph name="arrow-right" size={16} />
                  </>
                ) : row.kind === "command" ? (
                  <>
                    <span className="stuart-search-text">
                      <span className="stuart-search-title">
                        {row.command.label}
                      </span>
                      <span className="stuart-search-sub">
                        {row.command.hint}
                      </span>
                    </span>
                    <Glyph name="arrow-right" size={16} />
                  </>
                ) : (
                  <ResultBody result={row.result} />
                )}
              </div>
            </div>
          )
        })}
        {state.kind === "loading" ? (
          <p className="stuart-search-group" role="presentation">
            Searching
          </p>
        ) : null}
      </div>
    </div>
  )
}

SearchResults.displayName = "Stuart.SearchResults"

/**
 * Phones: the top bar's search icon opens this bottom sheet, its own input
 * on top and the same results below. Escape or the scrim closes it.
 */
export function SearchSheet({
  endpoint,
  open,
  onAsk,
  onNavigate,
  onClose,
  fetcher,
}: {
  endpoint: string | null
  open: boolean
  onAsk: (question: string) => void
  onNavigate: (to: string) => void
  onClose: () => void
  fetcher?: FetchLike
}): ReactNode {
  const presence = usePresence(open, 240)
  // The results sit under the field: keep the sheet above the keyboard.
  useKeyboardInset(open)
  const [query, setQuery] = useState("")
  const [activeId, setActiveId] = useState<string | null>(null)
  const controller = useRef<SearchController | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    setQuery("")
    requestAnimationFrame(() => input.current?.focus())
  }, [open])

  if (!presence.mounted) return null
  return (
    <>
      <button
        type="button"
        className="stuart-search-scrim"
        data-state={presence.state}
        aria-label="Close search"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="stuart-search-phone"
        data-state={presence.state}
        data-mbx-motion=""
      >
        <div className="stuart-search-field">
          <StuartBadge size={32} />
          <input
            ref={input}
            role="combobox"
            aria-expanded={query.trim() !== ""}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId ?? undefined}
            aria-label="Ask Stuart or search"
            placeholder="Ask Stuart or search"
            autoComplete="off"
            enterKeyHint="search"
            maxLength={2_000}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onPaste={(event) => {
              const next = pastedValue({
                value: query,
                pasted: event.clipboardData.getData("text"),
                start: event.currentTarget.selectionStart,
                end: event.currentTarget.selectionEnd,
                max: 2_000,
              })
              if (next === null) return
              event.preventDefault()
              setQuery(next)
            }}
            onKeyDown={(event) => {
              if (controller.current?.onKeyDown(event) === true) return
              if (event.key === "Escape") onClose()
              if (event.key === "Enter" && query.trim() !== "") {
                event.preventDefault()
                onAsk(query.trim())
                onClose()
              }
            }}
          />
        </div>
        <SearchResults
          endpoint={endpoint}
          query={query}
          open={open}
          listId={listId}
          controller={controller}
          onActiveChange={setActiveId}
          onAsk={onAsk}
          onNavigate={onNavigate}
          onDone={onClose}
          variant="sheet"
          {...(fetcher === undefined ? {} : { fetcher })}
        />
      </div>
    </>
  )
}

SearchSheet.displayName = "Stuart.SearchSheet"
