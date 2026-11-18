import {
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { mergeClasses } from "../tv"

/**
 * Small tooltip and popover for the controls that sit on every screen (block
 * ticker, price slot, coin stacks, allocation marks). The bubble renders in
 * the browser's top layer (the Popover API, `popover="manual"`), so no
 * container clips it and no later sibling paints over it, and it stays a DOM
 * child of its trigger, so hover and outside presses work as before. It is
 * placed against the trigger's rect with fixed coordinates, flipped and kept
 * inside the viewport, and follows scrolls and resizes while open. No
 * portal and no positioning engine: it costs almost nothing on first paint.
 * Once opened the bubble stays mounted and closes with `hidePopover`, so
 * the stylesheet fades it in and out (`data-mbx-pop`) and a closing bubble
 * never takes a click.
 */

type Align = "start" | "center" | "end"
type Side = "top" | "bottom"

const gutter = 12

/** Top layer styles, cleared of the UA's popover defaults. */
const layer: CSSProperties = {
  position: "fixed",
  inset: "auto",
  margin: 0,
  border: 0,
  overflow: "visible",
}

/** Fixed coordinates for `bubble` against `anchor`, inside the viewport. */
export function place(
  anchor: Pick<DOMRect, "top" | "bottom" | "left" | "right" | "width">,
  bubble: { width: number; height: number },
  viewport: { width: number; height: number },
  side: Side,
  align: Align,
  offset: number,
): { top: number; left: number } {
  const above = anchor.top - offset - bubble.height
  const below = anchor.bottom + offset
  let top = side === "top" ? above : below
  if (side === "top" && above < gutter) top = below
  if (side === "bottom" && below + bubble.height > viewport.height - gutter) {
    top = above >= gutter ? above : below
  }
  let left =
    align === "start"
      ? anchor.left
      : align === "end"
        ? anchor.right - bubble.width
        : anchor.left + anchor.width / 2 - bubble.width / 2
  left = Math.min(left, viewport.width - gutter - bubble.width)
  left = Math.max(left, gutter)
  return { top: Math.round(top), left: Math.round(left) }
}

/**
 * Shows the open bubble in the top layer and keeps it placed against the
 * anchor (scaling from the trigger's side), before the first paint and on
 * every scroll or resize; Escape calls `close`. Returns whether to render
 * the bubble: while open and, once opened, wherever the browser can hide
 * it, so its exit plays (without the Popover API it unmounts).
 */
function useTopLayer(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  bubble: RefObject<HTMLElement | null>,
  side: Side,
  align: Align,
  close: () => void,
): boolean {
  const [opened, setOpened] = useState(false)
  if (open && !opened) setOpened(true)
  const onEscape = useRef(close)
  onEscape.current = close

  useLayoutEffect(() => {
    const element = bubble.current
    const target = anchor.current
    if (element === null || target === null) return
    if (!open) {
      element.hidePopover()
      return
    }
    if (
      typeof element.showPopover === "function" &&
      !element.matches(":popover-open")
    ) {
      try {
        element.showPopover()
      } catch {
        // Not in the document yet or already shown: the fixed styles hold.
      }
    }
    function update(): void {
      if (element === null || target === null) return
      const rect = target.getBoundingClientRect()
      const { top, left } = place(
        rect,
        { width: element.offsetWidth, height: element.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        side,
        align,
        8,
      )
      element.style.top = `${top}px`
      element.style.left = `${left}px`
      element.style.transformOrigin = `${rect.left + rect.width / 2 - left}px ${top < rect.top ? "100%" : "0"}`
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onEscape.current()
    }
    update()
    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
      window.removeEventListener("keydown", onKey)
    }
  }, [open, anchor, bubble, side, align])

  return open || (opened && "hidePopover" in HTMLElement.prototype)
}

export type TipProps = {
  /** The focusable trigger, given the props it needs. */
  trigger: (props: {
    "aria-describedby": string | undefined
    onPointerEnter: () => void
    onPointerLeave: () => void
    onFocus: () => void
    onBlur: () => void
  }) => ReactNode
  content: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  side?: Side
  align?: Align
  delay?: number
  className?: string | undefined
}

/** Ink bubble on hover (after `delay`) and keyboard focus. Escape closes. */
export function Tip({
  trigger,
  content,
  open: openProp,
  onOpenChange,
  side = "top",
  align = "center",
  delay = 300,
  className,
}: TipProps): ReactNode {
  const [inner, setInner] = useState(false)
  const open = openProp ?? inner
  const id = useId()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchor = useRef<HTMLSpanElement | null>(null)
  const bubble = useRef<HTMLSpanElement | null>(null)
  const mounted = useTopLayer(open, anchor, bubble, side, align, () =>
    set(false),
  )

  function set(next: boolean): void {
    if (timer.current !== null) clearTimeout(timer.current)
    setInner(next)
    onOpenChange?.(next)
  }

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  return (
    <span ref={anchor} className={`relative inline-flex ${className ?? ""}`}>
      {trigger({
        "aria-describedby": open ? id : undefined,
        onPointerEnter: () => {
          if (timer.current !== null) clearTimeout(timer.current)
          timer.current = setTimeout(() => set(true), delay)
        },
        onPointerLeave: () => set(false),
        onFocus: () => set(true),
        onBlur: () => set(false),
      })}
      {mounted ? (
        <span
          ref={bubble}
          id={id}
          role="tooltip"
          popover="manual"
          data-mbx-motion=""
          data-mbx-pop=""
          className="pointer-events-none w-max max-w-72 rounded-xl bg-tip px-3 py-2 text-left font-sans text-[13.5px] leading-[1.45] font-medium tracking-normal text-on-tip"
          style={layer}
        >
          {content}
        </span>
      ) : null}
    </span>
  )
}

Tip.displayName = "Floating.Tip"

export type PopProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The trigger button, given its disclosure props. */
  trigger: (props: {
    "aria-expanded": boolean
    "aria-controls": string | undefined
    onClick: () => void
  }) => ReactNode
  content: ReactNode
  align?: Align
  onContentPointerEnter?: (() => void) | undefined
  onContentPointerLeave?: ((event: ReactPointerEvent) => void) | undefined
  className?: string | undefined
  contentClassName?: string | undefined
}

