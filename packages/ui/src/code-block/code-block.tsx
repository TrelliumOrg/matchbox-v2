import {
  type KeyboardEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react"
import { CopyStatus, useCopy } from "../copy"
import { Glyph, shapes } from "../icons"
import { mergeClasses } from "../tv"

/**
 * A code card (Doop `cA_kCfY56H`, phone `29ZlJ9uplf`): soft, radius 20, a
 * 46px header with underline tabs or the file name and Copy, DM Mono
 * 13.5/22. Highlighting is done at build time; tokens arrive classed and
 * take their colours from the theme (`ink`, `sec`, `accInk`), so code reads
 * in all eight presets. On phones the code scrolls sideways and a Wrap
 * lines switch sits under the card.
 */

/** Token kinds: keyword, string, comment, number or constant, function. */
export type TokenKind = "" | "k" | "s" | "c" | "n" | "f"

export type Token = readonly [text: string, kind: TokenKind]

export type Snippet = {
  /** Tab label or file name. */
  label: string
  source: string
  lines: readonly (readonly Token[])[]
}

export type RootProps = {
  snippets: readonly Snippet[]
  /** One snippet shows its label as a file name; several show tabs. */
  className?: string
}

const tokenClass: Record<TokenKind, string> = {
  "": "",
  k: "font-medium text-ink",
  s: "text-acc-ink",
  c: "text-sec",
  n: "text-acc-ink",
  f: "text-ink",
}

function Code({
  snippet,
  wrap,
}: {
  snippet: Snippet
  wrap: boolean
}): ReactNode {
  return (
    <pre
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be reachable by keyboard
      tabIndex={0}
      className={`overflow-x-auto px-5 pt-[15px] pb-[17px] font-mono text-[13.5px] leading-[22px] text-ink2 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink [scrollbar-color:var(--ring)_transparent] max-sm:px-4 max-sm:text-[13px] ${wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "whitespace-pre"}`}
    >
      <code>
        {snippet.lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are fixed for a build
          <span key={index} className="block min-h-[22px]">
            {line.map(([text, kind], position) =>
              kind === "" ? (
                text
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: tokens are fixed for a build
                <span key={position} className={tokenClass[kind]}>
                  {text}
                </span>
              ),
            )}
          </span>
        ))}
      </code>
    </pre>
  )
}

export function CopyButton({ source }: { source: string }): ReactNode {
  const { state, copy } = useCopy(source)
  return (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy code"
        data-tap=""
        className="ml-auto flex h-8 flex-none cursor-pointer items-center gap-1.5 self-center rounded-2xl px-2.5 text-[13.5px] font-semibold text-sec outline-none hover:bg-soft2 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
      >
        <Glyph
          shape={state === "copied" ? shapes.check : shapes.copy}
          size={15}
          strokeWidth={1.75}
        />
        <span className="max-sm:sr-only" aria-hidden="true">
          {state === "copied" ? "Copied" : "Copy"}
        </span>
      </button>
      <CopyStatus state={state} />
    </>
  )
}

export function Root({ snippets, className }: RootProps): ReactNode {
  const [active, setActive] = useState(0)
  const [wrap, setWrap] = useState(false)
  const id = useId()
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const current = snippets[active] ?? snippets[0]
  if (current === undefined) return null
  const tabbed = snippets.length > 1

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    const last = snippets.length - 1
    let next: number | null = null
    if (event.key === "ArrowRight") next = active === last ? 0 : active + 1
    if (event.key === "ArrowLeft") next = active === 0 ? last : active - 1
    if (event.key === "Home") next = 0
    if (event.key === "End") next = last
    if (next === null) return
    event.preventDefault()
    setActive(next)
    tabs.current[next]?.focus()
  }

  return (
    <div className={mergeClasses(`mt-5 ${className ?? ""}`)}>
      <div className="overflow-hidden rounded-[20px] bg-soft">
        <div className="flex h-[46px] items-stretch border-b border-line pr-2 pl-5 max-sm:pl-4">
          {tabbed ? (
            <div role="tablist" aria-label="Language" className="flex gap-5">
              {snippets.map((snippet, index) => (
                <button
                  key={snippet.label}
                  ref={(element) => {
                    tabs.current[index] = element
                  }}
                  type="button"
                  role="tab"
                  id={`${id}-tab-${index}`}
                  aria-selected={index === active}
                  aria-controls={`${id}-panel`}
                  tabIndex={index === active ? 0 : -1}
                  onClick={() => setActive(index)}
                  onKeyDown={onKeyDown}
                  data-tap=""
                  className={`-mb-px flex cursor-pointer items-center border-b-2 pt-0.5 text-[14px] font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-ink ${index === active ? "border-ink text-ink" : "border-transparent text-sec hover:text-ink2"}`}
                >
                  {snippet.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="flex min-w-0 items-center truncate font-mono text-[13px] text-sec">
              {current.label}
            </p>
          )}
          <CopyButton source={current.source} />
        </div>
        {tabbed ? (
          <div
            id={`${id}-panel`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${active}`}
          >
            <Code snippet={current} wrap={wrap} />
          </div>
        ) : (
          <Code snippet={current} wrap={wrap} />
        )}
      </div>
      <label className="mt-3 hidden w-fit cursor-pointer items-center gap-2.5 text-[15px] text-ink2 max-sm:flex">
        <input
          type="checkbox"
          role="switch"
          aria-checked={wrap}
          checked={wrap}
          onChange={(event) => setWrap(event.currentTarget.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className="relative h-6 w-10 rounded-full border-[1.5px] border-switch-off transition-colors peer-checked:border-acc peer-checked:bg-acc peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink after:absolute after:top-[2px] after:left-[2px] after:size-[17px] after:rounded-full after:bg-off-thumb after:transition-transform peer-checked:after:translate-x-4 peer-checked:after:bg-knob"
        />
        Wrap lines
      </label>
    </div>
  )
}

Root.displayName = "CodeBlock"
