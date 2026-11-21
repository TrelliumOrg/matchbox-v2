import {
  barId,
  barInputId,
  openStuartSearch,
  StuartBadge,
  warmStuart,
} from "@matchbox/stuart-ui/launcher"
import { pastedValue } from "@matchbox/stuart-ui/paste"
import type { SearchController } from "@matchbox/stuart-ui/search"
import { Kbd } from "@matchbox/ui/kbd"
import { useRouter } from "@tanstack/react-router"
import {
  type KeyboardEvent,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { useLockCommands } from "./lock-commands"
import { stuartEndpoint, stuartNavigate } from "./navigate"

/**
 * Stuart's Ctrl K bar (matchbox-v3, Decided 9 Nov 2026; gJhizhjZi1): bottom
 * centre of the content column, 600 x 54, the dog, "Ask Stuart or search
 * gauges, wallets, txs" and the OS key caps chosen on the server. It is the
 * real input: typing shows results growing up from it, Enter on a question
 * asks Stuart and opens the docked panel, which grows out of the bar.
 *
 * First paint is this module, the badge, Kbd and the store core. The
 * results sheet, the search client and zod load on intent (hover, focus,
 * touch, Ctrl K); the panel loads through the mount's panel loader.
 * Phones hide the bar: the top bar's search icon opens the sheet.
 */

const SearchResults = lazy(() => import("./search-loader"))

export const barPlaceholder = "Ask Stuart or search gauges, wallets, txs"

const listId = "stuart-search-list"

// The content column: right of the sidebar (72, 240 or 280px, or the rail),
// left of Vote's ballot rail from 1600px. Fluid, centred, never past 600.
const wrapper =
  "fixed bottom-6 z-30 hidden -translate-x-1/2 [--sb:72px] [--sr:0px] left-[calc(var(--sb)+(100vw-var(--sb)-var(--sr))/2)] w-[min(600px,calc(100vw-var(--sb)-var(--sr)-48px))] md:block lg:[--sb:240px] xl:[--sb:280px] rail:[--sb:72px] min-[1600px]:[body:has([data-vote])_&]:[--sr:364px] stuart-expanded:hidden"

/**
 * From 768px Stuart's Ctrl K bar floats 24px above the foot of the content
 * column, and on first view it sat over whatever was there: Protocol's
 * chart labels, a gauge's About icons, a wallet's Activity amounts (P10,
 * 19 Nov 2026). This strip, the page's own background with a short fade
 * at its top, keeps the foot of the column clear up to 12px over the bar
 * (where docked bars sit, `--dock`), so content stops above the bar as it
 * scrolls and is never under it. The same span as the bar,
 * and hidden with it. A sibling of the bar, not a child: inside the
 * bar's transform, `fixed` would place it by the bar. Server rendered
 * with the bar, so it is there on first paint without first-paint code.
 */
const stuartGutter =
  "fixed bottom-0 z-20 hidden h-[90px] bg-linear-to-t from-bg from-87% to-transparent [--sb:72px] [--sr:0px] left-(--sb) right-(--sr) md:block lg:[--sb:240px] xl:[--sb:280px] rail:[--sb:72px] min-[1600px]:[body:has([data-vote])_&]:[--sr:364px] stuart-expanded:hidden"

// Focused, the bar lifts and its surface widens to 640 (600 at rest): the
// surface is its own layer that scales, and the orange ring fades in on
// another, so only transform and opacity animate.
const box =
  "group/bar relative isolate flex h-[54px] items-center gap-3 pr-2.5 pl-[9px] text-sec transition-[translate] duration-[160ms] ease-[cubic-bezier(.2,.8,.2,1)] hover:-translate-y-0.5 focus-within:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:focus-within:translate-y-0"

const surface =
  "absolute inset-0 -z-10 rounded-[27px] bg-soft2 shadow-[0_0_0_1px_var(--line)] transition-transform duration-200 ease-[cubic-bezier(.2,.8,.2,1)] group-has-[input:focus]/bar:scale-x-[1.0667] motion-reduce:transition-none"

const ring =
  "pointer-events-none absolute inset-0 -z-10 rounded-[27px] opacity-0 shadow-[0_0_0_1.5px_var(--acc),var(--popShadow)] transition-[opacity,transform] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] group-has-[input:focus]/bar:scale-x-[1.0667] group-has-[input:focus]/bar:opacity-100 motion-reduce:transition-none"

function isPhone(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(max-width: 767.98px)").matches === true
  )
}

export function StuartBar(): ReactNode {
  const router = useRouter()
  useLockCommands()
  const input = useRef<HTMLInputElement>(null)
  const controller = useRef<SearchController | null>(null)
  const [query, setQuery] = useState("")
  const [focused, setFocused] = useState(false)
  const [wanted, setWanted] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const resultsOpen = focused && query.trim() !== ""

  const warm = useCallback(() => {
    warmStuart()
    setWanted(true)
  }, [])

  // Ctrl K and Cmd K on every OS: focus the bar (phones: open the sheet).
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key.toLowerCase() !== "k") return
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      event.preventDefault()
      if (isPhone()) {
        openStuartSearch()
        return
      }
      warm()
      const field = input.current
      if (field === null) return
      // Always focus (a repeat or a doubled event must never blur it);
      // Escape leaves the bar.
      field.focus()
      field.select()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [warm])

  const done = useCallback(() => {
    setQuery("")
    input.current?.blur()
  }, [])

  // The ask action ships with the panel's chunk, not first paint; the
  // panel is already loading by the time anyone presses Enter.
  const ask = useCallback((question: string) => {
    void import("@matchbox/stuart-ui/store").then((store) =>
      store.askStuart(question, undefined, "palette"),
    )
  }, [])

  const navigate = useCallback(
    (to: string) => stuartNavigate(router, to),
    [router],
  )

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (controller.current?.onKeyDown(event) === true) return
    if (event.key === "Escape") {
      done()
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      const question = query.trim()
      if (question === "") return
      ask(question)
      done()
    }
  }

  return (
    <>
      <span aria-hidden="true" data-stuart-gutter="" className={stuartGutter} />
      <search
        id={barId}
        aria-label="Stuart"
        className={wrapper}
        onPointerEnter={warm}
        onTouchStart={warm}
      >
        <div className={box}>
          <span aria-hidden="true" className={surface} />
          <span aria-hidden="true" className={ring} />
          <StuartBadge size={36} />
          <input
            ref={input}
            id={barInputId}
            role="combobox"
            type="text"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            maxLength={2_000}
            aria-label={barPlaceholder}
            aria-expanded={resultsOpen}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              resultsOpen && activeId !== null ? activeId : undefined
            }
            placeholder={barPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onPaste={(event) => {
              // A pasted vote script keeps its lines apart (" | ").
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
            onFocus={() => {
              warm()
              setFocused(true)
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={onKeyDown}
            className="h-full min-w-0 flex-1 bg-transparent text-[15.5px] text-ink outline-none placeholder:text-sec"
          />
          <span
            aria-hidden="true"
            className={`flex-none transition-opacity duration-150 ${focused || query !== "" ? "opacity-0" : "opacity-100"}`}
          >
            <Kbd keys={["mod", "k"]} />
          </span>
          {wanted ? (
            <Suspense fallback={null}>
              <SearchResults
                endpoint={stuartEndpoint()}
                query={query}
                open={resultsOpen}
                listId={listId}
                controller={controller}
                onActiveChange={setActiveId}
                onAsk={ask}
                onNavigate={navigate}
                onDone={done}
              />
            </Suspense>
          ) : null}
        </div>
      </search>
    </>
  )
}
