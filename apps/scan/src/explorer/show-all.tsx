import { Glyph, shapes } from "@matchbox/ui/icons"
import { Children, type ReactNode } from "react"

/**
 * A long stack of blocks (a transaction's logs): the first `shown` stay
 * open and the rest sit behind "Show all N logs". Native `<details>`, so it
 * opens without JavaScript and before hydration, and the server's HTML is
 * the closed state, so nothing moves until someone opens it. Open, the
 * control reads "Show fewer logs" and stays above the blocks it revealed.
 */
export function ShowAll({
  children,
  shown = 3,
  noun,
}: {
  children: ReactNode
  shown?: number
  /** Plural, lower case: "logs". */
  noun: string
}): ReactNode {
  const items = Children.toArray(children)
  if (items.length <= shown + 1) {
    return <div className="flex flex-col gap-4">{items}</div>
  }
  return (
    <div className="flex flex-col gap-4">
      {items.slice(0, shown)}
      <details className="group">
        <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-[22px] bg-soft px-4 text-[15px] font-semibold text-ink outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink [&::-webkit-details-marker]:hidden">
          <Glyph
            shape={shapes.chevronRight}
            size={16}
            strokeWidth={2}
            className="transition-transform group-open:rotate-90 motion-reduce:transition-none"
          />
          <span className="group-open:hidden">
            Show all {items.length} {noun}
          </span>
          <span className="hidden group-open:inline">Show fewer {noun}</span>
        </summary>
        <div className="mt-4 flex flex-col gap-4">{items.slice(shown)}</div>
      </details>
    </div>
  )
}
