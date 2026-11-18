import {
  Children,
  type ComponentProps,
  createContext,
  isValidElement,
  type ReactNode,
  useContext,
  useState,
} from "react"
import { tv } from "../tv"

/**
 * Soft track, raised pill on the selected item. Items share the width
 * equally, so the pill slides with a transform only. Arrow keys move the
 * selection.
 */

const segmented = tv({
  slots: {
    root: "relative isolate grid auto-cols-fr grid-flow-col bg-soft p-1 gap-0.5",
    pill: "absolute inset-y-1 left-1 -z-10 bg-raised shadow-lift transition-transform duration-300 ease-roll",
    item: "flex items-center justify-center gap-2 whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink data-[state=checked]:text-ink",
  },
  variants: {
    size: {
      md: {
        root: "h-11 rounded-[22px]",
        pill: "rounded-[18px]",
        item: "rounded-[18px] px-3 text-[15px] font-medium text-ink2 data-[state=checked]:font-semibold hover:data-[state=unchecked]:bg-soft2",
      },
      lg: {
        root: "h-12 rounded-[24px]",
        pill: "rounded-[20px]",
        item: "rounded-[20px] px-[18px] text-[15px] font-semibold text-sec hover:data-[state=unchecked]:text-ink2",
      },
      sm: {
        root: "h-12 rounded-[24px]",
        pill: "rounded-[20px]",
        item: "rounded-[20px] px-3.5 text-sm font-semibold text-sec hover:data-[state=unchecked]:text-ink2",
      },
    },
  },
  defaultVariants: { size: "lg" },
})

/**
 * What the control sits on. On the page ground the track is soft and the pill
 * raised. On a sheet (white in light, soft in dark) and on cards the track
 * steps up one level so it stays visible.
 */
const surfaces = {
  ground: { root: "", pill: "", item: "" },
  sheet: {
    root: "dark:bg-soft2",
    pill: "dark:bg-[color-mix(in_srgb,var(--soft2),var(--ink)_9%)]",
    item: "",
  },
  card: {
    root: "bg-soft2",
    pill: "dark:bg-[color-mix(in_srgb,var(--soft2),var(--ink)_9%)]",
    // On the darker track, secondary text falls under 4.5:1 (#6a6c68 on
    // #e9e9e6 is 4.36): unselected items read in ink2.
    item: "text-ink2",
  },
} as const

export type Surface = keyof typeof surfaces

type Size = "md" | "lg" | "sm"

type SegmentedContextValue = {
  size: Size
  surface: Surface
  value: string | undefined
  first: string | null
  disabled: boolean
  select: (value: string) => void
}

const SegmentedContext = createContext<SegmentedContextValue>({
  size: "lg",
  surface: "ground",
  value: undefined,
  first: null,
  disabled: false,
  select: () => {},
})

export type RootProps = Omit<
  ComponentProps<"div">,
  "defaultValue" | "onChange" | "dir"
> & {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  /** Accepted for form parity; the buttons do not submit. */
  name?: string
  disabled?: boolean
  size?: Size
  surface?: Surface
}

/**
 * A radio group: one tab stop, arrow keys move and select (looping), Home
 * and End jump. Built without Radix so the control costs little on first
 * paint.
 */
export function Root({
  size = "lg",
  surface = "ground",
  className,
  children,
  value: valueProp,
  defaultValue,
  onValueChange,
  name: _name,
  disabled = false,
  ...props
}: RootProps): ReactNode {
  const [inner, setInner] = useState(defaultValue)
  const value = valueProp ?? inner
  const items = Children.toArray(children).filter(isValidElement)
  const values = items.map((child) => {
    const childProps: unknown = child.props
    return typeof childProps === "object" &&
      childProps !== null &&
      "value" in childProps &&
      typeof childProps.value === "string"
      ? childProps.value
      : null
  })
  const index = values.indexOf(value ?? null)
  const count = Math.max(items.length, 1)
  const styles = segmented({ size })

  return (
    <SegmentedContext.Provider
      value={{
        size,
        surface,
        value,
        first: values.find((entry) => entry !== null) ?? null,
        disabled,
        select: (next) => {
          setInner(next)
          onValueChange?.(next)
        },
      }}
    >
      <div
        role="radiogroup"
        aria-disabled={disabled || undefined}
        className={styles.root({
          className: `${surfaces[surface].root} ${className ?? ""}`,
        })}
        {...props}
      >
        {index >= 0 ? (
          <span
            aria-hidden="true"
            data-mbx-motion=""
            className={styles.pill({ className: surfaces[surface].pill })}
            style={{
              width: `calc((100% - 8px - ${(count - 1) * 2}px) / ${count})`,
              transform: `translateX(calc(${index} * (100% + 2px)))`,
            }}
          />
        ) : null}
        {children}
      </div>
    </SegmentedContext.Provider>
  )
}

Root.displayName = "SegmentedControl"

export type ItemProps = Omit<ComponentProps<"button">, "value" | "type"> & {
  value: string
}

const moves: Record<string, (index: number, count: number) => number> = {
  ArrowRight: (index, count) => (index + 1) % count,
  ArrowDown: (index, count) => (index + 1) % count,
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  ArrowUp: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_index, count) => count - 1,
}

export function Item({
  className,
  value,
  disabled,
  onKeyDown,
  onClick,
  ...props
}: ItemProps): ReactNode {
  const group = useContext(SegmentedContext)
  const checked = group.value === value
  const focusable =
    checked || (group.value === undefined && group.first === value)
  return (
    // biome-ignore lint/a11y/useSemanticElements: see Root
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      data-state={checked ? "checked" : "unchecked"}
      tabIndex={focusable ? 0 : -1}
      disabled={disabled ?? group.disabled}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) group.select(value)
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        const move = moves[event.key]
        const radios =
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
            "[role=radio]:not(:disabled)",
          )
        if (move === undefined || radios === undefined || radios.length === 0)
          return
        event.preventDefault()
        const list = [...radios]
        const next = list[move(list.indexOf(event.currentTarget), list.length)]
        next?.focus()
        next?.click()
      }}
      className={segmented({ size: group.size }).item({
        className: `${surfaces[group.surface].item} ${className ?? ""}`,
      })}
      {...props}
    />
  )
}

Item.displayName = "SegmentedControl.Item"
