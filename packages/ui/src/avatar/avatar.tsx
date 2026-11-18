import type { CSSProperties, ReactNode } from "react"

/**
 * Initials on a pastel circle, the hue from the address byte (matchbox-v3
 * Avatar). Light hsl(h 40% 90%) on hsl(h 40% 30%), dark hsl(h 26% 23%) on
 * hsl(h 52% 82%). Gauges without a profile use the same circle.
 */

export type RootProps = {
  initials: string
  hue: number
  /** Diameter in px. */
  size?: number
  /** Accessible name; omit when a label next to it says the same. */
  label?: string
  className?: string
}

export function Root({
  initials,
  hue,
  size = 40,
  label,
  className,
}: RootProps): ReactNode {
  const classes = `grid flex-none place-items-center rounded-full bg-[hsl(var(--avatar-hue)_40%_90%)] font-bold text-[hsl(var(--avatar-hue)_40%_30%)] tabular-nums dark:bg-[hsl(var(--avatar-hue)_26%_23%)] dark:text-[hsl(var(--avatar-hue)_52%_82%)] ${className ?? ""}`
  const style = {
    "--avatar-hue": hue,
    width: size,
    height: size,
    fontSize: Math.round(size * 0.32),
  } as CSSProperties
  if (label === undefined) {
    return (
      <span aria-hidden="true" className={classes} style={style}>
        {initials}
      </span>
    )
  }
  return (
    <span role="img" aria-label={label} className={classes} style={style}>
      {initials}
    </span>
  )
}

Root.displayName = "Avatar"
