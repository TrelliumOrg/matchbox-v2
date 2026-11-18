import { Tooltip as RadixTooltip } from "radix-ui"
import type { ComponentProps, ReactNode } from "react"
import { tv } from "../tv"

/**
 * Ink bubble (inverted in dark), 13.5px, radius 12, padding 8 by 12. Opens on
 * hover and keyboard focus, closes on Escape; scales and fades in and out
 * from the trigger's side. Never put links or buttons inside: tooltips are
 * not interactive.
 */

const bubble = tv({
  base: "z-50 max-w-72 origin-(--radix-tooltip-content-transform-origin) rounded-xl bg-tip px-3 py-2 text-[13.5px] leading-[1.45] font-medium text-on-tip data-[state=closed]:animate-[mbx-pop-out_120ms_ease-out_forwards] data-[state=delayed-open]:animate-[mbx-pop-in_150ms_var(--ease-roll)] data-[state=instant-open]:animate-[mbx-pop-in_150ms_var(--ease-roll)]",
})

export type ProviderProps = ComponentProps<typeof RadixTooltip.Provider>

export function Provider({
  delayDuration = 300,
  ...props
}: ProviderProps): ReactNode {
  return <RadixTooltip.Provider delayDuration={delayDuration} {...props} />
}

Provider.displayName = "Tooltip.Provider"

export const Root = RadixTooltip.Root

export const Trigger = RadixTooltip.Trigger

export type ContentProps = ComponentProps<typeof RadixTooltip.Content>

export function Content({
  className,
  children,
  sideOffset = 6,
  ...props
}: ContentProps): ReactNode {
  return (
    <RadixTooltip.Portal>
      <RadixTooltip.Content
        data-mbx-motion=""
        sideOffset={sideOffset}
        collisionPadding={8}
        className={bubble({ className })}
        {...props}
      >
        {children}
        <RadixTooltip.Arrow
          width={10}
          height={5}
          className="fill-[var(--tip)]"
        />
      </RadixTooltip.Content>
    </RadixTooltip.Portal>
  )
}

Content.displayName = "Tooltip.Content"

export type SimpleProps = {
  label: ReactNode
  children: ReactNode
  side?: ContentProps["side"]
}

/** One trigger, one label. The child must be focusable. */
export function Simple({ label, children, side }: SimpleProps): ReactNode {
  return (
    <Root>
      <Trigger asChild>{children}</Trigger>
      <Content {...(side === undefined ? {} : { side })}>{label}</Content>
    </Root>
  )
}

Simple.displayName = "Tooltip.Simple"
