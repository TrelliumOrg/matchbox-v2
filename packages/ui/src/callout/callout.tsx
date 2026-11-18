import type { ReactNode } from "react"
import { Glyph, type GlyphShape, shapes } from "../icons"
import { mergeClasses } from "../tv"

/**
 * A callout in a docs page: the v3 banner shape (soft, radius 20, a round
 * icon) without the close X. Note on soft; warning, for blocked states, on
 * the amber accent soft; danger on the red soft. The title is a short
 * label in ink, the body one or two plain sentences.
 */

export type Tone = "note" | "warning" | "danger"

export type RootProps = {
  tone?: Tone
  /** Short bold label before the body, for example "Votes carry over". */
  title?: string | undefined
  /** The landmark's name when the title is set inline by the caller. */
  label?: string | undefined
  children: ReactNode
  className?: string
}

const tones: Record<
  Tone,
  { box: string; icon: string; shape: GlyphShape; label: string }
> = {
  note: {
    box: "bg-soft",
    icon: "text-ink2",
    shape: shapes.info,
    label: "Note",
  },
  warning: {
    box: "bg-acc-soft",
    icon: "text-acc-ink",
    shape: shapes.triangleAlert,
    label: "Warning",
  },
  danger: {
    box: "bg-neg-soft",
    icon: "text-neg",
    shape: shapes.circleAlert,
    label: "Important",
  },
}

export function Root({
  tone = "note",
  title,
  label,
  children,
  className,
}: RootProps): ReactNode {
  const style = tones[tone]
  return (
    <aside
      aria-label={title ?? label ?? style.label}
      className={mergeClasses(
        `mt-[22px] flex items-start gap-3.5 rounded-[20px] py-3.5 pr-[18px] pb-[15px] pl-3.5 ${style.box} ${className ?? ""}`,
      )}
    >
      <span
        aria-hidden="true"
        className={`grid size-9 flex-none place-items-center rounded-full bg-bg ${style.icon}`}
      >
        <Glyph shape={style.shape} size={18} strokeWidth={1.75} />
      </span>
      <div className="min-w-0 pt-1.5 text-[15.5px] leading-6 text-ink2 [&>*:first-child]:mt-0 [&_p]:mt-2 [&_p]:text-[15.5px] [&_p]:leading-6 [&_p:first-child]:mt-0">
        {title === undefined ? null : (
          <strong className="mr-1 font-semibold text-ink">{title}.</strong>
        )}
        {children}
      </div>
    </aside>
  )
}

Root.displayName = "Callout"
