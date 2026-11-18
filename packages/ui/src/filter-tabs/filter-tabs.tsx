import { prefersReducedMotion } from "@matchbox/motion"
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useLayoutEffect,
  useRef,
} from "react"
import { useScrollRow } from "../scroll-row"

/**
 * Filter tabs (Vote, Activity): plain labels with a grey count, the active
 * one on an ink pill. When the value changes the pill slides from the old
 * item to the new one with a FLIP transform (translate and scaleX), so only
 * transform animates and the server render already shows the pill in place.
 * A row wider than the screen scrolls sideways with no scrollbar, never
 * vertically, opens on the pressed item and fades the side with more
 * (`useScrollRow`); the padding inside it keeps focus rings unclipped.
 */

type FilterTabsContextValue = {
  value: string
  onSelect: (value: string) => void
  previous: RefObject<DOMRect | null>
}

const FilterTabsContext = createContext<FilterTabsContextValue | null>(null)

function useFilterTabs(): FilterTabsContextValue {
  const context = useContext(FilterTabsContext)
  if (context === null) {
    throw new Error("FilterTabs.Item must be inside <FilterTabs.Root>")
  }
  return context
}

export type RootProps = {
  value: string
  onValueChange: (value: string) => void
  /** Accessible name for the group, for example "Gauge filter". */
  label: string
  children: ReactNode
  className?: string
}

export function Root({
  value,
  onValueChange,
  label,
  children,
  className,
}: RootProps): ReactNode {
  const previous = useRef<DOMRect | null>(null)
  const row = useRef<HTMLDivElement | null>(null)
  useScrollRow(row)
  return (
    <FilterTabsContext.Provider
      value={{ value, onSelect: onValueChange, previous }}
    >
      <fieldset className={`m-0 min-w-0 border-0 p-0 ${className ?? ""}`}>
        <legend className="sr-only">{label}</legend>
        <div ref={row} className="scroll-row -m-1 flex items-center gap-1 p-1">
          {children}
        </div>
      </fieldset>
    </FilterTabsContext.Provider>
  )
}

Root.displayName = "FilterTabs"

export type ItemProps = {
  value: string
  children: ReactNode
  count?: ReactNode
}

export function Item({ value, children, count }: ItemProps): ReactNode {
  const context = useFilterTabs()
  const pill = useRef<HTMLSpanElement | null>(null)
  const active = context.value === value
  const wasActive = useRef(active)

  useLayoutEffect(() => {
    const element = pill.current
    if (element === null) return
    if (active && !wasActive.current) {
      const from = context.previous.current
      const to = element.getBoundingClientRect()
      if (from !== null && to.width > 0 && !prefersReducedMotion()) {
        element.animate(
          [
            {
              transform: `translateX(${from.left - to.left}px) scaleX(${from.width / to.width})`,
            },
            { transform: "none" },
          ],
          { duration: 300, easing: "cubic-bezier(.2,.8,.2,1)" },
        )
      }
    }
    wasActive.current = active
  }, [active, context.previous])

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => {
        if (active) return
        const current = pill.current
          ?.closest("fieldset")
          ?.querySelector("[aria-pressed=true] [data-filter-pill]")
        context.previous.current = current?.getBoundingClientRect() ?? null
        context.onSelect(value)
      }}
      className="relative isolate flex h-[38px] cursor-pointer items-center gap-1.5 rounded-[19px] px-3.5 text-[15px] font-semibold whitespace-nowrap text-sec outline-none hover:text-ink2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink aria-pressed:text-bg"
    >
      <span
        ref={pill}
        data-filter-pill=""
        data-mbx-motion=""
        aria-hidden="true"
        className={`absolute inset-0 -z-10 origin-left rounded-[19px] bg-ink ${active ? "" : "invisible"}`}
      />
      {children}
      {count === undefined ? null : (
        <span className="font-medium text-mut tabular-nums">{count}</span>
      )}
    </button>
  )
}

Item.displayName = "FilterTabs.Item"
