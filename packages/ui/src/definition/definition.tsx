import { type ReactNode, useEffect, useId, useRef, useState } from "react"

/**
 * An inline definition (Doop `cA_kCfY56H`): the term with a dotted
 * underline; hover, focus or tap opens a 320px ink bubble with the term,
 * one or two sentences and a link to its page. Escape or a click outside
 * closes it. No popover library: it is a button and a positioned span, so
 * it stays out of a page's first-paint JavaScript.
 */

export type RootProps = {
  title: string
  definition: string
  /** The page that explains the term, rendered as `link`. */
  link: ReactNode
  children: ReactNode
}

export function Root({
  title,
  definition,
  link,
  children,
}: RootProps): ReactNode {
  const [open, setOpen] = useState(false)
  const id = useId()
  const box = useRef<HTMLSpanElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false)
    }
    function onPointer(event: PointerEvent): void {
      if (box.current !== null && !box.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onPointer)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("pointerdown", onPointer)
    }
  }, [open])

  function hover(next: boolean): void {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), next ? 300 : 200)
  }

  return (
    <span
      ref={box}
      className="relative"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") hover(true)
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") hover(false)
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="cursor-help border-b-[1.5px] border-dotted border-sec text-ink outline-none focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        {children}
      </button>
      <span
        id={id}
        role="dialog"
        aria-label={title}
        hidden={!open}
        className="absolute top-8 -left-3.5 z-30 w-[320px] max-w-[calc(100vw-40px)] rounded-[14px] bg-tip px-[15px] pt-[13px] pb-3.5 text-[14px] leading-[21px] font-normal whitespace-normal text-on-tip before:absolute before:-top-1.5 before:left-[26px] before:size-3 before:rotate-45 before:rounded-[2px] before:bg-tip"
      >
        <span className="mb-0.5 block text-[14.5px] font-semibold">
          {title}
        </span>
        {definition}
        <span className="mt-2 block font-semibold [&_a]:underline [&_a]:underline-offset-[3px]">
          {link}
        </span>
      </span>
    </span>
  )
}

Root.displayName = "Definition"
