import { Switch as RadixSwitch } from "radix-ui"
import type { ComponentProps, ReactNode } from "react"
import { tv } from "../tv"

/**
 * 48 by 28. On: orange track, white knob right. Off: outlined clear track
 * with a smaller grey knob left. The knob moves and resizes by transform
 * and the orange fades in over the track, so only transform and opacity
 * animate.
 */

const switchStyles = tv({
  slots: {
    root: "group relative inline-flex h-7 w-12 flex-none cursor-pointer items-center rounded-full border-[1.5px] border-switch-off bg-raised outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-50 dark:bg-transparent",
    on: "pointer-events-none absolute -inset-[1.5px] rounded-full bg-acc opacity-0 transition-opacity duration-200 ease-roll group-data-[state=checked]:opacity-100",
    thumb:
      "pointer-events-none absolute top-[1.5px] left-[1.5px] size-[22px] scale-[0.91] rounded-full bg-off-thumb transition-transform duration-200 ease-roll data-[state=checked]:translate-x-5 data-[state=checked]:scale-100 data-[state=checked]:bg-knob data-[state=checked]:shadow-knob",
  },
})

export type RootProps = ComponentProps<typeof RadixSwitch.Root>

export function Root({ className, ...props }: RootProps): ReactNode {
  const styles = switchStyles()
  return (
    <RadixSwitch.Root className={styles.root({ className })} {...props}>
      <span aria-hidden="true" data-mbx-motion="" className={styles.on()} />
      <RadixSwitch.Thumb data-mbx-motion="" className={styles.thumb()} />
    </RadixSwitch.Root>
  )
}

Root.displayName = "Switch"