/**
 * A disclosure popover: the trigger toggles it, Escape and a press outside
 * close it, and focus returns to the trigger on Escape.
 */
export function Pop({
  open,
  onOpenChange,
  trigger,
  content,
  align = "start",
  onContentPointerEnter,
  onContentPointerLeave,
  className,
  contentClassName,
}: PopProps): ReactNode {
  const id = useId()
  const root = useRef<HTMLSpanElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const openedAt = useRef(0)
  const mounted = useTopLayer(open, root, panel, "bottom", align, () => {
    onOpenChange(false)
    root.current?.querySelector<HTMLElement>("[aria-expanded]")?.focus()
  })

  useEffect(() => {
    if (open) openedAt.current = Date.now()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent): void {
      const target = event.target
      if (target instanceof Node && root.current?.contains(target)) return
      onOpenChange(false)
    }
    window.addEventListener("pointerdown", onPointerDown)
    return () => window.removeEventListener("pointerdown", onPointerDown)
  }, [open, onOpenChange])

  return (
    <span ref={root} className={`relative inline-flex ${className ?? ""}`}>
      {trigger({
        "aria-expanded": open,
        "aria-controls": open ? id : undefined,
        // A hover opens it just before the click lands: keep it open then.
        onClick: () => {
          if (open && Date.now() - openedAt.current < 400) return
          onOpenChange(!open)
        },
      })}
      {mounted ? (
        <div
          ref={panel}
          id={id}
          onPointerEnter={onContentPointerEnter}
          onPointerLeave={onContentPointerLeave}
          popover="manual"
          data-mbx-motion=""
          data-mbx-pop=""
          className={mergeClasses(
            `w-[300px] rounded-[20px] bg-pop p-2 text-left font-sans text-ink shadow-pop ${contentClassName ?? ""}`,
          )}
          style={layer}
        >
          {content}
        </div>
      ) : null}
    </span>
  )
}

Pop.displayName = "Floating.Pop"
