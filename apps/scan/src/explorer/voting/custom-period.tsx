import { Glyph, shapes } from "@matchbox/ui/icons"
import { type CSSProperties, type ReactNode, useId } from "react"
import type { PeriodView } from "./range"

/**
 * A period toggle's custom span: a calendar button after 30d, 90d and All
 * that opens From and To days. Everything here is the browser's own: the
 * box is a popover (Escape and a click outside close it, focus goes back
 * to the button), the form a plain GET to this page with `from` and `to`
 * (the page's other params kept), which the server checks and clamps. So
 * it needs no script of its own and its look lives in styles.css
 * (`data-period`), keeping every page's code as it was. Apply lands back
 * at the toggle (the form's fragment).
 */
export function CustomPeriod({
  period,
  search,
}: {
  period: PeriodView
  /** The page's other search params, kept by Apply. */
  search: Record<string, string | undefined>
}): ReactNode {
  const id = useId()
  const anchor = `--p${id}`
  const custom = period.range === null
  return (
    <>
      <button
        id={`${id}b`}
        type="button"
        popoverTarget={id}
        aria-label={custom ? `Custom period, ${period.text}` : "Custom period"}
        aria-current={custom ? "true" : undefined}
        data-period=""
        style={{ anchorName: anchor } as CSSProperties}
      >
        <Glyph shape={shapes.calendarDays} size={16} />
        {custom ? <span>{period.text}</span> : null}
      </button>
      <form
        id={id}
        popover="auto"
        role="dialog"
        aria-label="Custom period"
        action={`#${id}b`}
        data-period-box=""
        style={{ positionAnchor: anchor } as CSSProperties}
        // `autofocus` is in the server's HTML only: a box React drew on
        // the client (after a link) focuses From itself when it opens.
        onToggle={(event) => {
          const box = event.currentTarget
          if (box.matches(":popover-open")) {
            box.querySelector<HTMLInputElement>("[name=from]")?.focus()
          }
        }}
      >
        {Object.entries(search).map(([name, value]) =>
          value === undefined || name === "from" || name === "to" ? null : (
            <input key={name} type="hidden" name={name} value={value} />
          ),
        )}
        <label>
          From
          <input
            type="date"
            name="from"
            required
            // Rendered as `autofocus`: the popover focuses it on open
            // before the page's script runs.
            autoFocus
            min={period.min}
            max={period.max}
            defaultValue={period.from}
          />
        </label>
        <label>
          To
          <input
            type="date"
            name="to"
            required
            min={period.min}
            max={period.max}
            defaultValue={period.to}
          />
        </label>
        <button type="submit">Apply</button>
      </form>
    </>
  )
}
