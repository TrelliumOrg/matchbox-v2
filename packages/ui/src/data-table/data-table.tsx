// biome-ignore-all lint/a11y/noRedundantRoles: explicit roles keep table semantics when phones reflow rows with CSS grid (Safari drops them)
import {
  Children,
  type ComponentProps,
  createContext,
  isValidElement,
  type ReactNode,
  useContext,
  useId,
} from "react"

/**
 * Data table (Matchscan lists: transactions, blocks, holders). A real table
 * with a header row of 14px secondary labels and 62px rows on hairlines.
 *
 * Below the `reflow` breakpoint each row becomes two lines: a cell names its
 * place with `phone` (title and value on the first line, detail and meta on
 * the second); a cell without one is hidden there, so no two cells share a
 * place by accident (a development warning names any that do). Above it the
 * table scrolls sideways inside a labelled, focusable region rather than
 * overflowing its container. Explicit table roles keep the semantics when
 * CSS turns rows into grids.
 */

export type Align = "start" | "end"

/** Where a cell sits in the two-line phone row. */
export type PhonePlace = "title" | "value" | "detail" | "meta" | "hidden"

/** The width under which rows reflow: md 768, lg 1024, xl 1280. */
export type Reflow = "md" | "lg" | "xl"

type Classes = {
  table: string
  caption: string
  head: string
  body: string
  row: string
  cell: string
  empty: string
  places: Record<PhonePlace, string>
}

// Literal class names per breakpoint, so Tailwind sees every one.
const reflowClasses: Record<Reflow, Classes> = {
  md: {
    table: "max-md:block",
    caption: "max-md:block",
    head: "max-md:sr-only",
    body: "max-md:block",
    row: "max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-4 max-md:gap-y-1 max-md:py-3.5",
    cell: "md:h-[62px]",
    empty: "max-md:block",
    places: {
      title: "max-md:col-start-1 max-md:row-start-1 max-md:min-w-0",
      value: "max-md:col-start-2 max-md:row-start-1 max-md:text-right",
      detail:
        "max-md:col-start-1 max-md:row-start-2 max-md:min-w-0 max-md:text-[14.5px] max-md:text-sec",
      meta: "max-md:col-start-2 max-md:row-start-2 max-md:text-right max-md:text-[14.5px] max-md:text-sec",
      hidden: "max-md:hidden",
    },
  },
  lg: {
    table: "max-lg:block",
    caption: "max-lg:block",
    head: "max-lg:sr-only",
    body: "max-lg:block",
    row: "max-lg:grid max-lg:grid-cols-[minmax(0,1fr)_auto] max-lg:gap-x-4 max-lg:gap-y-1 max-lg:py-3.5",
    cell: "lg:h-[62px]",
    empty: "max-lg:block",
    places: {
      title: "max-lg:col-start-1 max-lg:row-start-1 max-lg:min-w-0",
      value: "max-lg:col-start-2 max-lg:row-start-1 max-lg:text-right",
      detail:
        "max-lg:col-start-1 max-lg:row-start-2 max-lg:min-w-0 max-lg:text-[14.5px] max-lg:text-sec",
      meta: "max-lg:col-start-2 max-lg:row-start-2 max-lg:text-right max-lg:text-[14.5px] max-lg:text-sec",
      hidden: "max-lg:hidden",
    },
  },
  xl: {
    table: "max-xl:block",
    caption: "max-xl:block",
    head: "max-xl:sr-only",
    body: "max-xl:block",
    row: "max-xl:grid max-xl:grid-cols-[minmax(0,1fr)_auto] max-xl:gap-x-4 max-xl:gap-y-1 max-xl:py-3.5",
    cell: "xl:h-[62px]",
    empty: "max-xl:block",
    places: {
      title: "max-xl:col-start-1 max-xl:row-start-1 max-xl:min-w-0",
      value: "max-xl:col-start-2 max-xl:row-start-1 max-xl:text-right",
      detail:
        "max-xl:col-start-1 max-xl:row-start-2 max-xl:min-w-0 max-xl:text-[14.5px] max-xl:text-sec",
      meta: "max-xl:col-start-2 max-xl:row-start-2 max-xl:text-right max-xl:text-[14.5px] max-xl:text-sec",
      hidden: "max-xl:hidden",
    },
  },
}

const ReflowContext = createContext<Reflow>("md")

const align: Record<Align, string> = { start: "text-left", end: "text-right" }

function join(...parts: (string | undefined)[]): string {
  return parts.filter((part) => part !== undefined && part !== "").join(" ")
}

export type RootProps = Omit<ComponentProps<"table">, "role"> & {
  /** The table's name. Shown as a caption unless `captionHidden`. */
  caption: string
  captionHidden?: boolean
  /** Rows reflow to two lines below this width. Default md. */
  reflow?: Reflow
}

