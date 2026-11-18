import type { ReactNode } from "react"

/**
 * One of the address page's tiles (`eSwId--0MF`): a label, then figures.
 * Two across on a phone (`jLeuv1K6AB`), so the figures shrink there.
 */
export function Tile({
  label,
  aside,
  wide = false,
  children,
}: {
  label: string
  aside?: ReactNode
  /** Spans both columns on a phone (the wallet's balances). */
  wide?: boolean
  children: ReactNode
}): ReactNode {
  return (
    <div
      className={`flex min-h-[212px] min-w-0 flex-col rounded-[24px] bg-soft p-6 max-sm:min-h-[176px] max-sm:p-4 ${wide ? "max-sm:col-span-2" : ""}`}
    >
      <p className="flex items-center justify-between gap-3 text-[15px] text-sec max-sm:text-[14px]">
        <span className="min-w-0 max-sm:truncate">{label}</span>
        {aside}
      </p>
      {children}
    </div>
  )
}

/** A tile's main figure: 30px, 22px on a phone. */
export const figureClass =
  "mt-2 text-[30px] leading-tight font-[650] tabular-nums max-sm:text-[22px]"

/**
 * A tile whose figures are still loading: the same label and height, a
 * figure and a line drawn as blocks, so nothing moves when they arrive.
 */
export function TilePlaceholder({ label }: { label: string }): ReactNode {
  return (
    <Tile label={label}>
      <span
        aria-hidden="true"
        className="mt-3 block h-8 w-32 max-w-full rounded-lg bg-skel max-sm:h-6 max-sm:w-24"
      />
      <span
        aria-hidden="true"
        className="mt-2.5 block h-4 w-24 max-w-full rounded-md bg-skel"
      />
      <span className="sr-only" role="status">
        Loading
      </span>
    </Tile>
  )
}
