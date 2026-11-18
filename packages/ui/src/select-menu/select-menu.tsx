import {
  createContext,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import { Pop } from "../floating/floating"
import { Glyph, shapes } from "../icons"

/**
 * A choice from a short list (Vote's sort): the trigger reads the current
 * choice with a chevron, and a press opens a menu of rows with a check on
 * the current one. Built on `Floating.Pop`, so the menu sits in the top
 * layer on the popover surface and fades with the other popovers, and it
 * is themed in every preset, which a native `<select>` is not: its option
 * list is drawn by the browser or the OS (light on macOS whatever the
 * page's theme).
 *
 * Keyboard and screen readers get the menu button pattern with radio
 * items: Enter, Space or the arrow keys open it on the current choice,
 * arrows, Home and End move, typing jumps to a row by its first letters,
 * Enter or Space chooses, Escape closes and returns focus to the trigger,
 * and Tab closes it and moves on.
 */

type SelectMenuContextValue = {
  value: string
  onChoose: (value: string) => void
}

const SelectMenuContext = createContext<SelectMenuContextValue | null>(null)

function useSelectMenu(): SelectMenuContextValue {
  const context = useContext(SelectMenuContext)
  if (context === null) {
    throw new Error("SelectMenu.Item must be inside <SelectMenu.Root>")
  }
  return context
}

function itemsOf(menu: HTMLElement | null): HTMLElement[] {
  return menu === null
    ? []
    : [...menu.querySelectorAll<HTMLElement>("[role=menuitemradio]")]
}

/** The row arrow keys, Home and End move to from `at`; null for other keys. */
export function stepTo(count: number, at: number, key: string): number | null {
  if (count === 0) return null
  switch (key) {
    case "ArrowDown":
      return (at + 1) % count
    case "ArrowUp":
      return (at - 1 + count) % count
    case "Home":
      return 0
    case "End":
      return count - 1
    default:
      return null
  }
}

/**
 * The row typeahead lands on: the first, from the one after `at`, whose
 * label starts with `typed`. Repeating one letter cycles through the rows
 * that start with it.
 */
export function typeahead(
  labels: readonly string[],
  at: number,
  typed: string,
): number | null {
  const text = typed.toLowerCase()
  const repeated = [...text].every((char) => char === text[0])
  const needle = repeated ? (text[0] ?? "") : text
  if (needle === "") return null
  const count = labels.length
  // A longer string can still match the row already on; one letter moves on.
  const from = repeated ? at + 1 : at
  for (let step = 0; step < count; step += 1) {
    const index = (from + step + count) % count
    if ((labels[index] ?? "").trim().toLowerCase().startsWith(needle)) {
      return index
    }
  }
  return null
}

export type RootProps = {
  /** Accessible name for the trigger and the menu, for example "Sort by". */
  label: string
  value: string
  /** What the trigger shows: the current choice's label. */
  valueText: ReactNode
  onValueChange: (value: string) => void
  /** `SelectMenu.Item`s. */
  children: ReactNode
  /** The menu's edge that lines up with the trigger's. */
  align?: "start" | "end"
  className?: string | undefined
}

export function Root({
  label,
  value,
  valueText,
  onValueChange,
  children,
  align = "end",
  className,
}: RootProps): ReactNode {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const trigger = useRef<HTMLButtonElement | null>(null)
  const menu = useRef<HTMLDivElement | null>(null)
  const typed = useRef({ text: "", at: 0 })

  // Opening, by press or key, puts focus on the current choice.
  useEffect(() => {
    if (!open) return
    const items = itemsOf(menu.current)
    const current =
      items.find((item) => item.getAttribute("aria-checked") === "true") ??
      items[0]
    current?.focus({ preventScroll: true })
  }, [open])

  function choose(next: string): void {
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
    if (next !== value) onValueChange(next)
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      setOpen(true)
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const items = itemsOf(menu.current)
    const active = document.activeElement
    const at = active instanceof HTMLElement ? items.indexOf(active) : -1
    const step = stepTo(items.length, at, event.key)
    if (step !== null) {
      event.preventDefault()
      items[step]?.focus()
      return
    }
    const printable =
      event.key.length === 1 &&
      event.key !== " " &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    if (!printable) return
    const now = Date.now()
    const text =
      (now - typed.current.at < 600 ? typed.current.text : "") + event.key
    typed.current = { text, at: now }
    const match = typeahead(
      items.map((item) => item.textContent ?? ""),
      at,
      text,
    )
    if (match !== null) items[match]?.focus()
  }

  // Focus leaving the menu (Tab, or a press elsewhere) closes it; moving to
  // the trigger is the menu closing itself.
  function onMenuBlur(event: FocusEvent<HTMLDivElement>): void {
    const next = event.relatedTarget
    if (next instanceof Node && menu.current?.contains(next)) return
    if (next === trigger.current) return
    setOpen(false)
  }

  return (
    <SelectMenuContext.Provider value={{ value, onChoose: choose }}>
      <Pop
        open={open}
        onOpenChange={setOpen}
        align={align}
        className={className}
        contentClassName="w-max min-w-[208px] p-1.5"
        trigger={(props) => (
          <button
            ref={trigger}
            type="button"
            {...props}
            aria-haspopup="menu"
            aria-controls={open ? menuId : undefined}
            onKeyDown={onTriggerKeyDown}
            className="flex h-[42px] cursor-pointer items-center gap-1 rounded-[21px] px-2 text-[15px] font-semibold whitespace-nowrap text-sec outline-none hover:text-ink2 focus-visible:outline-2 focus-visible:outline-ink aria-expanded:text-ink"
          >
            <span className="sr-only">{label} </span>
            {valueText}
            <Glyph shape={shapes.chevronDown} size={16} strokeWidth={2.2} />
          </button>
        )}
        content={
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-label={label}
            tabIndex={-1}
            onKeyDown={onMenuKeyDown}
            onBlur={onMenuBlur}
            className="flex flex-col outline-none"
          >
            {children}
          </div>
        }
      />
    </SelectMenuContext.Provider>
  )
}

Root.displayName = "SelectMenu"

export type ItemProps = {
  value: string
  children: ReactNode
}

export function Item({ value, children }: ItemProps): ReactNode {
  const context = useSelectMenu()
  const checked = context.value === value
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={-1}
      onClick={() => context.onChoose(value)}
      className="flex h-11 w-full cursor-pointer items-center gap-3 rounded-[14px] px-3 text-left text-[15px] font-medium whitespace-nowrap text-ink outline-none hover:bg-soft2 focus-visible:bg-soft2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
    >
      <span className="flex-1">{children}</span>
      <Glyph
        shape={shapes.check}
        size={18}
        strokeWidth={2.2}
        className={checked ? "" : "invisible"}
      />
    </button>
  )
}

Item.displayName = "SelectMenu.Item"