export function Root({
  caption,
  captionHidden = false,
  reflow = "md",
  className,
  children,
  ...props
}: RootProps): ReactNode {
  const classes = reflowClasses[reflow]
  const captionId = useId()
  return (
    <ReflowContext.Provider value={reflow}>
      {/* Wide tables scroll here, not the page. Focusable, so keyboards
          can scroll it too (WCAG 2.1.1). */}
      <section
        aria-labelledby={captionId}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard
        tabIndex={0}
        className="w-full overflow-x-auto rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-ink"
      >
        <table
          role="table"
          className={join(
            "w-full border-collapse text-left text-[15px] tabular-nums",
            classes.table,
            className,
          )}
          {...props}
        >
          <caption
            id={captionId}
            className={
              captionHidden
                ? "sr-only"
                : join(
                    "mb-3 text-left text-[15px] font-semibold",
                    classes.caption,
                  )
            }
          >
            {caption}
          </caption>
          {children}
        </table>
      </section>
    </ReflowContext.Provider>
  )
}

export function Header({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}): ReactNode {
  const classes = reflowClasses[useContext(ReflowContext)]
  return (
    <thead role="rowgroup" className={join(classes.head, className)}>
      <tr role="row">{children}</tr>
    </thead>
  )
}

export type ColumnProps = Omit<ComponentProps<"th">, "align" | "role"> & {
  align?: Align
}

export function Column({
  align: side = "start",
  className,
  ...props
}: ColumnProps): ReactNode {
  return (
    <th
      role="columnheader"
      scope="col"
      className={join(
        "h-10 border-b border-line px-0 pr-6 align-middle text-[14px] font-normal whitespace-nowrap text-sec last:pr-0",
        align[side],
        className,
      )}
      {...props}
    />
  )
}

export function Body({
  className,
  ...props
}: Omit<ComponentProps<"tbody">, "role">): ReactNode {
  const classes = reflowClasses[useContext(ReflowContext)]
  return (
    <tbody
      role="rowgroup"
      className={join(classes.body, className)}
      {...props}
    />
  )
}

export type CellProps = Omit<ComponentProps<"td">, "align" | "role"> & {
  align?: Align
  /** Where the cell sits when rows reflow. Without one it is hidden there. */
  phone?: PhonePlace
}

export function Cell({
  align: side = "start",
  phone = "hidden",
  className,
  ...props
}: CellProps): ReactNode {
  const classes = reflowClasses[useContext(ReflowContext)]
  return (
    <td
      role="cell"
      className={join(
        "py-0 pr-6 align-middle last:pr-0",
        classes.cell,
        align[side],
        classes.places[phone],
        className,
      )}
      {...props}
    />
  )
}

/** Places more than one cell in a row claims (hidden excepted). */
export function phoneCollisions(children: ReactNode): PhonePlace[] {
  const seen = new Set<PhonePlace>()
  const repeated = new Set<PhonePlace>()
  Children.forEach(children, (child) => {
    if (!isValidElement<CellProps>(child) || child.type !== Cell) return
    const place = child.props.phone ?? "hidden"
    if (place === "hidden") return
    if (seen.has(place)) repeated.add(place)
    seen.add(place)
  })
  return [...repeated]
}

export function Row({
  className,
  children,
  ...props
}: Omit<ComponentProps<"tr">, "role">): ReactNode {
  const classes = reflowClasses[useContext(ReflowContext)]
  if (import.meta.env.DEV) {
    const repeated = phoneCollisions(children)
    if (repeated.length > 0) {
      console.warn(
        `DataTable.Row: more than one cell has phone="${repeated.join('", "')}", so they overlap when rows reflow`,
      )
    }
  }
  return (
    <tr
      role="row"
      className={join("border-b border-line", classes.row, className)}
      {...props}
    >
      {children}
    </tr>
  )
}

/** One row across every column: the table's designed empty state. */
export function Empty({
  columns,
  children,
}: {
  columns: number
  children: ReactNode
}): ReactNode {
  const classes = reflowClasses[useContext(ReflowContext)]
  return (
    <tr role="row" className={classes.empty}>
      <td
        role="cell"
        colSpan={columns}
        className={join(
          "py-12 text-center text-[15px] text-sec",
          classes.empty,
        )}
      >
        {children}
      </td>
    </tr>
  )
}

Root.displayName = "DataTable.Root"
Header.displayName = "DataTable.Header"
Column.displayName = "DataTable.Column"
Body.displayName = "DataTable.Body"
Row.displayName = "DataTable.Row"
Cell.displayName = "DataTable.Cell"
Empty.displayName = "DataTable.Empty"
