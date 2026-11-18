import type { ComponentProps, ReactNode } from "react"
import { mergeClasses } from "../tv"

/**
 * Numbered steps (Doop `cA_kCfY56H`): 32px soft2 circles with the number,
 * a hairline joining them, a 16/600 title beside each. An ordered list, so
 * screen readers count the steps; the circles are decoration.
 */

export function Root({ className, ...props }: ComponentProps<"ol">): ReactNode {
  return (
    <ol
      className={mergeClasses(
        `mt-[22px] flex flex-col gap-5 [counter-reset:step] ${className ?? ""}`,
      )}
      {...props}
    />
  )
}
Root.displayName = "Steps.Root"

export type ItemProps = {
  title: string
  /** A small label beside the title, for example where the step runs. */
  tag?: string | undefined
  children?: ReactNode
}

export function Item({ title, tag, children }: ItemProps): ReactNode {
  return (
    <li className="relative grid grid-cols-[32px_1fr] gap-x-4 [counter-increment:step] not-last:before:absolute not-last:before:top-10 not-last:before:-bottom-3.5 not-last:before:left-[15.5px] not-last:before:w-px not-last:before:bg-line">
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-full bg-soft2 text-[14.5px] font-[650] text-ink tabular-nums before:content-[counter(step)]"
      />
      <div className="min-w-0">
        <h3 className="flex min-h-8 flex-wrap items-center gap-x-2.5 text-base font-semibold text-ink">
          {title}
          {tag === undefined ? null : (
            <span className="text-[13px] font-normal text-sec">{tag}</span>
          )}
        </h3>
        <div className="text-base leading-[26px] text-ink2 [&>*:first-child]:mt-0">
          {children}
        </div>
      </div>
    </li>
  )
}
Item.displayName = "Steps.Item"
