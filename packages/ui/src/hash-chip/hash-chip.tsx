import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  type ReactNode,
  useContext,
} from "react"
import { CopyStatus, copyFeedbackMs, useCopy } from "../copy"
import { Glyph, shapes } from "../icons"
import { defaultLengths, type HashKind, truncateMiddle } from "./truncate"

/**
 * Address and hash chip: the value shortened in the middle in DM Mono
 * ("0x7f3a…91c2"), optionally a link to its page, then a copy button that
 * says "Copied" to screen readers and shows a check for 1.5s. The full value
 * is the link's title and the copy button's payload.
 *
 *   <HashChip.Root value={hash} kind="hash">
 *     <HashChip.Value asChild><Link to="/tx/$hash" params={{ hash }} /></HashChip.Value>
 *     <HashChip.Copy />
 *   </HashChip.Root>
 *
 * Without children it renders the plain value and the copy button.
 */

type ChipValue = { value: string; kind: HashKind; short: string }

const ChipContext = createContext<ChipValue | null>(null)

function useChip(): ChipValue {
  const chip = useContext(ChipContext)
  if (chip === null) throw new Error("HashChip parts must be inside Root")
  return chip
}

export type RootProps = {
  value: string
  kind?: HashKind
  /** Characters kept at each end. Defaults: 6 and 4, or 10 and 8 for hashes. */
  head?: number
  tail?: number
  className?: string
  children?: ReactNode
}

export function Root({
  value,
  kind = "address",
  head,
  tail,
  className,
  children,
}: RootProps): ReactNode {
  const lengths = defaultLengths[kind]
  const short = truncateMiddle(
    value,
    head ?? lengths.head,
    tail ?? lengths.tail,
  )
  return (
    <ChipContext.Provider value={{ value, kind, short }}>
      <span
        className={`inline-flex max-w-full items-center gap-1.5 align-middle ${className ?? ""}`}
      >
        {children ?? (
          <>
            <Value />
            <Copy />
          </>
        )}
      </span>
    </ChipContext.Provider>
  )
}

const valueText = "font-mono text-[14.5px] whitespace-nowrap tabular-nums"
const linkText =
  "rounded-sm underline decoration-line decoration-1 underline-offset-[5px] outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"

export type ValueProps = {
  /** A plain link. Use `asChild` for the app's router link instead. */
  href?: string
  asChild?: boolean
  children?: ReactNode
  className?: string
}

export function Value({
  href,
  asChild = false,
  children,
  className,
}: ValueProps): ReactNode {
  const { value, short } = useChip()
  const text = <span aria-hidden="true">{short}</span>
  const spoken = <span className="sr-only">{value}</span>
  if (asChild) {
    const child = Children.only(children)
    if (!isValidElement<Record<string, unknown>>(child)) return null
    const own = child.props.className
    return cloneElement(child, {
      title: value,
      className: `${valueText} ${linkText} ${className ?? ""} ${typeof own === "string" ? own : ""}`,
      children: (
        <>
          {text}
          {spoken}
        </>
      ),
    })
  }
  if (href !== undefined) {
    return (
      <a
        href={href}
        title={value}
        className={`${valueText} ${linkText} ${className ?? ""}`}
      >
        {text}
        {spoken}
      </a>
    )
  }
  return (
    <span title={value} className={`${valueText} ${className ?? ""}`}>
      {text}
      {spoken}
    </span>
  )
}

/** Kept for callers of the old constant: how long "Copied" shows. */
export const copiedMs = copyFeedbackMs

const copyIcon = {
  idle: { shape: shapes.copy, tone: undefined },
  copied: { shape: shapes.check, tone: "text-pos" },
  failed: { shape: shapes.x, tone: "text-neg" },
} as const

export function Copy({ className }: { className?: string }): ReactNode {
  const { value, kind } = useChip()
  const { state, copy } = useCopy(value)
  const icon = copyIcon[state]
  return (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={kind === "hash" ? "Copy hash" : "Copy address"}
        className={`relative grid size-7 flex-none cursor-pointer place-items-center rounded-full text-sec outline-none transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink ${className ?? ""}`}
      >
        <Glyph
          shape={icon.shape}
          size={15}
          strokeWidth={1.9}
          className={icon.tone}
        />
      </button>
      <CopyStatus state={state} />
    </>
  )
}

Root.displayName = "HashChip.Root"
Value.displayName = "HashChip.Value"
Copy.displayName = "HashChip.Copy"
