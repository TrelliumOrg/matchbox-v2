import type { ReactNode } from "react"
import { CopyStatus, useCopy } from "../copy"
import { Glyph, type GlyphShape, shapes } from "../icons"

/**
 * An API operation's header (Doop `vFd6_tfSDd`): the method chip and the
 * path in DM Mono on a soft bar with a copy button, then a row of property
 * icons with short labels (auth, version since, cache).
 */

export type RootProps = { method: string; path: string }

export function Root({ method, path }: RootProps): ReactNode {
  const { state, copy } = useCopy(path)
  return (
    <div className="mt-5 flex h-12 items-center gap-3 rounded-[20px] bg-soft pr-2 pl-3">
      <span className="grid h-7 flex-none place-items-center rounded-lg bg-bg px-2 font-mono text-[12.5px] font-medium text-ink">
        {method}
      </span>
      <code className="min-w-0 flex-1 truncate font-mono text-[15px] text-ink">
        {path}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy path"
        data-tap=""
        className="grid size-8 flex-none cursor-pointer place-items-center rounded-full text-sec outline-none hover:bg-soft2 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
      >
        <Glyph
          shape={state === "copied" ? shapes.check : shapes.copy}
          size={16}
          strokeWidth={1.75}
        />
      </button>
      <CopyStatus state={state} />
    </div>
  )
}
Root.displayName = "OperationHeader.Root"

export type MetaItem = { icon: GlyphShape; label: string; text: string }

/** Property icons with their value; the label is for screen readers. */
export function Meta({ items }: { items: readonly MetaItem[] }): ReactNode {
  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-[22px] gap-y-2 text-[15px] text-ink2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-[7px]">
          <Glyph
            shape={item.icon}
            size={16}
            strokeWidth={1.75}
            className="text-sec"
          />
          <span className="sr-only">{item.label}: </span>
          {item.text}
        </li>
      ))}
    </ul>
  )
}
Meta.displayName = "OperationHeader.Meta"
