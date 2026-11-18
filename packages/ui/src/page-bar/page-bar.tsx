import type { ReactNode } from "react"
import { Glyph, shapes } from "../icons"

/**
 * The phone's bottom page bar (Doop `U_C71yzQ9E`): a floating 54px bar,
 * "On this page" over the section being read, a chevron that opens the On
 * this page sheet, and Stuart's dog at the right end. Fixed above the home
 * indicator. Give the sheet's id as `sheet` when it is a native popover:
 * the bar then opens it with no script, so it works before hydration and
 * with scripting off.
 */

export type RootProps = {
  current: string
  /** The On this page sheet's id, when it is a native popover. */
  sheet?: string
  onOpen?: () => void
  /** The dog button: Ask Stuart or search. */
  action: ReactNode
  className?: string
}

export function Root({
  current,
  sheet,
  onOpen,
  action,
  className,
}: RootProps): ReactNode {
  return (
    <div
      className={`fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 flex h-[58px] items-center gap-2 rounded-[29px] bg-bg pr-1.5 pl-2 shadow-[0_0_0_1px_var(--line),var(--lift)] ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={onOpen}
        popoverTarget={sheet}
        aria-haspopup="dialog"
        className="flex h-[46px] min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[23px] px-3 text-left outline-none focus-visible:outline-2 focus-visible:outline-ink"
      >
        <Glyph
          shape={shapes.list}
          size={18}
          strokeWidth={1.75}
          className="flex-none text-sec"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] leading-4 text-sec">
            On this page
          </span>
          <span className="block truncate text-[15px] leading-5 font-semibold text-ink2">
            {current}
          </span>
        </span>
        <Glyph
          shape={shapes.chevronDown}
          size={18}
          strokeWidth={1.75}
          className="flex-none rotate-180 text-sec"
        />
      </button>
      {action}
    </div>
  )
}
Root.displayName = "PageBar"
